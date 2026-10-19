# Phase 4 — LocalAI Multimodal Companion (optional)

Adds an alternative LocalAI backend **without replacing the existing Ollama + FastAPI path**.

## Capabilities

| Input / output | App path | LocalAI endpoint | Model env |
| --- | --- | --- | --- |
| Chat + streamed Live2D emotion | Socket.IO /chat | POST /v1/chat/completions | LOCALAI_CHAT_MODEL |
| Manually uploaded photo / single camera frame | POST /v1/vision/analyze | POST /v1/chat/completions (image_url) | LOCALAI_VISION_MODEL |
| Microphone → transcript | POST /v1/voice/transcribe | POST /v1/audio/transcriptions | LOCALAI_STT_MODEL |
| Reply → speech → Live2D lip sync | POST /v1/voice/synthesize | POST /v1/audio/speech (WAV) | LOCALAI_TTS_MODEL |

Vision currently analyzes **one still image at a time**, not continuous webcam video. The client sends its AI-generated description into the existing text conversation so the character responds in its normal personality. The photo itself is not stored; the **image analysis text is persisted** in PostgreSQL conversation history. Models may hallucinate; do not rely on the output for safety or identification.

## Windows quickstart (PowerShell)

1. Start PostgreSQL:
   ```powershell
   docker compose up -d postgres
   ```
2. Start LocalAI (CPU profile; GPU see LocalAI official images):
   ```powershell
   docker compose --profile localai up -d localai
   ```
3. Open http://localhost:8080 and use its model gallery to install chat, vision, transcription and speech models that support the required endpoints. **LocalAI does not install these four models automatically.** A supported example chat model is `qwen3-4b`, a supported vision example is `moondream2-20250414`. The exact names for STT and TTS depend on installed configurations; inspect `http://localhost:8080/v1/models`.
4. Run `npm run setup` if not done before. In `apps/api/.env` set:
   ```dotenv
   AI_PROVIDER=localai
   VOICE_PROVIDER=localai
   LOCALAI_URL=http://127.0.0.1:8080
   LOCALAI_CHAT_MODEL=qwen3-4b
   LOCALAI_VISION_MODEL=moondream2-20250414
   LOCALAI_STT_MODEL=whisper-1
   LOCALAI_TTS_MODEL=tts-1
   LOCALAI_TTS_VOICE=alloy
   ```
   The model IDs are *examples*: change them to installed IDs. Set `LOCALAI_API_KEY` only if the LocalAI server requires a key. This is distinct from the existing NestJS `LOCAL_API_TOKEN`.
5. Start the app as before:
   ```powershell
   npm ci
   npm run generate
   npm run db:migrate
   npm run dev -w apps/api
   # In another terminal:
   npm run desktop:dev
   ```
   When `VOICE_PROVIDER=localai`, FastAPI voice server is not needed.

## Compatibility & security

- API remains on `127.0.0.1:3001` and still uses `LOCAL_API_TOKEN`. LocalAI Compose maps its port only to the host's loopback.
- Ollama + FastAPI stay the default when the provider flags are absent. Existing PostgreSQL schema, websocket event names, voice playback and Live2D lip-sync stay unchanged.
- Camera permission is requested only after the **take one photo** action; its video track is stopped after capturing the frame. PNG/JPEG/WebP are supported (4 MB maximum); files are not written to disk by the NestJS endpoint.
- Webcam permissions inside Tauri depend on OS/WebView2 settings. Manual image upload is an alternative.
- LocalAI must return WAV for the voice pipeline. Models with different output formats require configuration. Language availability depends on the actual installed TTS/STT models, not the UI language selector.
- LocalAI endpoint health checks show *server reachability*, not proof that every model works end-to-end.
- For production use, pin a tested LocalAI container version rather than `latest` and secure any LAN exposure.

Official references: https://localai.io/docs/ and https://localai.io/docs/basics/try/
