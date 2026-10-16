import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";

const { MossVoiceClient } = require("../dist/modules/voice/moss-voice.client");
const JOB_ID = "f6955be4-032a-469a-9c87-eb4eb25bf5e8";

test("MOSS voice client uses server-side API key, profile, Thai job and WAV download", async () => {
  const fetchBefore = globalThis.fetch;
  const keyBefore = process.env.VOICE_STUDIO_API_KEY;
  const urlBefore = process.env.VOICE_STUDIO_URL;
  process.env.VOICE_STUDIO_API_KEY = "private-test-key";
  process.env.VOICE_STUDIO_URL = "http://127.0.0.1:8001";
  const calls: Array<{ path: string; key: string | null; body?: any }> = [];
  const wav = Buffer.alloc(44);
  wav.write("RIFF", 0);
  wav.write("WAVE", 8);
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    const key = new Headers(init?.headers).get("X-API-Key");
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, key, body });
    if (path === "/v1/health") {
      return Response.json({ ok: true, engine: "not_loaded", model: "moss" });
    }
    if (path === "/v1/voices") {
      return Response.json({ items: [{ id: "voice-1", name: "Yuna", language: "Thai" }] });
    }
    if (path === "/v1/jobs" && init?.method === "POST") {
      return Response.json({ id: JOB_ID, status: "queued" }, { status: 202 });
    }
    if (path === "/v1/jobs/" + JOB_ID) {
      return Response.json({ id: JOB_ID, status: "completed" });
    }
    if (path === "/v1/jobs/" + JOB_ID + "/audio") {
      return new Response(Uint8Array.from(wav), { headers: { "Content-Type": "audio/wav" } });
    }
    return Response.json({ detail: "Unknown URL" }, { status: 404 });
  }) as typeof fetch;

  try {
    const client = new MossVoiceClient();
    assert.equal((await client.health(AbortSignal.timeout(5000))).tts_engine, "moss");
    assert.equal((await client.voices(AbortSignal.timeout(5000))).items[0].name, "Yuna");
    const audio = await client.synthesize("สวัสดีค่ะ", "th", "voice-1", AbortSignal.timeout(5000));
    assert.equal(audio.length, 44);
    assert(calls.every((c) => c.key === "private-test-key"));
    assert.deepEqual(calls.find((c) => c.path === "/v1/jobs")?.body, {
      text: "สวัสดีค่ะ", language: "Thai", voice_id: "voice-1",
    });
    assert.deepEqual(calls.map((c) => c.path), [
      "/v1/health", "/v1/voices", "/v1/jobs", "/v1/jobs/" + JOB_ID,
      "/v1/jobs/" + JOB_ID + "/audio",
    ]);
  } finally {
    globalThis.fetch = fetchBefore;
    if (keyBefore === undefined) delete process.env.VOICE_STUDIO_API_KEY;
    else process.env.VOICE_STUDIO_API_KEY = keyBefore;
    if (urlBefore === undefined) delete process.env.VOICE_STUDIO_URL;
    else process.env.VOICE_STUDIO_URL = urlBefore;
  }
});

test("MOSS voice client rejects unsupported Japanese synthesis", async () => {
  const client = new MossVoiceClient();
  await assert.rejects(client.synthesize("こんにちは", "ja", undefined, AbortSignal.timeout(1000)), /Thai and English/);
});

test("MOSS voice client rejects aborted requests before submitting a job", async () => {
  const controller = new AbortController();
  controller.abort();
  const client = new MossVoiceClient();
  await assert.rejects(client.synthesize("hello", "en", undefined, controller.signal));
});
