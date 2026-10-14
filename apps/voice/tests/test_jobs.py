import asyncio
import sys
from pathlib import Path
from uuid import uuid4
import pytest
from fastapi import HTTPException
from app.jobs import JobRunner

class Request:
    async def is_disconnected(self):
        return False

@pytest.mark.asyncio
async def test_worker_cancel_kills_process_and_cleans_temp(monkeypatch):
    runner = JobRunner()
    original = asyncio.create_subprocess_exec
    started = asyncio.Event()
    captured = {}
    async def spawn(*args, **kwargs):
        captured["work"] = Path(args[-1]).parent
        process = await original(sys.executable, "-c", "import time; time.sleep(30)", **kwargs)
        captured["process"] = process
        started.set()
        return process
    monkeypatch.setattr(asyncio, "create_subprocess_exec", spawn)
    job_id = str(uuid4())
    task = asyncio.create_task(runner.run(Request(), job_id, {"kind": "stt", "language": "th"}, b"test"))
    await asyncio.wait_for(started.wait(), 5)
    await runner.cancel(job_id)
    with pytest.raises(HTTPException) as exc:
        await task
    assert exc.value.status_code == 499
    assert captured["process"].returncode is not None
    assert not captured["work"].exists()
    assert not runner.jobs
    assert not runner.gate.locked()

@pytest.mark.asyncio
async def test_cancel_before_request_prevents_worker():
    runner = JobRunner()
    job_id = str(uuid4())
    await runner.cancel(job_id)
    with pytest.raises(HTTPException) as exc:
        await runner.run(Request(), job_id, {"kind": "stt"})
    assert exc.value.status_code == 499
    assert not runner.gate.locked()

@pytest.mark.asyncio
async def test_cancel_queued_job_does_not_release_other_job_lock():
    runner = JobRunner()
    await runner.gate.acquire()
    job_id = str(uuid4())
    task = asyncio.create_task(runner.run(Request(), job_id, {"kind": "stt"}))
    await asyncio.sleep(0.01)
    await runner.cancel(job_id)
    with pytest.raises(HTTPException):
        await task
    assert runner.gate.locked()
    runner.gate.release()
