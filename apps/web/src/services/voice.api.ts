import { authHeaders } from "./auth";
import { base } from "../api";
export interface VoiceHealth {
  status: string;
  tts_engine: string;
  tts_languages: string[];
  model_state: string;
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
) {
  return (
    await request(
      "/synthesize",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, language }),
      },
      signal,
    )
  ).blob();
}
