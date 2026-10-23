import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  executeCommands,
  explainPlannerConstraint,
  parseChatOutput,
  plannerMessages,
} from "../src/planner/chat-engine";
import { initial } from "../src/planner/engine";
const require = createRequire(import.meta.url);
const { PlannerService } = require("../dist/planner/planner.js");
const now = Date.parse("2030-01-07T00:00:00+07:00"),
  date = "2030-01-07";
test("one prompt adds multiple activities with full calendar data and mandatory breaks", () => {
  const s = initial();
  s.settings.breakMinutes = 0;
  const r = executeCommands(
    s,
    [
      { type: "add", name: "English", duration: 30 },
      { type: "add", name: "Coding", duration: 120 },
    ],
    date,
    now,
  );
  assert.equal(r.sessions.length, 2);
  assert.ok(r.sessions[1].start >= r.sessions[0].start + 45);
  assert.equal(s.sessions.length, 0);
});
test("batch rejects wholly on capacity conflict", () => {
  const s = initial();
  s.settings.maxMinutes = 30;
  assert.throws(() =>
    executeCommands(
      s,
      [
        { type: "add", name: "English", duration: 30 },
        { type: "add", name: "Coding", duration: 60 },
      ],
      date,
      now,
    ),
  );
  assert.equal(s.sessions.length, 0);
});
test("tired request only adapts selected day, not entire week", () => {
  const s = initial();
  s.sessions = [
    ...executeCommands(
      s,
      [{ type: "add", name: "English", duration: 60 }],
      date,
      now,
    ).sessions,
    ...executeCommands(
      s,
      [{ type: "add", name: "Coding", duration: 90 }],
      "2030-01-08",
      now,
    ).sessions,
  ];
  const r = executeCommands(s, [{ type: "adapt", energy: "low" }], date, now);
  assert.equal(r.sessions.find((x) => x.date === date)!.duration, 20);
  assert.equal(r.sessions.find((x) => x.date !== date)!.duration, 90);
});
test("model output must be complete and validated", () => {
  for (const text of [
    '{"reply":"hi",',
    '{"reply":"hi","actions":[{"type":"delete"}]}',
    '{"reply":"hi","actions":[{"type":"add","name":"bad","duration":-1}]}',
    '{"reply":"hi","actions":[{"type":"add","name":"meeting","duration":30,"fixed":true}]}',
  ])
    assert.throws(() => parseChatOutput(text));
});
test("unknown ids and fixed conflicts are rejected", () => {
  const s = initial();
  s.sessions = executeCommands(
    s,
    [
      { type: "add", name: "English", duration: 30 },
      { type: "add", name: "Coding", duration: 60 },
    ],
    date,
    now,
  ).sessions;
  assert.throws(() =>
    executeCommands(
      s,
      [{ type: "move", id: "invented", date, start: 600 }],
      date,
      now,
    ),
  );
  s.sessions[0].fixed = true;
  assert.throws(() =>
    executeCommands(
      s,
      [
        {
          type: "move",
          id: s.sessions[1].id,
          date,
          start: s.sessions[0].start,
        },
      ],
      date,
      now,
    ),
  );
});
test("character, memories and conversation history reach model prompt", () => {
  const p = plannerMessages(
    {
      name: "ยูนะ",
      personality: "อบอุ่น ขี้เล่น",
      systemPrompt: "ใช้คำลงท้ายค่ะ",
    },
    [{ content: "ฝึก NestJS" }],
    [{ role: "user", content: "ฉันเหนื่อย" }],
    {},
    "ย้ายไปพรุ่งนี้",
  );
  assert.match(p[0].content, /ยูนะ/);
  assert.match(p[0].content, /อบอุ่น/);
  assert.match(p[0].content, /NestJS/);
  assert.equal(p[1].content, "ฉันเหนื่อย");
});
function fixture(seed = initial()) {
  let stored: any = structuredClone(seed),
    calls = 0;
  const db = {
    character: {
      findUnique: async () => ({
        name: "ยูนะ",
        personality: "warm",
        systemPrompt: "Thai",
      }),
    },
    memory: { findMany: async () => [] },
    $transaction: async (fn: any) => {
      let draft = structuredClone(stored);
      const r = await fn({
        $executeRaw: async () => 0,
        plannerStore: {
          findUnique: async () => ({ data: draft }),
          upsert: async ({ update }: any) => {
            draft = update.data;
          },
        },
      });
      stored = structuredClone(draft);
      return r;
    },
  };
  const ai = {
    plannerCompletion: async () => {
      calls++;
      return JSON.stringify({
        reply: "มาจัดวันของเรากันค่ะ",
        actions: [{ type: "add", name: "English", duration: 30 }],
      });
    },
  };
  return {
    p: new PlannerService(db, ai, { acquire: async () => () => {} }),
    ai,
    calls: () => calls,
  };
}
const future = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
const dto = {
  characterId: "yuna",
  requestId: "test-request",
  date: future,
  message: "จัดอังกฤษให้หน่อย",
  autoApply: true,
};
test("chat auto-apply persists history and request retries cannot duplicate activities", async () => {
  const { p, calls } = fixture();
  await p.chat(dto);
  await p.chat(dto);
  assert.equal((await p.get()).sessions.length, 1);
  assert.equal((await p.history("yuna")).length, 2);
  assert.equal(calls(), 1);
  assert.equal((await p.get()).chats, undefined);
});
test("preview mode leaves calendar unchanged until confirm", async () => {
  const { p } = fixture();
  const result = await p.chat({ ...dto, autoApply: false });
  assert.equal((await p.get()).sessions.length, 0);
  await p.confirm(result.proposal.id);
  assert.equal((await p.get()).sessions.length, 1);
});
test("malformed generation leaves history and schedule unchanged", async () => {
  const { p, ai } = fixture();
  ai.plannerCompletion = async () => '{"reply":"incomplete';
  await assert.rejects(() => p.chat(dto));
  assert.equal((await p.get()).sessions.length, 0);
  assert.equal((await p.history("yuna")).length, 0);
});
test("advice-only conversation never creates sessions", async () => {
  const { p, ai } = fixture();
  ai.plannerCompletion = async () =>
    JSON.stringify({ reply: "พักก่อนได้นะคะ", actions: [] });
  await p.chat(dto);
  assert.equal((await p.get()).sessions.length, 0);
  assert.equal((await p.history("yuna")).length, 2);
});

