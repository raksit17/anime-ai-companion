import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSSE, LocalAiService } from "../src/ai/localai.service";

test("LocalAI SSE handles byte-split UTF-8 chunks and DONE marker", async () => {
  const source = new TextEncoder().encode('data: {"choices":[{"delta":{"content":"สวัสดี"},"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const byte of source) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    },
  });
  const output = [];
  for await (const chunk of parseSSE(body)) output.push(chunk);
  assert.equal(output[0].choices[0].delta.content, "สวัสดี");
  assert.equal(output[1].choices[0].finish_reason, "stop");
  assert.equal(output.length, 2);
});

test("LocalAI voice rejects malformed WAV payload", async () => {
  const original = globalThis.fetch;
  const oldUrl = process.env.LOCALAI_URL;
  process.env.LOCALAI_URL = "http://127.0.0.1:8080";
  globalThis.fetch = async () => new Response("not-wav", { status: 200 });
  try {
    await assert.rejects(new LocalAiService().synthesize("hello", AbortSignal.timeout(1000)), /WAV/);
  } finally {
    globalThis.fetch = original;
    if (oldUrl === undefined) delete process.env.LOCALAI_URL;
    else process.env.LOCALAI_URL = oldUrl;
  }
});
