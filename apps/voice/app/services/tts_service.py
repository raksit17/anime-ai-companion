import os
from pathlib import Path

def synthesize(text: str, language: str, output: Path) -> None:
    engine = os.getenv("TTS_ENGINE", "pythaitts")
    if engine == "pythaitts":
        if language != "th":
            raise ValueError("PyThaiTTS supports Thai only; choose VoxCPM2 for en/ja")
        from pythaitts import TTS
        TTS(pretrained="vachana", device="cpu").tts(text, speaker_idx=os.getenv("TTS_SPEAKER", "th_f_1"), filename=str(output))
    elif engine == "voxcpm2":
        from voxcpm import VoxCPM
        import soundfile as sf
        reference = os.getenv("VOXCPM_REFERENCE", "").strip()
        if reference and not Path(reference).is_file():
            raise ValueError("Configured VOXCPM_REFERENCE does not exist")
        model = VoxCPM.from_pretrained(os.getenv("VOXCPM_MODEL", "openbmb/VoxCPM2"), load_denoiser=False, optimize=False, device=os.getenv("VOXCPM_DEVICE", "cuda"))
        style = os.getenv("VOXCPM_STYLE", "").strip()
        wav = model.generate(text=(f"({style}) " if style else "") + text, reference_wav_path=reference or None, cfg_value=2.0, inference_timesteps=10, retry_badcase=False)
        sf.write(str(output), wav, model.tts_model.sample_rate, subtype="PCM_16")
    else:
        raise ValueError("Unsupported TTS_ENGINE")
    # Normalize every backend's WAV format so browsers can decode it consistently.
    import soundfile as sf
    samples, rate = sf.read(str(output), dtype="float32")
    if len(samples) == 0 or len(samples) / rate > 180:
        raise ValueError("TTS generated empty or excessive audio")
    sf.write(str(output), samples, rate, subtype="PCM_16")
