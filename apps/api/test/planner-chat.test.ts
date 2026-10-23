import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  executeCommands,
  explainPlannerConstraint,
  parseChatOutput,
  previewDailyCapacityIncrease,
  simpleAddFromMessage,
  normalizePlannerActions,
  freeStartForAdd,
  explainExtendFollowUp,
  plannerMessages,
} from "../src/planner/chat-engine";
import { initial, today } from "../src/planner/engine";
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

function fullWorkday() {
  const state = initial();
  state.sessions.push(
    {
      id: "work-1",
      goalId: "daily:work-1",
      name: "Exercise",
      date: future,
      start: 480,
      duration: 120,
      status: "planned",
      fixed: false,
      reminder: 10,
    },
    {
      id: "work-2",
      goalId: "daily:work-2",
      name: "Coding",
      date: future,
      start: 615,
      duration: 120,
      status: "planned",
      fixed: false,
      reminder: 10,
    },
  );
  return state;
}

test("capacity preview is only available if it alone can make a new flexible task fit", () => {
  const full = fullWorkday();
  const command = {
    type: "add" as const,
    name: "Improve Anime AI Companion",
    date: future,
    start: 780,
    duration: 60,
    fixed: false,
  };
  assert.throws(() => executeCommands(full, [command], future));
  const p = previewDailyCapacityIncrease(full, [command], future);
  assert.equal(p?.previousLimit, 240);
  assert.equal(p?.proposedLimit, 300);
  assert.equal(p?.sessions.length, 3);
  assert.equal(p?.sessions[2].start, 780);
  assert.equal(full.sessions.length, 2);
  assert.equal(full.capacityOverrides?.[future], undefined);
  // No proposal if another constraint is still violated.
  assert.equal(
    previewDailyCapacityIncrease(
      full,
      [{ ...command, fixed: true, start: 1380 }],
      future,
    ),
    undefined,
  );
  assert.equal(
    previewDailyCapacityIncrease(full, [command, command], future),
    undefined,
  );
  assert.equal(
    previewDailyCapacityIncrease(
      { ...full, settings: { ...full.settings, maxMinutes: 700 } },
      [{ ...command, duration: 240 }],
      future,
    ),
    undefined,
  );
});

test("chat proposes raising only tomorrow's capacity and adding work together; autoApply never bypasses approval", async () => {
  const { p, ai } = fixture(fullWorkday());
  let calls = 0;
  ai.plannerCompletion = async () => {
    if (++calls === 1)
      return JSON.stringify({
        reply: "จัดเพิ่มให้นะคะ",
        actions: [
          {
            type: "add",
            name: "Improve Anime AI Companion",
            duration: 60,
            start: 780,
            date: future,
            fixed: false,
          },
        ],
      });
    return JSON.stringify({
      reply: "ถ้าอยากเพิ่มอีกหนึ่งชั่วโมง กดอนุมัติแผนเฉพาะวันพรุ่งนี้ได้เลยนะคะ",
      actions: [],
    });
  };
  const request = {
    ...dto,
    requestId: "capacity-one-day",
    date: future,
    message: `เพิ่มปรับปรุง anime ai companion อีกหนึ่งชั่วโมง วันที่ ${future}`,
    autoApply: true,
  };
  const response = await p.chat(request);
  assert.equal(calls, 2);
  assert.match(response.message.outcome, /รอยืนยัน/);
  assert.equal(response.proposal.capacityOverride.date, future);
  assert.equal(response.proposal.capacityOverride.maxMinutes, 300);
  assert.equal((await p.get()).sessions.length, 2);
  assert.equal((await p.get()).capacityOverrides?.[future], undefined);
  const duplicate = await p.chat(request);
  assert.equal(duplicate.message.id, response.message.id);
  assert.equal(duplicate.proposal.id, response.proposal.id);
  assert.equal(calls, 2);
  await p.confirm(response.proposal.id);
  const saved = await p.get();
  assert.equal(saved.sessions.length, 3);
  assert.equal(saved.capacityOverrides?.[future], 300);
  assert.equal(saved.settings.maxMinutes, 240);
  assert.equal(saved.capacityOverrides?.["2030-04-01"], undefined);
  assert.equal(saved.sessions[2].name, "Improve Anime AI Companion");
});

