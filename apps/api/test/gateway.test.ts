import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ChatGateway } from "../src/chat.gateway";
function setup(ai: any) {
  ai.translateToEnglish ??= async (content: string) => content;
  const rows: any[] = [];
  const events: any[] = [];
  const db: any = {
    conversation: {
      findUnique: async () => ({
        id: "c",
        characterId: "y",
        title: null,
        character: { name: "Yuna", personality: "kind", systemPrompt: "Thai" },
      }),
      update: async () => ({}),
    },
    message: {
      findFirst: async ({ where }: any) =>
        rows.find((r) => r.requestId === where.requestId),
      create: async ({ data }: any) => {
        const r = { id: String(rows.length), ...data };
        rows.push(r);
        return r;
      },
      findMany: async () => [...rows].reverse(),
    },
    memory: { findMany: async () => [] },
  };
  const socket: any = {
    id: "socket",
    emit: (name: string, data: any) => events.push({ name, ...data }),
  };
  return { gateway: new ChatGateway(db, ai), rows, events, socket };
}
test("stream saves user then assistant, classifies emotion and rejects duplicate request", async () => {
  const s = setup({
    async *stream() {
      yield "สวัสดี";
      yield "ค่ะ";
    },
    emotion: async () => "happy",
  });
  const dto = {
    requestId: randomUUID(),
    conversationId: "c",
    content: "hello",
  };
  await s.gateway.send(s.socket, dto);
  assert.equal(s.rows.length, 2);
  assert.equal(s.rows[1].content, "สวัสดีค่ะ");
  assert.equal(s.rows[1].emotion, "happy");
  assert.ok(s.events.some((e) => e.name === "chat:complete"));
  await s.gateway.send(s.socket, dto);
  assert.equal(s.rows.length, 2);
  assert.equal(s.events.at(-1).name, "chat:error");
});
test("stop aborts in-flight generation and persists partial text as interrupted", async () => {
  let started!: () => void;
  const ready = new Promise<void>((r) => (started = r));
  const s = setup({
    async *stream(_: any, signal: AbortSignal) {
      yield "partial";
      started();
      await new Promise((_, reject) => {
        if (signal.aborted) reject(new Error("aborted"));
        else
          signal.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
      });
    },
    emotion: async () => "neutral",
  });
  const dto = {
    requestId: randomUUID(),
    conversationId: "c",
    content: "hello",
  };
  const result = s.gateway.send(s.socket, dto);
  await ready;
  s.gateway.stop(s.socket, { requestId: dto.requestId });
  await result;
  assert.equal(s.rows[1].status, "interrupted");
  assert.equal(s.rows[1].content, "partial");
  assert.equal(s.events.at(-1).name, "chat:error");
});
test("invalid request never writes history", async () => {
  const s = setup({});
  await s.gateway.send(s.socket, {
    requestId: "bad",
    content: "",
    conversationId: "c",
  });
  assert.equal(s.rows.length, 0);
  assert.equal(s.events[0].name, "chat:error");
});

test("completed Thai reply removes an accidental final masculine particle before saving", async () => {
  const s = setup({
    async *stream() {
      yield "ยูนะช่วยได้ค่ะครับ";
    },
    emotion: async () => "happy",
  });
  await s.gateway.send(s.socket, {
    requestId: randomUUID(),
    conversationId: "c",
    content: "ช่วยหน่อย",
  });
  assert.equal(s.rows[1].content, "ยูนะช่วยได้ค่ะ");
  const completed = s.events.find((event) => event.name === "chat:complete");
  assert.equal(completed.message.content, "ยูนะช่วยได้ค่ะ");
});