test("moving a flexible task automatically reflows other flexible work", () => {
  const s = initial();
  s.sessions = executeCommands(
    s,
    [
      { type: "add", name: "English", duration: 30 },
      { type: "add", name: "Coding", duration: 60 },
    ],
    date,
    now,
  ).sessions;
  const target = s.sessions[0].start,
    id = s.sessions[1].id;
  const r = executeCommands(
    s,
    [{ type: "move", id, date, start: target }],
    date,
    now,
  );
  assert.equal(r.sessions.find((x) => x.id === id)!.start, target);
  assert.equal(r.sessions.find((x) => x.id === id)!.fixed, false);
  assert.notEqual(
    r.sessions.find((x) => x.id === s.sessions[0].id)!.start,
    target,
  );
  assert.equal(s.sessions[0].start, target);
});

test("sleep-window rejection becomes a normal companion chat with choices and no mutation", async () => {
  const state = initial();
  state.sessions.push({
    id: "coding",
    name: "Coding",
    date: future,
    start: 16 * 60 + 45,
    duration: 60,
    status: "planned",
    fixed: false,
    reminder: 10,
  });
  const { p, ai } = fixture(state);
  let calls = 0;
  ai.plannerCompletion = async (messages: {role: string; content: string}[]) => {
    calls++;
    if (calls === 1)
      return JSON.stringify({
        reply: "ย้ายให้แล้วนะ",
        actions: [{ type: "move", id: "coding", date: future, start: 1320 }],
      });
    assert.ok(messages.some((m) => m.content.includes("REJECTED")));
    return JSON.stringify({
      reply: "สี่ทุ่มจะเลยเวลาเข้านอนนะ ยังไม่ได้ย้ายให้ค่ะ อยากหาเวลาอื่นไหม?",
      actions: [],
    });
  };
  const request = {
    ...dto,
    requestId: "sleep-conflict",
    message: "Coding เลื่อนไป 22:00",
  };
  const reply = await p.chat(request);
  assert.match(reply.message.content, /ยังไม่ได้ย้าย/);
  assert.match(reply.message.outcome, /ยังไม่ได้เปลี่ยนตาราง/);
  assert.ok(reply.message.followUps?.some((f: any) => f.openSettings));
  assert.ok(reply.message.followUps?.some((f: any) => f.prompt));
  assert.equal(reply.proposal, undefined);
  assert.equal((await p.get()).sessions[0].start, 16 * 60 + 45);
  assert.equal((await p.history("yuna")).length, 2);
  assert.equal((await p.chat(request)).message.id, reply.message.id);
  assert.equal(calls, 2);
});

