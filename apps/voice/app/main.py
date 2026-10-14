import os
from pathlib import Path
from typing import Literal
from uuid import UUID, uuid4
from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parent.parent / ".env")
from fastapi import FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field, field_validator
from app.jobs import JobRunner

app = FastAPI(title="Anime Companion Voice — Phase 2")
runner = JobRunner()
MAX_AUDIO_SIZE = 10 * 1024 * 1024
AUDIO_TYPES = {"audio/webm", "video/webm", "audio/ogg", "audio/mp4", "video/mp4", "audio/wav", "audio/x-wav", "audio/mpeg"}

class SynthesizeRequest(BaseModel):
    text: str = Field(min_length=1, max_length=350)
    language: Literal["th", "ja", "en"] = "th"
    @field_validator("text")
    @classmethod
    def nonempty(cls, value):
        if not value.strip():
            raise ValueError("Empty text")
        return value.strip()

def engine():
    value = os.getenv("TTS_ENGINE", "pythaitts")
    if value not in {"pythaitts", "voxcpm2"}:
        raise HTTPException(503, "Invalid TTS_ENGINE configuration")
    return value

@app.get("/health")
async def health():
    selected = engine()
    return {"status": "ok", "tts_engine": selected, "tts_languages": ["th"] if selected == "pythaitts" else ["th", "ja", "en"], "stt_languages": ["auto", "th", "ja", "en"], "stt_device": "cpu", "model_state": "loaded_on_request", "active_jobs": len(runner.jobs)}

@app.delete("/v1/jobs/{job_id}")
async def cancel(job_id: UUID):
    return await runner.cancel(str(job_id))

@app.post("/v1/stt/transcribe")
async def transcribe(request: Request, file: UploadFile = File(...), language: Literal["auto", "th", "ja", "en"] = Form("auto"), x_voice_job: UUID | None = Header(None)):
    try:
        if (file.content_type or "").split(";")[0] not in AUDIO_TYPES:
            raise HTTPException(415, "Unsupported audio format")
        audio = await file.read(MAX_AUDIO_SIZE + 1)
        if len(audio) > MAX_AUDIO_SIZE:
            raise HTTPException(413, "Audio exceeds 10 MB")
        if not audio:
            raise HTTPException(400, "Audio is empty")
        return await runner.run(request, str(x_voice_job or uuid4()), {"kind": "stt", "language": language}, audio)
    finally:
        await file.close()

@app.post("/v1/tts/synthesize")
async def synthesize(request: Request, body: SynthesizeRequest, x_voice_job: UUID | None = Header(None)):
    if engine() == "pythaitts" and body.language != "th":
        raise HTTPException(400, "PyThaiTTS supports Thai only; configure VoxCPM2 for en/ja")
    data = await runner.run(request, str(x_voice_job or uuid4()), {"kind": "tts", **body.model_dump()})
    return Response(data, media_type="audio/wav", headers={"Cache-Control": "no-store"})
