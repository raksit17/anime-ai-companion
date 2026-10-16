import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Module, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { ResourceGate } from "../src/resources";
const { VoiceController } = require("../dist/modules/voice/voice.controller");
const { VoiceService } = require("../dist/modules/voice/voice.service");
const wav = Buffer.alloc(44);
wav.write("RIFF");
wav.write("WAVE", 8);
const calls: any[] = [];
@Module({
  controllers: [VoiceController],
  providers: [
    {
      provide: VoiceService,
      useValue: {
        health: async () => ({ status: "ok" }),
        voices: async () => ({ items: [{ id: "sample", name: "Yuna" }] }),
        transcribe: async (_: any, mime: string, language: string) => {
          calls.push({ mime, language });
          return { text: "สวัสดี", language, duration: 1 };
        },
        synthesize: async (_text: string, _lang: string, _signal: AbortSignal, voiceId?: string) => {
          calls.push({ voiceId });
          return wav;
        },
      },
    },
  ],
})
class TestModule {}
test("voice HTTP validates multipart, language, empty text, maximum text and returns WAV", async () => {
  const app = await NestFactory.create(TestModule, { logger: false });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  try {
    await app.listen(0, "127.0.0.1");
    const base = await app.getUrl();
    const form = new FormData();
    form.append(
      "file",
      new Blob(["audio"], { type: "audio/webm" }),
      "recording.webm",
    );
    form.append("language", "ja");
    const response = await fetch(base + "/v1/voice/transcribe", {
      method: "POST",
      body: form,
    });
    assert.equal(response.status, 201);
    assert.equal(((await response.json()) as any).language, "ja");
    assert.deepEqual(calls[0], { mime: "audio/webm", language: "ja" });
    for (const body of [
      { text: " " },
      { text: "x".repeat(351) },
      { text: "hello", language: "jp" },
    ]) {
      assert.equal(
        (
          await fetch(base + "/v1/voice/synthesize", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        ).status,
        400,
      );
    }
    const bad = new FormData();
    bad.append("file", new Blob(["x"], { type: "text/plain" }), "bad.txt");
    assert.equal(
      (
        await fetch(base + "/v1/voice/transcribe", {
          method: "POST",
          body: bad,
        })
      ).status,
      400,
    );
    const voiceList = await fetch(base + "/v1/voice/voices");
    assert.equal(((await voiceList.json()) as any).items[0].name, "Yuna");
    const audio = await fetch(base + "/v1/voice/synthesize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "สวัสดี", language: "th", voiceId: "ecbc9bd0-5d09-4a87-b146-4af60e79c125" }),
    });
    assert.equal(audio.status, 201);
    assert.match(audio.headers.get("content-type") ?? "", /audio\/wav/);
    assert.equal((await audio.arrayBuffer()).byteLength, 44);
    assert.deepEqual(calls.at(-1), { voiceId: "ecbc9bd0-5d09-4a87-b146-4af60e79c125" });
  } finally {
    await app.close();
  }
});
test("GPU gate serializes jobs and a cancelled waiter never blocks later jobs", async () => {
  const gate = new ResourceGate(),
    a = new AbortController(),
    b = new AbortController(),
    c = new AbortController();
  const release = await gate.acquire(a.signal);
  let acquired = false;
  const wait = gate.acquire(b.signal);
  b.abort();
  await assert.rejects(wait);
  const third = gate.acquire(c.signal).then((unlock) => {
    acquired = true;
    return unlock;
  });
  await Promise.resolve();
  assert.equal(acquired, false);
  release();
  (await third)();
  assert.equal(acquired, true);
});
test("GPU gate fails closed after unconfirmed cancellation", async () => {
  const gate = new ResourceGate();
  gate.block("Restart services");
  await assert.rejects(gate.acquire(new AbortController().signal), /Restart/);
});