test("recovery-model failure falls back to a safe reply even with preview enabled", async () => {
  const state = initial();
  state.sessions.push({
    id: "coding",
    name: "Coding",
    date: future,
    start: 16 * 60 + 45,
    duration: 60,
    status: "planned",
    fixed: false,
    reminder: 10,
  });
  const { p, ai } = fixture(state);
  let calls = 0;
  ai.plannerCompletion = async () => {
    if (++calls === 1)
      return JSON.stringify({
        reply: "เรียบร้อย!",
        actions: [{ type: "move", id: "coding", date: future, start: 1320 }],
      });
    throw new Error("model temporarily unavailable");
  };
  const reply = await p.chat({
    ...dto,
    requestId: "recovery-fallback",
    message: "เลื่อน Coding ไป 22:00",
    autoApply: false,
  });
  assert.match(reply.message.content, /ยูนะ/);
  assert.match(reply.message.content, /ยังไม่ได้เปลี่ยนตาราง/);
  assert.equal(reply.proposal, undefined);
  assert.equal((await p.get()).sessions[0].start, 16 * 60 + 45);
});

test("recovery model cannot execute a second unvalidated command", async () => {
  const state = initial();
  state.sessions.push({
    id: "coding",
    name: "Coding",
    date: future,
    start: 16 * 60 + 45,
    duration: 60,
    status: "planned",
    fixed: false,
    reminder: 10,
  });
  const { p, ai } = fixture(state);
  ai.plannerCompletion = async () =>
    JSON.stringify({
      reply: "ย้ายเรียบร้อย!",
      actions: [{ type: "move", id: "coding", date: future, start: 1320 }],
    });
  const reply = await p.chat({
    ...dto,
    requestId: "untrusted-recovery",
    message: "เลื่อน Coding ไป 22:00",
  });
  assert.match(reply.message.content, /ยังไม่ได้เปลี่ยนตาราง/);
  assert.equal((await p.get()).sessions[0].start, 16 * 60 + 45);
});

test("conflict description reports the actual sleep boundary instead of a generic error", () => {
  const state = initial();
  state.sessions.push({
    id: "coding",
    name: "Coding",
    date: future,
    start: 1000,
    duration: 60,
    status: "planned",
    fixed: false,
    reminder: 10,
  });
  const detail = explainPlannerConstraint(
    state,
    [{ type: "move", id: "coding", date: future, start: 1320 }],
    "generic conflict",
  );
  assert.match(detail.reason, /22:00–23:00/);
  assert.match(detail.reason, /เข้านอน 22:00/);
  assert.equal(detail.followUps.find((x) => x.openSettings)?.label, "ตั้งค่าเวลานอน");
});
