import { Injectable, HttpException, ServiceUnavailableException, BadGatewayException } from "@nestjs/common";
import { setTimeout as delay } from "node:timers/promises";

export interface MossVoice {
  id: string;
  name: string;
  language: string;
  character?: string;
}

type MossJob = {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | string;
  error?: string | null;
};

@Injectable()
export class MossVoiceClient {
  private readonly url = (process.env.VOICE_STUDIO_URL ?? "http://127.0.0.1:8001").replace(/\/$/, "");
  private readonly key = process.env.VOICE_STUDIO_API_KEY ?? "";
  private readonly defaultVoice = process.env.VOICE_STUDIO_VOICE_ID ?? "";
  private chatterboxEnglishVoiceId = "";

  private async call(path: string, options: RequestInit, signal: AbortSignal): Promise<Response> {
    if (!this.key.trim()) {
      throw new ServiceUnavailableException("Set VOICE_STUDIO_API_KEY in apps/api/.env");
    }
    const headers = new Headers(options.headers);
    headers.set("X-API-Key", this.key);
    let response: Response;
    try {
      response = await fetch(this.url + path, { ...options, headers, signal });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new ServiceUnavailableException("MOSS Voice Studio unavailable at " + this.url);
    }
    if (!response.ok) {
      const detail = (await response.json().catch(() => null)) as { detail?: unknown } | null;
      const message = typeof detail?.detail === "string" ? detail.detail : "MOSS Voice Studio HTTP " + response.status;
      throw new HttpException(message, [400, 404, 413, 415, 422, 429, 503, 504].includes(response.status) ? response.status : 502);
    }
    return response;
  }

  async health(signal: AbortSignal) {
    const response = await this.call("/v1/health", {}, signal);
    const data = (await response.json()) as { ok: boolean; engine?: string; model?: string };
    if (!data.ok) throw new ServiceUnavailableException("MOSS Voice Studio reported unhealthy");
    return {
      status: "ok",
      tts_engine: "moss",
      tts_languages: ["th", "en"],
      model_state: data.engine ?? "unknown",
      model: data.model,
    };
  }

  async voices(signal: AbortSignal): Promise<{ items: MossVoice[] }> {
    const response = await this.call("/v1/voices", {}, signal);
    const data = (await response.json()) as { items?: MossVoice[] };
    return { items: Array.isArray(data.items) ? data.items : [] };
  }

  private async voiceId(language: string, signal: AbortSignal) {
    if (this.defaultVoice) return this.defaultVoice;
    if (language !== "en") return null;
    if (this.chatterboxEnglishVoiceId) return this.chatterboxEnglishVoiceId;
    const { items } = await this.voices(signal);
    const voice = items.find((item) =>
      /chatterbox[-\s]?turbo/i.test(`${item.name} ${item.character ?? ""}`) &&
      /^(en|english)(\b|[-_])/i.test(item.language.trim()),
    );
    if (!voice) {
      throw new ServiceUnavailableException(
        "MOSS voice 'chatterbox-turbo · English' was not found; set VOICE_STUDIO_VOICE_ID to its voice ID",
      );
    }
    this.chatterboxEnglishVoiceId = voice.id;
    return voice.id;
  }

  async synthesize(text: string, language: string, voiceId: string | undefined, signal: AbortSignal): Promise<Buffer> {
    if (language !== "th" && language !== "en") {
      throw new HttpException("MOSS Voice Studio supports Thai and English only", 400);
    }
    signal.throwIfAborted();
    const response = await this.call("/v1/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        language: language === "th" ? "Thai" : "English",
        voice_id: voiceId || await this.voiceId(language, signal),
      }),
    }, signal);
    const started = (await response.json()) as { id?: string };
    if (!started.id || !/^[0-9a-f-]{36}$/i.test(started.id)) {
      throw new BadGatewayException("MOSS returned an invalid job ID");
    }
    const id = started.id;
    const deadline = Date.now() + 300_000;
    while (Date.now() < deadline) {
      signal.throwIfAborted();
      const statusResponse = await this.call("/v1/jobs/" + id, {}, signal);
      const job = (await statusResponse.json()) as MossJob;
      if (job.id !== id) throw new BadGatewayException("MOSS returned the wrong job ID");
      if (job.status === "completed") {
        const audio = await this.call("/v1/jobs/" + id + "/audio", {}, signal);
        if (!audio.headers.get("content-type")?.includes("audio/wav")) {
          throw new BadGatewayException("MOSS did not return WAV audio");
        }
        const declared = Number(audio.headers.get("content-length") ?? 0);
        if (declared > 25 * 1024 * 1024) throw new BadGatewayException("MOSS WAV exceeds 25 MB");
        const bytes = Buffer.from(await audio.arrayBuffer());
        if (bytes.length < 12 || bytes.length > 25 * 1024 * 1024 ||
            bytes.toString("ascii", 0, 4) !== "RIFF" ||
            bytes.toString("ascii", 8, 12) !== "WAVE") {
          throw new BadGatewayException("MOSS returned invalid WAV audio");
        }
        return bytes;
      }
      if (job.status === "failed") throw new BadGatewayException(job.error || "MOSS synthesis failed");
      if (job.status !== "running" && job.status !== "queued") {
        throw new BadGatewayException("Unexpected MOSS job status: " + job.status);
      }
      await delay(1200, undefined, { signal });
    }
    throw new HttpException("MOSS synthesis timed out", 504);
  }
}
