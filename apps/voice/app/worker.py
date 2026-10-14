"""One inference process per request; process exit releases model/GPU memory."""
import json
import sys
import traceback
from pathlib import Path

def main():
    request_path = Path(sys.argv[1])
    work = request_path.parent
    request = json.loads(request_path.read_text(encoding="utf-8"))
    try:
        if request["kind"] == "stt":
            from app.services.whisper_service import transcribe_audio
            result = transcribe_audio((work / "input.audio").read_bytes(), request["language"])
        else:
            from app.services.tts_service import synthesize
            synthesize(request["text"], request["language"], work / "speech.wav")
            result = {"ok": True}
    except ValueError as exc:
        result = {"error": str(exc), "status": 400}
    except ImportError:
        traceback.print_exc()
        result = {"error": "Voice dependencies missing; install the selected engine requirements", "status": 503}
    except Exception:
        traceback.print_exc()
        result = {"error": "Voice inference failed; check server log, model download and available memory", "status": 502}
    (work / "result.json").write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")

if __name__ == "__main__":
    main()
