import { authHeaders } from "./auth";
import { base } from "../api";
export interface VoiceHealth {
  status: string;
  tts_engine: string;
  tts_languages: string[];
  model_state: string;
  streaming_ready?: boolean;
  streaming_languages?: string[];
}
async function request(
  path: string,
  options: RequestInit,
  signal: AbortSignal,
) {
  const response = await fetch(base + "/v1/voice" + path, {
    ...options,
    headers: { ...options.headers, ...authHeaders() },
    signal: AbortSignal.any([signal, AbortSignal.timeout(355000)]),
  });
  if (!response.ok) {
    const body = await response
      .json()
      .catch(() => ({ message: "Voice service failed" }));
    const value = body.message;
    throw new Error(
      typeof value === "string"
        ? value
        : typeof value?.message === "string"
          ? value.message
          : JSON.stringify(value ?? body),
    );
  }
  return response;
}
export async function voiceHealth(signal: AbortSignal): Promise<VoiceHealth> {
  return (await request("/health", {}, signal)).json();
}
export async function transcribe(
  audio: Blob,
  language: string,
  signal: AbortSignal,
): Promise<{ text: string; language: string; duration: number }> {
  const form = new FormData();
  form.append("file", audio, "recording");
  form.append("language", language);
  return (
    await request("/transcribe", { method: "POST", body: form }, signal)
  ).json();
}
export async function synthesize(
  text: string,
  language: string,
  signal: AbortSignal,
  streaming = false,
) {
  return (
    await request(
      "/synthesize",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, language, streaming }),
      },
      signal,
    )
  ).blob();
}


/**
 * Native MOSS PCM streaming. Only call when /voice/health reports ready.
 * Unlike /synthesize, the response body starts before generation completes.
 */
export async function synthesizePcmStream(
  text: string,
  language: string,
  signal: AbortSignal,
): Promise<{ stream: ReadableStream<Uint8Array>; sampleRate: number }> {
  const response = await request(
    "/synthesize/stream",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, language }),
    },
    signal,
  );
  const sampleRate = Number(response.headers.get("x-sample-rate"));
  if (response.headers.get("x-audio-encoding") !== "pcm_s16le" ||
      ![24000, 48000].includes(sampleRate) ||
      response.headers.get("x-channels") !== "1" || !response.body) {
    throw new Error("MOSS stream must be 24 or 48 kHz mono PCM s16le");
  }
  return { stream: response.body, sampleRate };
}
