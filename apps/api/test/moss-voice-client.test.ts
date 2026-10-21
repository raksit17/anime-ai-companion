import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { MossVoiceClient } from "../src/modules/voice/moss-voice.client";

test("MOSS jobs route bilingual English to Chatterbox and Thai to MOSS with language-safe voices", async () => {
  const keys = [
    "VOICE_STUDIO_URL", "VOICE_STUDIO_API_KEY", "VOICE_STUDIO_VOICE_ID",
    "VOICE_STUDIO_EN_VOICE_ID", "VOICE_STUDIO_TH_VOICE_ID",
    "VOICE_STUDIO_EN_ENGINE", "VOICE_STUDIO_TH_ENGINE",
  ] as const;
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  const id = "00000000-0000-4000-8000-000000000001";
  const englishVoiceId = "c8ae0a92-9028-4cce-93de-73a1c51794da";
  const thaiVoiceId = "10000000-0000-4000-8000-000000000002";
  const submitted: Record<string, unknown>[] = [];
  const wav = Buffer.alloc(44);
  wav.write("RIFF", 0);
  wav.write("WAVE", 8);

  try {
    process.env.VOICE_STUDIO_URL = "http://127.0.0.1:8001";
    process.env.VOICE_STUDIO_API_KEY = "test-key";
    process.env.VOICE_STUDIO_VOICE_ID = englishVoiceId; // Legacy config must never leak into Thai jobs.
    delete process.env.VOICE_STUDIO_EN_ENGINE;
    delete process.env.VOICE_STUDIO_TH_ENGINE;
    delete process.env.VOICE_STUDIO_EN_VOICE_ID;
    delete process.env.VOICE_STUDIO_TH_VOICE_ID;

    let installedThaiVoice = false;
    globalThis.fetch = async (input, init) => {
      const path = new URL(String(input)).pathname;
      assert.equal(new Headers(init?.headers).get("X-API-Key"), "test-key");
      if (path === "/v1/voices") {
        return new Response(JSON.stringify({ items: [
          { id: englishVoiceId, name: "Yuna English", language: "English" },
          ...(installedThaiVoice ? [{ id: thaiVoiceId, name: "Thai", language: "Thai" }] : []),
        ] }));
      }
      if (path === "/v1/jobs") {
        assert.equal(init?.method, "POST");
        submitted.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response(JSON.stringify({ id }), { status: 202 });
      }
      if (path === "/v1/jobs/" + id) {
        return new Response(JSON.stringify({ id, status: "completed" }));
      }
      if (path === "/v1/jobs/" + id + "/audio") {
        return new Response(new Uint8Array(wav), {
          headers: { "Content-Type": "audio/wav" },
        });
      }
      throw new Error("Unexpected request: " + path);
    };

    const signal = new AbortController().signal;
    const bilingual = "English:\n*Grins brightly.*\nWelcome back! [chuckle] 😊\n\nThai:\n*ยิ้ม*\nกลับมาแล้ว!";
    await new MossVoiceClient().synthesize(bilingual, "en", undefined, signal);
    assert.deepEqual(submitted[0], {
      text: "Welcome back! [chuckle]",
      language: "English",
      voice_id: englishVoiceId,
      engine: "chatterbox-turbo",
      model_id: null,
      voice_model_id: null,
      temperature: 1.7,
      top_k: 25,
      top_p: 0.8,
    });

    await new MossVoiceClient().synthesize(bilingual, "th", undefined, signal);
    assert.equal(submitted[1].text, "กลับมาแล้ว!");
    assert.equal(submitted[1].language, "Thai");
    assert.equal(submitted[1].engine, "moss");
    assert.equal(submitted[1].voice_id, null);
    assert.equal(submitted[1].model_id, undefined);

    installedThaiVoice = true;
    await new MossVoiceClient().synthesize("สวัสดีค่ะ", "th", englishVoiceId, signal);
    assert.equal(submitted[2].voice_id, thaiVoiceId);

    process.env.VOICE_STUDIO_EN_ENGINE = "invalid";
    await assert.rejects(
      new MossVoiceClient().synthesize("Hello", "en", undefined, signal),
      /VOICE_STUDIO_EN_ENGINE/,
    );
    assert.equal(submitted.length, 3);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) {
      const previous = saved[key];
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
  }
});
