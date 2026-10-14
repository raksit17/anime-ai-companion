import io
import wave
import pytest
from fastapi.testclient import TestClient
from app.main import app, runner

@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("TTS_ENGINE", "pythaitts")
    return TestClient(app)

def test_health_does_not_load_model(client):
    value = client.get("/health").json()
    assert value["model_state"] == "loaded_on_request"
    assert value["tts_languages"] == ["th"]

def test_invalid_inputs(client):
    assert client.post("/v1/tts/synthesize", json={"text": "  "}).status_code == 422
    assert client.post("/v1/tts/synthesize", json={"text": "x" * 351}).status_code == 422
    assert client.post("/v1/tts/synthesize", json={"text": "Hello", "language": "en"}).status_code == 400
    assert client.post("/v1/stt/transcribe", files={"file": ("x.txt", b"x", "text/plain")}).status_code == 415
    assert client.post("/v1/stt/transcribe", files={"file": ("x.wav", b"", "audio/wav")}).status_code == 400
    assert client.post("/v1/stt/transcribe", files={"file": ("x.wav", b"x" * (10 * 1024 * 1024 + 1), "audio/wav")}).status_code == 413
    assert client.post("/v1/stt/transcribe", files={"file": ("x.wav", b"x", "audio/wav")}, data={"language": "jp"}).status_code == 422

def test_transcript_and_wav_contract(client, monkeypatch):
    async def fake(request, job_id, payload, audio=None):
        if payload["kind"] == "stt":
            assert payload["language"] == "ja"
            return {"text": "こんにちは", "language": "ja", "duration": 1.0}
        data = io.BytesIO()
        with wave.open(data, "wb") as output:
            output.setnchannels(1)
            output.setsampwidth(2)
            output.setframerate(16000)
            output.writeframes(b"\x00\x00" * 1600)
        return data.getvalue()
    monkeypatch.setattr(runner, "run", fake)
    result = client.post("/v1/stt/transcribe", files={"file": ("audio.webm", b"test", "audio/webm")}, data={"language": "ja"})
    assert result.json()["text"] == "こんにちは"
    result = client.post("/v1/tts/synthesize", json={"text": "สวัสดี"})
    assert result.headers["content-type"] == "audio/wav"
    assert result.headers["cache-control"] == "no-store"
    assert result.content[:4] == b"RIFF"
