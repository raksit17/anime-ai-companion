import os
from io import BytesIO

def transcribe_audio(audio: bytes, language: str) -> dict:
    # Decode incrementally so a compressed upload cannot expand without a duration bound.
    import av
    import numpy as np
    from faster_whisper import WhisperModel
    parts = []
    count = 0
    with av.open(BytesIO(audio)) as container:
        if not container.streams.audio:
            raise ValueError("File contains no audio stream")
        resampler = av.AudioResampler(format="s16", layout="mono", rate=16000)
        for frame in container.decode(audio=0):
            for output in resampler.resample(frame):
                data = output.to_ndarray().flatten()
                count += len(data)
                if count > 61 * 16000:
                    raise ValueError("Audio exceeds 60 seconds")
                parts.append(data)
        for output in resampler.resample(None):
            data = output.to_ndarray().flatten()
            count += len(data)
            if count > 61 * 16000:
                raise ValueError("Audio exceeds 60 seconds")
            parts.append(data)
    if not parts or count < 1600:
        raise ValueError("Audio is empty or shorter than 0.1 seconds")
    samples = np.concatenate(parts).astype(np.float32) / 32768.0
    model = WhisperModel(os.getenv("STT_MODEL", "small"), device="cpu", compute_type=os.getenv("STT_COMPUTE", "int8"))
    segments, info = model.transcribe(samples, language=None if language == "auto" else language, beam_size=3, vad_filter=True)
    return {"text": "".join(s.text for s in segments).strip(), "language": info.language, "duration": round(count / 16000, 3)}