test("one-day capacity change does not leak into later days", () => {
  const state = fullWorkday();
  state.capacityOverrides = { [future]: 300 };
  const tomorrowPlusOne = new Date(Date.parse(future) + 86400000)
    .toISOString()
    .slice(0, 10);
  const limit = state.settings.maxMinutes;
  assert.equal(state.capacityOverrides[future], 300);
  assert.equal(state.capacityOverrides[tomorrowPlusOne], undefined);
  assert.equal(limit, 240);
});

test("stale one-day approval is rejected without applying work or changing capacity", async () => {
  const { p, ai } = fixture(fullWorkday());
  ai.plannerCompletion = async () =>
    JSON.stringify({
      reply: "เตรียมไว้ให้เลือกค่ะ",
      actions: [
        { type: "add", name: "Project", duration: 60, start: 780, date: future },
      ],
    });
  const preview = await p.chat({
    ...dto,
    requestId: "capacity-stale",
    message: `เพิ่ม Project 1 ชั่วโมง วันที่ ${future}`,
  });
  const pending = preview.proposal.id;
  assert.ok(pending);
  await p.settings({
    wake: 480,
    sleep: 1320,
    breakMinutes: 15,
    maxMinutes: 240,
  });
  await assert.rejects(() => p.confirm(pending));
  const state = await p.get();
  assert.equal(state.sessions.length, 2);
  assert.equal(state.capacityOverrides?.[future], undefined);
});

