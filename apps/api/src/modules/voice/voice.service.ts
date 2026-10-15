import { randomUUID } from "node:crypto";
import {
  BadGatewayException,
  HttpException,
  Injectable,
  Inject,
} from "@nestjs/common";
import { ResourceGate } from "../../resources";
import { LocalAiService, localAiVoiceEnabled } from "../../ai/localai.service";
export const AUDIO_TYPES = new Set([
  "audio/webm",
  "video/webm",
  "audio/ogg",
  "audio/mp4",
  "video/mp4",
  "audio/wav",
  "audio/x-wav",
  "audio/mpeg",
]);
@Injectable()
export class VoiceService {
  constructor(@Inject(ResourceGate) private gate: ResourceGate, @Inject(LocalAiService) private localai: LocalAiService) {}
  private base = process.env.VOICE_SERVICE_URL ?? "http://127.0.0.1:8000";
  private async request(
    path: string,
    options: RequestInit,
    signal: AbortSignal,
  ) {
    try {
      const response = await fetch(this.base + path, { ...options, signal });
      if (!response.ok) {
        const error = (await response
          .json()
          .catch(() => ({ detail: "Voice service failed" }))) as any;
        throw new HttpException(
          typeof error.detail === "string"
            ? error.detail
            : "Voice request failed",
          [400, 413, 415, 422, 429, 503, 504].includes(response.status)
            ? response.status
            : 502,
        );
      }
      return response;
    } catch (e) {
      if (e instanceof HttpException) throw e;
      throw new BadGatewayException(
        signal.aborted
          ? "Voice request cancelled or timed out"
          : "Voice service unavailable — เปิด FastAPI ที่พอร์ต 8000",
      );
    }
  }
  private async job(path: string, options: RequestInit, signal: AbortSignal) {
    const id = randomUUID();
    try {
      return await this.request(
        path,
        { ...options, headers: { ...options.headers, "X-Voice-Job": id } },
        signal,
      );
    } catch (error) {
      {
        // Confirm worker termination even when the connection fails without an explicit abort.
        try {
          const r = await fetch(this.base + "/v1/jobs/" + id, {
            method: "DELETE",
            signal: AbortSignal.timeout(20000),
          });
          if (!r.ok) throw new Error("Cancellation not acknowledged");
        } catch {
          this.gate.block(
            "Voice cancellation could not be confirmed. Restart Voice Service and API before another generation.",
          );
        }
      }
      throw error;
    }
  }
  async health(signal: AbortSignal) {
    if (localAiVoiceEnabled()) {
      const models = await this.localai.models(signal);
      const stt = models.includes(process.env.LOCALAI_STT_MODEL ?? "whisper-1");
      const tts = models.includes(process.env.LOCALAI_TTS_MODEL ?? "tts-1");
      return { status: stt && tts ? "ok" : "degraded", tts_engine: "localai", tts_languages: ["th", "en", "ja"], model_state: tts ? "ready" : "missing", stt_available: stt, tts_available: tts };
    }
    return (await this.request("/health", {}, signal)).json();
  }
  async transcribe(
    audio: Buffer,
    mime: string,
    language: string,
    signal: AbortSignal,
  ) {
    if (localAiVoiceEnabled()) {
      const release = await this.gate.acquire(signal);
      try { return await this.localai.transcribe(audio, mime, language, signal); }
      finally { release(); }
    }
    const form = new FormData();
    const extension = mime.includes("mp4")
      ? "mp4"
      : mime.includes("ogg")
        ? "ogg"
        : mime.includes("wav")
          ? "wav"
          : mime.includes("mpeg")
            ? "mp3"
            : "webm";
    form.append(
      "file",
      new Blob([Uint8Array.from(audio)], { type: mime }),
      `recording.${extension}`,
    );
    form.append("language", language);
    return (
      await this.job(
        "/v1/stt/transcribe",
        { method: "POST", body: form },
        signal,
      )
    ).json();
  }
  async synthesize(
    text: string,
    language: string,
    signal: AbortSignal,
  ): Promise<Buffer> {
    const release = await this.gate.acquire(signal);
    try {
      if (localAiVoiceEnabled()) return await this.localai.synthesize(text, signal);
      const status = (await this.health(signal)) as any;
      if (status.tts_engine === "voxcpm2") {
        const response = await fetch(
          `${process.env.OLLAMA_URL ?? "http://127.0.0.1:11434"}/api/generate`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: process.env.OLLAMA_MODEL ?? "qwen3.5:4b-q4_K_M",
              keep_alive: 0,
              stream: false,
            }),
            signal,
          },
        );
        if (!response.ok)
          throw new BadGatewayException("Cannot unload Ollama before GPU TTS");
        await response.arrayBuffer();
      }
      const response = await this.job(
        "/v1/tts/synthesize",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, language }),
        },
        signal,
      );
      if (!response.headers.get("content-type")?.includes("audio/wav"))
        throw new BadGatewayException("Voice service did not return WAV");
      const bytes = Buffer.from(await response.arrayBuffer());
      if (
        bytes.length > 25 * 1024 * 1024 ||
        bytes.subarray(0, 4).toString() !== "RIFF" ||
        bytes.subarray(8, 12).toString() !== "WAVE"
      )
        throw new BadGatewayException("Invalid WAV response");
      return bytes;
    } finally {
      release();
    }
  }
}
