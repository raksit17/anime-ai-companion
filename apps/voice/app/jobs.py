import asyncio
import json
import logging
import os
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from tempfile import TemporaryDirectory
from fastapi import HTTPException, Request

logger = logging.getLogger(__name__)
@dataclass
class Job:
    cancel: asyncio.Event = field(default_factory=asyncio.Event)
    done: asyncio.Event = field(default_factory=asyncio.Event)

class JobRunner:
    def __init__(self):
        self.jobs: dict[str, Job] = {}
        self.gate = asyncio.Semaphore(1)
        self.cancelled: dict[str, float] = {}

    async def cancel(self, job_id: str):
        # Tombstone handles cancellation arriving before its inference request.
        self.cancelled = {key: expiry for key, expiry in self.cancelled.items() if expiry > time.monotonic()}
        self.cancelled[job_id] = time.monotonic() + 600
        job = self.jobs.get(job_id)
        if job:
            job.cancel.set()
            await asyncio.wait_for(job.done.wait(), timeout=15)
        return {"status": "cancelled"}

    async def run(self, request: Request, job_id: str, payload: dict, audio: bytes | None = None):
        if len(self.jobs) >= 4:
            raise HTTPException(429, "Voice queue full")
        if job_id in self.jobs:
            raise HTTPException(409, "Duplicate voice request")
        job = Job()
        self.jobs[job_id] = job
        process = None
        acquired = False
        acquire = None
        try:
            if self.cancelled.get(job_id, 0) > time.monotonic():
                raise HTTPException(499, "Cancelled")
            deadline = time.monotonic() + int(os.getenv("VOICE_JOB_TIMEOUT", "300"))
            async def check():
                if job.cancel.is_set() or await request.is_disconnected():
                    raise HTTPException(499, "Cancelled")
                if time.monotonic() >= deadline:
                    raise HTTPException(504, "Voice job timed out")
            acquire = asyncio.create_task(self.gate.acquire())
            while not acquire.done():
                await check()
                await asyncio.sleep(0.05)
            await acquire
            acquired = True
            await check()
            with TemporaryDirectory(prefix="companion-voice-") as directory:
                work = Path(directory)
                (work / "request.json").write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
                if audio is not None:
                    (work / "input.audio").write_bytes(audio)
                executable = sys.executable
                if payload["kind"] == "tts" and os.getenv("TTS_ENGINE", "pythaitts") == "voxcpm2":
                    executable = os.getenv("VOXCPM_PYTHON", "").strip() or sys.executable
                with (work / "worker.log").open("wb") as log:
                    process = await asyncio.create_subprocess_exec(executable, "-m", "app.worker", str(work / "request.json"), cwd=str(Path(__file__).resolve().parent.parent), stdout=log, stderr=log)
                    try:
                        while process.returncode is None:
                            await check()
                            await asyncio.sleep(0.05)
                        await process.wait()
                    finally:
                        if process.returncode is None:
                            process.kill()
                            await process.wait()
                result_path = work / "result.json"
                if process.returncode != 0 or not result_path.exists():
                    logger.error("Voice worker failed: %s", (work / "worker.log").read_text(errors="replace")[-4000:])
                    raise HTTPException(502, "Voice worker failed; check server log")
                result = json.loads(result_path.read_text(encoding="utf-8"))
                if "error" in result:
                    logger.error("Voice inference: %s", (work / "worker.log").read_text(errors="replace")[-4000:])
                    raise HTTPException(result.get("status", 502), result["error"])
                if payload["kind"] == "stt":
                    return result
                wav = work / "speech.wav"
                if not wav.is_file() or wav.stat().st_size > 25 * 1024 * 1024:
                    raise HTTPException(502, "Missing or oversized WAV")
                return wav.read_bytes()
        finally:
            if acquire is not None and not acquired:
                if not acquire.done():
                    acquire.cancel()
                    try:
                        await acquire
                        acquired = True
                    except asyncio.CancelledError:
                        pass
                elif not acquire.cancelled() and acquire.exception() is None:
                    acquired = True
            if acquired:
                self.gate.release()
            self.jobs.pop(job_id, None)
            job.done.set()