function fourMorningActivities(date: string) {
  const s = initial();
  s.settings.maxMinutes = 720;
  s.sessions = [
    { name: "ออกกำลังกาย", start: 480, duration: 30 },
    { name: "ทำความสะอาดห้อง", start: 525, duration: 60 },
    { name: "ฝึกโค้ดและภาษาอังกฤษ", start: 600, duration: 90 },
    { name: "หางาน", start: 705, duration: 60 },
  ].map((item, i) => ({
    ...item,
    id: `morning-${i}`,
    goalId: `daily:morning-${i}`,
    date,
    fixed: false,
    status: "planned" as const,
    reminder: 10,
  }));
  return s;
}
test("real four-item 240-minute morning schedule accepts a 60-minute task before bedtime", () => {
  const state = fourMorningActivities(date);
  const action = {
    type: "add" as const,
    name: "ปรับปรุง Anime AI Companion",
    duration: 60,
    date,
    fixed: false,
  };
  assert.equal(freeStartForAdd(state, action, date, now), 780);
  const result = executeCommands(state, [action], date, now);
  assert.equal(result.sessions.length, 5);
  assert.equal(result.sessions[4].start, 780);
  assert.equal(result.sessions.reduce((n, x) => n + x.duration, 0), 300);
  assert.equal(state.sessions.length, 4);
});
test("explicit tomorrow 1-hour add beats model's wrong date, fixed flag and proposed late time", () => {
  const reference = Date.parse("2030-01-07T15:00:00+07:00");
  const wrong = [{ type: "add" as const, date: "2030-01-07",
    name: "Incorrect", duration: 60, start: 1380, fixed: true }];
  const command = normalizePlannerActions(wrong,
    "พรุ่งนี้ เพิ่มงานปรับปรุง Anime AI Companion อีก 1 ชั่วโมง", reference);
  assert.deepEqual(command, [{
    type: "add", name: "ปรับปรุง Anime AI Companion", duration: 60,
    date: "2030-01-08", fixed: false,
  }]);
  const tomorrow = fourMorningActivities("2030-01-08");
  const result = executeCommands(tomorrow, command, "2030-01-07", reference);
  assert.equal(result.sessions[4].date, "2030-01-08");
  assert.equal(result.sessions[4].start, 780);
});
test("simple add parser declines ambiguous and advisory messages", () => {
  for (const message of [
    "พรุ่งนี้เพิ่มงานปรับปรุง Anime AI Companion อีก 1 ชั่วโมงดีไหม?",
    "พรุ่งนี้เพิ่มงานปรับปรุง Anime AI Companion อีกหนึ่งช่วง",
    "ช่วยเสนอเวลาว่างวันพรุ่งนี้หน่อย",
    "พรุ่งนี้เพิ่มงานยาว 5 ชั่วโมง",
  ]) assert.equal(simpleAddFromMessage(message, now), undefined);
});
test("short extend-time follow-up explains capacity is not full and suggests actual open slot", () => {
  const reference = Date.parse("2030-01-07T15:00:00+07:00");
  const state = fourMorningActivities("2030-01-08");
  const guidance = explainExtendFollowUp(state, [
    { role: "user", content: "พรุ่งนี้ เพิ่มงานปรับปรุง Anime AI Companion อีก 1 ชั่วโมง" },
    { role: "assistant", content: "ยังเพิ่มไม่ได้",
      outcome: "ยังไม่ได้เปลี่ยนตาราง · ไม่มีเวลาว่าง" },
  ], "ขยายเวลา", reference);
  assert.match(guidance?.reply ?? "", /240/);
  assert.match(guidance?.reply ?? "", /720/);
  assert.match(guidance?.reply ?? "", /13:00/);
  assert.ok(guidance?.followUps.some((x) => x.prompt));
  assert.ok(guidance?.followUps.some((x) => x.openSettings));
});
test("chat commits a concrete tomorrow add even when local model wrongly claims no time", async () => {
  const tomorrow = new Date(Date.parse(today()) + 86400000)
    .toISOString().slice(0, 10);
  const { p, ai } = fixture(fourMorningActivities(tomorrow));
  let calls = 0;
  ai.plannerCompletion = async () => {
    calls++;
    return JSON.stringify({ reply: "เพิ่มไม่ได้ ไม่มีเวลาว่างค่ะ", actions: [] });
  };
  const result = await p.chat({
    ...dto, date: today(), requestId: "correct-240-of-720",
    message: "พรุ่งนี้ เพิ่มงานปรับปรุง Anime AI Companion อีก 1 ชั่วโมง",
    autoApply: true,
  });
  assert.equal(calls, 1);
  assert.equal(result.proposal, undefined);
  assert.match(result.message.outcome, /บันทึกตารางแล้ว/);
  assert.doesNotMatch(result.message.content, /ไม่มีเวลาว่าง/);
  const state = await p.get();
  assert.equal(state.sessions.length, 5);
  assert.equal(state.sessions[4].date, tomorrow);
  assert.equal(state.sessions[4].start, 780);
  assert.equal(state.settings.maxMinutes, 720);
});
test("chat short extension follow-up does not silently change bedtime or quota", async () => {
  const tomorrow = new Date(Date.parse(today()) + 86400000)
    .toISOString().slice(0, 10);
  const state = fourMorningActivities(tomorrow) as any;
  state.chats = {
    yuna: [
      { id: "old-user", role: "user",
        content: "พรุ่งนี้ เพิ่มงานปรับปรุง Anime AI Companion อีก 1 ชั่วโมง",
        createdAt: new Date().toISOString() },
      { id: "old-assistant", role: "assistant",
        content: "ขอเวลาอื่นค่ะ",
        outcome: "ยังไม่ได้เปลี่ยนตาราง · ไม่มีเวลาว่าง",
        createdAt: new Date().toISOString() },
    ],
  };
  const { p, ai } = fixture(state);
  ai.plannerCompletion = async () => { throw new Error("should not call model"); };
  const result = await p.chat({
    ...dto, date: tomorrow, message: "ขยายเวลา", requestId: "expand-clarification",
  });
  assert.match(result.message.content, /240/);
  assert.match(result.message.content, /720/);
  assert.match(result.message.content, /13:00/);
  assert.ok(result.message.followUps?.length);
  assert.equal((await p.get()).sessions.length, 4);
  assert.equal((await p.get()).settings.sleep, 1320);
});
