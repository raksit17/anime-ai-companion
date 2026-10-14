import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNDJSON } from "../src/ai/ndjson";
import { buildPrompt } from "../src/ai/prompt-builder";
import { normalizeThaiFeminineEnding } from "../src/ai/text-style";
function stream(bytes: Uint8Array[]) {
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (const b of bytes) c.enqueue(b);
      c.close();
    },
  });
}
test("NDJSON handles arbitrary UTF-8 boundaries and final line without newline", async () => {
  const data = new TextEncoder().encode(
    '{"message":{"content":"สวัสดี"}}\n\n{"done":true}',
  );
  const parts = [...data].map((b) => new Uint8Array([b]));
  const got = [];
  for await (const v of parseNDJSON(stream(parts))) got.push(v);
  assert.deepEqual(got, [{ message: { content: "สวัสดี" } }, { done: true }]);
});
test("malformed JSON fails explicitly", async () => {
  await assert.rejects(async () => {
    for await (const _ of parseNDJSON(
      stream([new TextEncoder().encode("bad\n")]),
    )) {
    }
  });
});
test("prompt preserves roles and separates memory as data", () => {
  const p = buildPrompt(
    { name: "Yuna", personality: "kind", systemPrompt: "Thai" },
    [{ content: "likes NestJS" }],
    [{ role: "user", content: "hello" }],
  );
  assert.equal(p[0].role, "system");
  assert.match(p[0].content, /likes NestJS/);
  assert.deepEqual(p[1], { role: "user", content: "hello" });
});

test("Thai feminine style rule is placed at the end of system prompt", () => {
  const p = buildPrompt(
    { name: "Yuna", personality: "kind", systemPrompt: "persona" },
    [],
    [],
  );
  assert.match(p[0]!.content, /ห้ามลงท้ายด้วย ครับ/);
});
test("feminine ending normalizer fixes trailing male particle without changing earlier content", () => {
  assert.equal(normalizeThaiFeminineEnding("ช่วยได้ค่ะครับ"), "ช่วยได้ค่ะ");
  assert.equal(normalizeThaiFeminineEnding("ยินดีครับ!  "), "ยินดีค่ะ!");
  assert.equal(
    normalizeThaiFeminineEnding("เดี๋ยวช่วยดูให้นะคะ"),
    "เดี๋ยวช่วยดูให้นะคะ",
  );
});
