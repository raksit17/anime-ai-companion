import { Injectable, Logger, HttpException, BadRequestException, ServiceUnavailableException, BadGatewayException } from "@nestjs/common";
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
  private readonly logger = new Logger(MossVoiceClient.name);
  private readonly defaultVoice = process.env.VOICE_STUDIO_VOICE_ID?.trim() || "";
  private readonly englishVoice = process.env.VOICE_STUDIO_EN_VOICE_ID?.trim() || "";
  private readonly thaiVoice = process.env.VOICE_STUDIO_TH_VOICE_ID?.trim() || "";
  private readonly englishEngine = process.env.VOICE_STUDIO_EN_ENGINE?.trim().toLowerCase() || "chatterbox-turbo";
  private readonly thaiEngine = process.env.VOICE_STUDIO_TH_ENGINE?.trim().toLowerCase() || "moss";

  private async call(path: string, options: RequestInit, signal: AbortSignal): Promise<Response> {
    if (!this.key.trim()) {
      throw new ServiceUnavailableException("Set VOICE_STUDIO_API_KEY in apps/api/.env");
    }
    const headers = new Headers(options.headers);
    headers.set("X-API-Key", this.key);
    let response: Response;
    try {
      this.logger.debug("MOSS request " + (options.method || "GET") + " " + path);
      response = await fetch(this.url + path, { ...options, headers, signal });
      this.logger.debug("MOSS response " + path + " " + response.status);
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

  private supportsLanguage(voice: MossVoice, language: "en" | "th"): boolean {
    const value = (voice.language || "").trim().toLowerCase();
    return language === "en"
      ? /^(en|english)(?:$|[-_ ])/.test(value)
      : /^(th|thai)(?:$|[-_ ])/.test(value);
  }

  private async voiceId(
    language: "en" | "th",
    requestedVoiceId: string | undefined,
    signal: AbortSignal,
  ): Promise<string | null> {
    const configured = language === "en" ? this.englishVoice : this.thaiVoice;
    const candidates = [...new Set(
      [configured, requestedVoiceId?.trim(), this.defaultVoice].filter(
        (id): id is string => Boolean(id),
      ),
    )];

    // MOSS voices are reference audio profiles, not model IDs. Never send an
    // English reference to the Thai engine (or vice versa).
    const { items } = await this.voices(signal);
    for (const id of candidates) {
      const voice = items.find((item) => item.id === id);
      if (voice && this.supportsLanguage(voice, language)) return voice.id;
      this.logger.warn("Ignoring incompatible or missing MOSS voice " + id + " for " + language);
    }

    const compatible = items.filter((item) => this.supportsLanguage(item, language));
    if (language === "en") {
      const preferred =
        compatible.find((item) =>
          /chatterbox[-\s]?turbo/i.test(item.name + " " + (item.character || "")),
        ) || compatible[0];

      // A missing English reference must not silently turn into a Thai MOSS job.
      // Chatterbox supports its built-in voice without a reference, but an
      // explicit configured voice that does not exist should be reported.
      if (!preferred && (this.englishVoice || requestedVoiceId)) {
        throw new ServiceUnavailableException(
          "Configured English MOSS voice was not found; check /v1/voices and VOICE_STUDIO_EN_VOICE_ID",
        );
      }
      return preferred?.id || null;
    }

    // MOSS original can synthesize Thai with its built-in voice when no Thai
    // reference is installed. A null voice_id is valid for this case.
    return compatible[0]?.id || null;
  }

  private speechOnly(text: string, language: "en" | "th"): string {
    const normalized = text.replace(/\r\n/g, "\n").trim();
    const labels = [...normalized.matchAll(/^[ \t]*(English|Thai(?: translation)?)[ \t]*[:：][ \t]*/gim)];
    let speech = normalized;

    if (labels.length > 0) {
      const blocks: string[] = [];
      for (let i = 0; i < labels.length; i++) {
        const label = labels[i]!;
        const blockLanguage = /^english$/i.test(label[1]!) ? "en" : "th";
        if (blockLanguage !== language) continue;
        const from = label.index! + label[0].length;
        const to = labels[i + 1]?.index ?? normalized.length;
        blocks.push(normalized.slice(from, to));
      }
      if (!blocks.length) {
        throw new BadRequestException("No " + language + " speech section found");
      }
      speech = blocks.join("\n");
    }

    // Keep [chuckle] and other Chatterbox speech cues; remove Live2D *actions*.
    speech = speech
      .replace(/(?<!\\)\*[^*\r\n]{1,240}\*/g, " ")
      .replace(/\p{Extended_Pictographic}/gu, "")
      .replace(/[\uFE0E\uFE0F\u200D]/g, "")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    if (!speech) throw new BadRequestException("No speakable text after removing actions");
    return speech;
  }


  /**
   * True PCM streaming is provided by a separate SGLang-Omni MOSS server,
   * not by the Chatterbox-Turbo /v1/jobs implementation.
   */
  nativeStreamingLanguages(): Array<"th" | "en"> {
    const languages: Array<"th" | "en"> = [];
    if (this.thaiEngine === "moss") languages.push("th");
    if (["moss", "chatterbox-turbo"].includes(this.englishEngine)) languages.push("en");
    return languages;
  }

  async streamingReadyLanguages(signal: AbortSignal): Promise<Array<"th" | "en">> {
    try {
      const probe = AbortSignal.any([signal, AbortSignal.timeout(1800)]);
      const response = await this.call("/v1/stream/status", {}, probe);
      const status = await response.json() as {
        ready?: boolean;
        engines?: { moss?: { ready?: boolean }; "chatterbox-turbo"?: { ready?: boolean } };
      };
      const languages: Array<"th" | "en"> = [];
      if (this.thaiEngine === "moss" && (status.engines?.moss?.ready ?? status.ready)) {
        languages.push("th");
      }
      if (this.englishEngine === "moss" && (status.engines?.moss?.ready ?? status.ready)) {
        languages.push("en");
      }
      if (this.englishEngine === "chatterbox-turbo" &&
          status.engines?.["chatterbox-turbo"]?.ready === true) {
        languages.push("en");
      }
      return languages;
    } catch (error) {
      if (signal.aborted) throw error;
      this.logger.warn("MOSS streaming status unavailable; keeping WAV synthesis");
      return [];
    }
  }

  async streamSpeech(text: string, language: string, signal: AbortSignal): Promise<Response> {
    if (language !== "th" && language !== "en") {
      throw new BadRequestException("Streaming speech supports Thai and English only");
    }
    if (!this.nativeStreamingLanguages().includes(language)) {
      throw new HttpException("This voice engine does not support streaming", 409);
    }
    const engine = language === "en" ? this.englishEngine : this.thaiEngine;
    const cleaned = this.speechOnly(text, language);
    const voice = await this.voiceId(language, undefined, signal);
    const response = await this.call("/v1/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: cleaned,
        language: language === "th" ? "Thai" : "English",
        voice_id: voice,
        engine,
      }),
    }, signal);

    const expectedRate = engine === "chatterbox-turbo" ? "24000" : "48000";
    if (!response.body ||
        !response.headers.get("content-type")?.includes("application/octet-stream") ||
        response.headers.get("x-audio-encoding") !== "pcm_s16le" ||
        response.headers.get("x-sample-rate") !== expectedRate ||
        response.headers.get("x-channels") !== "1") {
      await response.body?.cancel().catch(() => undefined);
      throw new BadGatewayException(
        "Unsupported " + engine + " stream; expected mono PCM s16le at " + expectedRate + "Hz",
      );
    }
    return response;
  }

  async synthesize(text: string, language: string, voiceId: string | undefined, signal: AbortSignal): Promise<Buffer> {
    const selected = language.trim().toLowerCase();
    if (selected !== "th" && selected !== "en") {
      throw new BadRequestException("MOSS Voice Studio supports Thai and English only");
    }
    signal.throwIfAborted();

    const engine = selected === "en" ? this.englishEngine : this.thaiEngine;
    if (selected === "en" && !["moss", "chatterbox-turbo"].includes(engine)) {
      throw new ServiceUnavailableException("VOICE_STUDIO_EN_ENGINE must be moss or chatterbox-turbo");
    }
    if (selected === "th" && engine !== "moss") {
      throw new ServiceUnavailableException("VOICE_STUDIO_TH_ENGINE must be moss");
    }

    const cleaned = this.speechOnly(text, selected);
    const selectedVoice = await this.voiceId(selected, voiceId, signal);
    const payload = {
      text: cleaned,
      language: selected === "en" ? "English" : "Thai",
      voice_id: selectedVoice,
      engine,
      // Chatterbox never uses MOSS checkpoint IDs or F5 voice packages.
      ...(engine === "chatterbox-turbo" ? { model_id: null, voice_model_id: null } : {}),
      temperature: 1.7,
      top_k: 25,
      top_p: 0.8,
    };
    this.logger.log(
      "MOSS synthesis: " + JSON.stringify({
        language: payload.language,
        engine: payload.engine,
        voice_id: payload.voice_id,
        textLength: cleaned.length,
      }),
    );
    const response = await this.call("/v1/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
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
