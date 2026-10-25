import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  executeCommands,
  explainPlannerConstraint,
  parseChatOutput,
  previewDailyCapacityIncrease,
  simpleAddFromMessage,
  parseMultipleNewTasks,
  parseBatchAlternativeFollowUp,
  parseGroupShiftPlan,
  parseScheduledAdd,
  completeScheduledAdd,
  parseDurationEdit,
  parseConversationalDurationEdit,
  validateOllamaDurationEdit,
  parseTimeDurationEdit,
  parseExistingTimeMove,
  parseExerciseWithBreaks,
  previewInsertionMinutes,
  normalizePlannerActions,
  freeStartForAdd,
  explainExtendFollowUp,
  plannerMessages,
} from "../src/planner/chat-engine";
import { initial, today, plan, swapDaySessions, editDaySessionTime } from "../src/planner/engine";
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
  assert.match(reply.message.content, /ยังไม่ได้เปลี่ยนตาราง/);
  assert.match(reply.message.outcome, /ยังไม่ได้เปลี่ยนตาราง/);
  assert.ok(reply.message.followUps?.some((f: any) => f.openSettings));
  assert.ok(reply.message.followUps?.some((f: any) => f.prompt));
  assert.equal(reply.proposal, undefined);
  assert.equal((await p.get()).sessions[0].start, 16 * 60 + 45);
  assert.equal((await p.history("yuna")).length, 2);
  assert.equal((await p.chat(request)).message.id, reply.message.id);
  // The date, target and original duration are now resolved deterministically;
  // the model must not need to invent or repair this exact-time move.
  assert.equal(calls, 0);
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

test("automatic add returns a durable receipt with the actual tomorrow date, time, and task ID", async () => {
  const tomorrow = new Date(Date.parse(today()) + 86400000)
    .toISOString().slice(0, 10);
  const { p, ai } = fixture(fourMorningActivities(tomorrow));
  ai.plannerCompletion = async () =>
    JSON.stringify({
      reply: "เสร็จแล้วค่ะ",
      actions: [],
    });
  const dtoForTomorrow = {
    ...dto,
    requestId: "receipt-tomorrow",
    date: today(),
    message: "พรุ่งนี้ เพิ่มงานปรับปรุง Anime AI Companion อีก 1 ชั่วโมง",
  };
  const response = await p.chat(dtoForTomorrow);
  assert.equal(response.message.appliedChanges.length, 1);
  const receipt = response.message.appliedChanges[0];
  assert.equal(receipt.kind, "created");
  assert.equal(receipt.name, "ปรับปรุง Anime AI Companion");
  assert.equal(receipt.date, tomorrow);
  assert.equal(receipt.start, 780);
  assert.equal(receipt.duration, 60);
  const state = await p.get();
  assert.equal(state.sessions.find((s: any) => s.id === receipt.id)?.date, tomorrow);
  assert.equal(state.sessions.find((s: any) => s.id === receipt.id)?.start, 780);
  assert.deepEqual((await p.history("yuna")).at(-1).appliedChanges, response.message.appliedChanges);
  const repeat = await p.chat(dtoForTomorrow);
  assert.equal(repeat.message.id, response.message.id);
  assert.deepEqual(repeat.message.appliedChanges, response.message.appliedChanges);
  assert.equal((await p.get()).sessions.length, 5);
});

test("progress changes return updated receipt instead of misreporting a new task", async () => {
  const state = initial();
  state.sessions.push({
    id: "english-tomorrow",
    goalId: "daily:english-tomorrow",
    name: "English",
    date: future,
    start: 600,
    duration: 30,
    status: "planned",
    fixed: false,
    reminder: 10,
  });
  const { p, ai } = fixture(state);
  ai.plannerCompletion = async () => JSON.stringify({
    reply: "เรียบร้อยค่ะ",
    actions: [{ type: "done", id: "english-tomorrow" }],
  });
  const response = await p.chat({ ...dto, requestId: "mark-done" });
  assert.equal(response.message.appliedChanges.length, 1);
  assert.deepEqual(response.message.appliedChanges[0], {
    id: "english-tomorrow",
    name: "English",
    date: future,
    start: 600,
    duration: 30,
    status: "done",
    kind: "updated",
  });
  assert.equal((await p.get()).sessions[0].status, "done");
});

test("no-op planner action does not claim a schedule was saved", async () => {
  const { p, ai } = fixture();
  ai.plannerCompletion = async () => JSON.stringify({
    reply: "เรียบร้อยแล้วค่ะ",
    actions: [{ type: "adapt", date: future, energy: "normal" }],
  });
  const reply = await p.chat({ ...dto, requestId: "no-op-plan" });
  assert.equal(reply.message.outcome, "ไม่มีการเปลี่ยนแปลงตาราง");
  assert.match(reply.message.content, /ไม่มีรายการในตารางเปลี่ยนแปลง/);
  assert.equal(reply.message.appliedChanges, undefined);
  assert.equal((await p.get()).sessions.length, 0);
});

test("preview-only chat never emits an applied-change receipt", async () => {
  const { p } = fixture();
  const reply = await p.chat({ ...dto, requestId: "receipt-preview", autoApply: false });
  assert.ok(reply.proposal);
  assert.equal(reply.message.appliedChanges, undefined);
  assert.equal((await p.get()).sessions.length, 0);
});

function durationEditFixture() {
  const state = initial();
  state.settings.maxMinutes = 720;
  state.sessions = [
    { id: "exercise", name: "ออกกำลังกาย", start: 480, duration: 30 },
    { id: "cleaning", name: "ทำความสะอาดห้อง", start: 525, duration: 60 },
    { id: "learning", name: "ฝึกโค้ดและภาษาอังกฤษ", start: 600, duration: 90 },
    { id: "job", name: "หางาน", start: 705, duration: 60 },
    { id: "project", name: "ปรับปรุง Anime AI Companion", start: 780, duration: 60 },
  ].map((item) => ({
    ...item,
    date: future,
    goalId: "daily:" + item.id,
    status: "planned" as const,
    fixed: false,
    reminder: 10,
  }));
  return state;
}

test("resize existing cleaning 60 to 30, preserving its ID and shifting end from 09:45 to 09:15", () => {
  const state = durationEditFixture();
  const parsed = parseDurationEdit(state, future, "ทำความสะอาดห้อง ลด เหลือ 30 นาที");
  assert.deepEqual(parsed?.command, { type: "resize", id: "cleaning", date: future, duration: 30 });
  const changed = executeCommands(state, [parsed!.command!], future);
  assert.equal(changed.sessions.length, 5);
  assert.equal(changed.sessions.find((x) => x.id === "cleaning")?.start, 525);
  assert.equal(changed.sessions.find((x) => x.id === "cleaning")?.duration, 30);
  assert.equal(changed.sessions.reduce((n, x) => n + x.duration, 0), 270);
  assert.equal(state.sessions.find((x) => x.id === "cleaning")?.duration, 60);
});

test("resize supports absolute increases and relative increments/decrements without new activities", () => {
  let state = durationEditFixture();
  const absolute = parseDurationEdit(state, future, "ทำความสะอาดห้อง เพิ่มเป็น 45 นาที")!.command!;
  state.sessions = executeCommands(state, [absolute], future).sessions;
  assert.equal(state.sessions[1].duration, 45);
  const more = parseDurationEdit(state, future, "เพิ่มเวลาทำความสะอาดห้องอีก 15 นาที")!.command!;
  assert.equal(more.duration, 60);
  state.sessions = executeCommands(state, [more], future).sessions;
  assert.equal(state.sessions[1].duration, 60);
  const less = parseDurationEdit(state, future, "ลดเวลาทำความสะอาดห้องลง 30 นาที")!.command!;
  assert.equal(less.duration, 30);
  state.sessions = executeCommands(state, [less], future).sessions;
  assert.equal(state.sessions[1].duration, 30);
  assert.equal(state.sessions.length, 5);
});

test("resize rejects overlaps, fixed events, completed sessions and ambiguous duplicates", () => {
  const state = durationEditFixture();
  assert.throws(
    () => executeCommands(state, [{ type: "resize", id: "cleaning", duration: 90, date: future }], future),
    /ชนเวลา/,
  );
  assert.equal(state.sessions[1].duration, 60);
  const duplicate = structuredClone(state);
  duplicate.sessions.push({ ...state.sessions[1], id: "cleaning-2" });
  const ambiguous = parseDurationEdit(duplicate, future, "ทำความสะอาดห้อง ลด เหลือ 30 นาที");
  assert.match(ambiguous?.reason ?? "", /ซ้ำ/);
  assert.equal(ambiguous?.command, undefined);
  const fixed = structuredClone(state);
  fixed.sessions[1].fixed = true;
  assert.throws(
    () => executeCommands(fixed, [{ type: "resize", id: "cleaning", duration: 30, date: future }], future),
    /ล็อกเวลา/,
  );
  const done = structuredClone(state);
  done.sessions[1].status = "done";
  assert.throws(
    () => executeCommands(done, [{ type: "resize", id: "cleaning", duration: 30, date: future }], future),
    /บันทึกผล/,
  );
  assert.match(
    parseDurationEdit(state, future, "ทำความสะอาดห้อง ลด เหลือ 0 นาที")?.reason ?? "",
    /5–240/,
  );
});

test("chat actually edits and persists task duration even when model would claim success without actions", async () => {
  const { p, ai } = fixture(durationEditFixture());
  ai.plannerCompletion = async () => { throw new Error("duration edits must not depend on model"); };
  const request = {
    ...dto,
    requestId: "cleaning-resize-30",
    message: "ทำความสะอาดห้อง ลด เหลือ 30 นาที",
  };
  const reply = await p.chat(request);
  assert.equal(reply.message.outcome, "บันทึกตารางแล้ว");
  assert.match(reply.message.content, /จาก 60 นาที เหลือ 30 นาที/);
  assert.deepEqual(reply.message.appliedChanges, [{
    id: "cleaning",
    date: future,
    name: "ทำความสะอาดห้อง",
    start: 525,
    duration: 30,
    status: "planned",
    previousDuration: 60,
    kind: "updated",
  }]);
  const state = await p.get();
  assert.equal(state.sessions.find((x: any) => x.id === "cleaning").duration, 30);
  assert.equal(state.sessions.reduce((n: number, x: any) => n + x.duration, 0), 270);
  const retry = await p.chat(request);
  assert.equal(retry.message.id, reply.message.id);
  assert.equal((await p.get()).sessions.length, 5);
});

test("chat increase after reduction updates same session and rejects overlap without false success", async () => {
  const initialState = durationEditFixture();
  initialState.sessions[1].duration = 30;
  const { p, ai } = fixture(initialState);
  ai.plannerCompletion = async () => { throw new Error("model should not be needed"); };
  const raise = await p.chat({
    ...dto,
    requestId: "cleaning-raise-45",
    message: "ทำความสะอาดห้อง เพิ่มเป็น 45 นาที",
  });
  assert.equal(raise.message.appliedChanges?.[0]?.previousDuration, 30);
  assert.equal(raise.message.appliedChanges?.[0]?.duration, 45);
  const rejected = await p.chat({
    ...dto,
    requestId: "cleaning-raise-invalid",
    message: "ทำความสะอาดห้อง เพิ่มเป็น 90 นาที",
  });
  assert.match(rejected.message.outcome ?? "", /ยังไม่ได้เปลี่ยนตาราง/);
  assert.equal(rejected.message.appliedChanges, undefined);
  assert.equal((await p.get()).sessions.find((x: any) => x.id === "cleaning").duration, 45);
});

function exactEditDay() {
  const state = initial();
  state.settings.maxMinutes = 720;
  state.sessions = [
    { id: "exercise", name: "ออกกำลัง", start: 525, duration: 30 },
    { id: "cleaning", name: "ทำความสะอาดห้อง", start: 600, duration: 30 },
    { id: "coding", name: "ฝึกโค้ดและภาษาอังกฤษ", start: 645, duration: 90 },
    { id: "job", name: "หางาน", start: 750, duration: 60 },
    { id: "project", name: "ปรับปรุง Anime AI Companion", start: 825, duration: 60 },
  ].map((item) => ({
    ...item,
    date: future,
    goalId: "daily:" + item.id,
    fixed: false,
    status: "planned" as const,
    reminder: 10,
  }));
  return state;
}

test("exact exercise 09:00 for 45 minutes updates both values atomically", () => {
  const state = exactEditDay();
  const edit = parseTimeDurationEdit(state, future,
    "ออกกำลังกายช่วง 09:00 โดยใช้เวลา 45 นาที");
  assert.deepEqual(edit?.command, {
    type: "edit", id: "exercise", date: future, start: 540, duration: 45,
  });
  const result = executeCommands(state, [edit!.command!], future);
  assert.equal(result.sessions.length, 5);
  assert.equal(result.sessions.find((x) => x.id === "exercise")?.start, 540);
  assert.equal(result.sessions.find((x) => x.id === "exercise")?.duration, 45);
  assert.equal(result.sessions.find((x) => x.id === "cleaning")?.start, 600);
  assert.equal(result.sessions.reduce((sum, x) => sum + x.duration, 0), 285);
  assert.equal(state.sessions.find((x) => x.id === "exercise")?.start, 525);
  assert.equal(state.sessions.find((x) => x.id === "exercise")?.duration, 30);
});

test("combined edits resolve tomorrow or common typo without overriding another day", () => {
  const next = new Date(Date.parse(today()) + 86400000).toISOString().slice(0, 10);
  const state = exactEditDay();
  for (const s of state.sessions) s.date = next;
  const result = parseTimeDurationEdit(state, today(),
    "พรุ้งนี้ ออกกำลังกายช่วง 09:00 โดยใช้เวลา 45 นาที");
  assert.equal(result?.command?.date, next);
  assert.equal(result?.command?.duration, 45);
  assert.equal(
    parseTimeDurationEdit(state, today(),
      "ออกกำลังกายช่วง 09:00 โดยใช้เวลา 45 นาที")?.reason?.includes("ไม่พบ"),
    true,
  );
});

test("fixed collision rejects exact combined edit rather than shifting requested time", () => {
  const state = exactEditDay();
  state.sessions.push({
    id: "appointment", date: future, name: "นัดสำคัญ",
    start: 540, duration: 30, status: "planned",
    fixed: true, reminder: 10,
  });
  assert.throws(() => executeCommands(state, [{
    type: "edit", id: "exercise", date: future, start: 540, duration: 45,
  }], future), /ชนกิจกรรมล็อก/);
  assert.equal(state.sessions.find((x) => x.id === "exercise")?.start, 525);
  assert.equal(state.sessions.find((x) => x.id === "exercise")?.duration, 30);
});

test("duplicate activity names require a unique target for combined edits", () => {
  const state = exactEditDay();
  state.sessions.push({ ...state.sessions[0], id: "exercise-2" });
  const parsed = parseTimeDurationEdit(state, future,
    "ออกกำลังกายช่วง 09:00 โดยใช้เวลา 45 นาที");
  assert.match(parsed?.reason ?? "", /หลายกิจกรรม/);
  assert.equal(parsed?.command, undefined);
});

test("chat verified receipt uses exact requested start and duration, never stale model prose", async () => {
  const { p, ai } = fixture(exactEditDay());
  ai.plannerCompletion = async () => {
    throw new Error("the local model must not decide an explicit time edit");
  };
  const request = {
    ...dto,
    requestId: "combined-exercise-09-45",
    message: "ออกกำลังกายช่วง 09:00 โดยใช้เวลา 45 นาที",
  };
  const reply = await p.chat(request);
  assert.equal(reply.message.outcome, "บันทึกตารางแล้ว");
  assert.match(reply.message.content, /09:00–09:45/);
  const applied = reply.message.appliedChanges;
  assert.deepEqual(applied, [{
    id: "exercise", name: "ออกกำลัง", date: future, start: 540,
    duration: 45, status: "planned", previousDuration: 30, kind: "updated",
  }]);
  const state = await p.get();
  const session = state.sessions.find((x: any) => x.id === "exercise");
  assert.equal(session?.start, 540);
  assert.equal(session?.duration, 45);
  assert.equal(state.sessions.length, 5);
  assert.equal((await p.chat(request)).message.id, reply.message.id);
  assert.equal((await p.get()).sessions.length, 5);
});

function removableSlotState() {
  const state = initial();
  const goal = {
    id: "recurring-exercise",
    name: "ออกกำลัง",
    duration: 30,
    days: [0, 1, 2, 3, 4, 5, 6],
    preferred: 540,
    priority: 2,
    restDays: 0,
    reminder: 10,
    flexible: true,
  };
  state.goals.push(goal);
  state.sessions.push(
    {
      id: "obsolete-skipped",
      goalId: goal.id,
      name: goal.name,
      date: future,
      start: 525,
      duration: 30,
      status: "skipped",
      fixed: false,
      reminder: 10,
    },
    {
      id: "real-exercise",
      name: "ออกกำลังกาย",
      date: future,
      start: 540,
      duration: 45,
      status: "planned",
      fixed: false,
      reminder: 10,
    },
    {
      id: "completed-work",
      name: "งานที่ทำแล้ว",
      date: future,
      start: 720,
      duration: 30,
      status: "done",
      fixed: false,
      reminder: 10,
    },
  );
  return state;
}

test("delete one skipped calendar slot by ID, not other tasks or recurring goal", async () => {
  const { p } = fixture(removableSlotState());
  const result = await p.removeSession("obsolete-skipped");
  assert.deepEqual(result, {
    ok: true,
    removed: { id: "obsolete-skipped", date: future, name: "ออกกำลัง" },
  });
  const after = await p.get();
  assert.equal(after.sessions.length, 2);
  assert.deepEqual(after.sessions.map((s: any) => s.id),
    ["real-exercise", "completed-work"]);
  assert.equal(after.goals.length, 1);
  assert.deepEqual(after.suppressedOccurrences?.["recurring-exercise"], [future]);
  assert.equal(after.revision, 1);
});

test("deleted recurring occurrence is not recreated by plan() on the same day", async () => {
  const { p } = fixture(removableSlotState());
  await p.removeSession("obsolete-skipped");
  const saved = await p.get();
  const result = plan(saved, future, "normal");
  assert.equal(result.state.sessions.some((x: any) =>
    x.goalId === "recurring-exercise" && x.date === future), false);
  const nextDate = new Date(Date.parse(future) + 86400000).toISOString().slice(0, 10);
  assert.equal(result.state.sessions.some((x: any) =>
    x.goalId === "recurring-exercise" && x.date === nextDate), true);
});

test("delete slot invalidates a pending proposal and does not modify chat history", async () => {
  const { p } = fixture(removableSlotState());
  const pending = await p.propose({ date: future, energy: "normal" });
  await p.removeSession("obsolete-skipped");
  await assert.rejects(() => p.confirm(pending.id));
  assert.equal((await p.history("yuna")).length, 0);
});

test("delete rejects completed slots and unknown IDs without any state change", async () => {
  const { p } = fixture(removableSlotState());
  await assert.rejects(() => p.removeSession("completed-work"), /กิจกรรมที่ทำเสร็จแล้ว/);
  await assert.rejects(() => p.removeSession("not-found"), /ไม่พบกิจกรรม/);
  const state = await p.get();
  assert.equal(state.sessions.length, 3);
  assert.equal(state.revision, 0);
  assert.deepEqual(state.suppressedOccurrences, {});
});

test("repeated deletion cannot remove an unrelated slot", async () => {
  const { p } = fixture(removableSlotState());
  await p.removeSession("obsolete-skipped");
  await assert.rejects(() => p.removeSession("obsolete-skipped"));
  assert.deepEqual((await p.get()).sessions.map((s: any) => s.id),
    ["real-exercise", "completed-work"]);
});

const refClock = Date.parse("2026-10-23T22:45:00+07:00");
const tomorrowOfScreenshot = "2026-10-24";

test("Thai tomorrow date + exact 15:00–16:00 + explicit 60 minutes is parsed without model", () => {
  const req = "พรุ่งนี้ 24 ตุลาคม เพิ่มกิจกรรมฝึก Code เวลา 15:00–16:00 ระยะเวลา 60 นาที ลงในตารางจริง";
  assert.deepEqual(parseScheduledAdd(req, "2026-10-23", refClock), {
    command: {
      type: "add", name: "ฝึก Code", date: tomorrowOfScreenshot,
      start: 900, duration: 60, fixed: false,
    },
  });
  assert.deepEqual(parseScheduledAdd(
    "พรุ่งนี้ เพิ่มกิจกรรมฝึก Code เวลา 15:00–16:00",
    "2026-10-23", refClock,
  )?.command?.duration, 60);
});

test("explicit day disagreement and duration mismatch are clarified without saving", () => {
  const wrongDate = parseScheduledAdd(
    "พรุ่งนี้ 25 ตุลาคม เพิ่มกิจกรรมฝึก Code เวลา 15:00–16:00 ระยะเวลา 60 นาที",
    "2026-10-23", refClock,
  );
  assert.match(wrongDate?.reason ?? "", /ไม่ตรงกัน/);
  const wrongDuration = parseScheduledAdd(
    "พรุ่งนี้ เพิ่มกิจกรรมฝึก Code เวลา 15:00–16:00 ระยะเวลา 30 นาที",
    "2026-10-23", refClock,
  );
  assert.match(wrongDuration?.reason ?? "", /ไม่ตรง/);
  assert.equal(parseScheduledAdd("พรุ่งนี้อยากรู้ว่าตารางว่างไหม", "2026-10-23", refClock), undefined);
});

test("clock-only Thai prompt asks duration and follow-up retains tomorrow at 15:00", () => {
  const request = "ฝึก code ช่วงบ่าย 15:00 พรุ่งนี้";
  const parsed = parseScheduledAdd(request, "2026-10-23", refClock);
  assert.match(parsed?.reason ?? "", /นานกี่นาที/);
  const followup = completeScheduledAdd([
    { role: "user", content: request },
    {
      role: "assistant", content: parsed!.reason!,
      outcome: "ยังไม่ได้เปลี่ยนตาราง · " + parsed!.reason!,
    },
  ], "60 นาที", "2026-10-23", refClock);
  assert.deepEqual(followup?.command, {
    type: "add", name: "ฝึก code", date: tomorrowOfScreenshot,
    start: 900, duration: 60, fixed: false,
  });
  assert.equal(completeScheduledAdd([], "60 นาที", "2026-10-23", refClock), undefined);
});

test("explicit-time add must never fall back to the first free morning slot", () => {
  const state = initial();
  state.settings.maxMinutes = 720;
  state.sessions.push({
    id: "busy", name: "Existing afternoon item", date: date,
    start: 900, duration: 60, status: "planned",
    reminder: 10, fixed: false,
  });
  assert.throws(() => executeCommands(state, [
    { type: "add", name: "ฝึก Code", date, start: 900, duration: 60, fixed: false },
  ], date, now), /15:00–16:00/);
  assert.equal(state.sessions.length, 1);
  const flexible = executeCommands(state, [
    { type: "add", name: "Flexible reading", date, duration: 60, fixed: false },
  ], date, now);
  assert.equal(flexible.sessions.length, 2);
  assert.equal(flexible.sessions[1].start, 480);
});

const runtimeTomorrow = new Date(Date.parse(today()) + 86400000)
  .toISOString().slice(0, 10);

test("chat commits exact 15:00–16:00 task and reports its validated receipt", async () => {
  const seed = initial();
  seed.settings.maxMinutes = 720;
  seed.sessions.push({
    id: "preceding", name: "Anime AI Companion", date: runtimeTomorrow,
    start: 825, duration: 60, fixed: false, status: "planned", reminder: 10,
  });
  const { p, ai } = fixture(seed);
  ai.plannerCompletion = async () => { throw new Error("should not ask AI to invent exact add time"); };
  const request = {
    ...dto,
    requestId: "strict-15:00",
    date: today(),
    message: `พรุ่งนี้ ${runtimeTomorrow} เพิ่มกิจกรรมฝึก Code เวลา 15:00–16:00 ระยะเวลา 60 นาที ลงในตารางจริง`,
  };
  // Chat parses tomorrow relative to the actual clock, not the 2030 test fixture clock.
  const response = await p.chat(request);
  assert.equal(response.message.outcome, "บันทึกตารางแล้ว");
  assert.match(response.message.content, /15:00–16:00/);
  assert.equal(response.message.appliedChanges.length, 1);
  assert.equal(response.message.appliedChanges[0].start, 900);
  assert.equal(response.message.appliedChanges[0].duration, 60);
  assert.equal(response.message.appliedChanges[0].date, runtimeTomorrow);
  assert.equal((await p.get()).sessions.find((x: any) => x.name === "ฝึก Code").start, 900);
  assert.equal((await p.chat(request)).message.id, response.message.id);
  assert.equal((await p.get()).sessions.length, 2);
});

test("exact-time conflict is a conversation rejection, never silently saves another slot", async () => {
  const seed = initial();
  seed.settings.maxMinutes = 720;
  seed.sessions.push({
    id: "busy", name: "Afternoon appointment", date: runtimeTomorrow,
    start: 900, duration: 60, fixed: true, status: "planned", reminder: 10,
  });
  const { p, ai } = fixture(seed);
  ai.plannerCompletion = async () => { throw new Error("explicit add should not need model"); };
  const reply = await p.chat({
    ...dto, date: today(), requestId: "conflicted-15",
    message: `พรุ่งนี้ ${runtimeTomorrow} เพิ่มกิจกรรมฝึก Code เวลา 15:00–16:00 ระยะเวลา 60 นาที`,
  });
  assert.match(reply.message.outcome, /ยังไม่ได้เปลี่ยนตาราง/);
  assert.match(reply.message.content, /15:00/);
  assert.ok(reply.message.followUps?.some((f: any) => f.label === "เสนอเวลาอื่น"));
  assert.equal(reply.message.appliedChanges, undefined);
  assert.equal((await p.get()).sessions.length, 1);
});

test("missing duration asks a follow-up rather than claiming to have saved an activity", async () => {
  const { p, ai } = fixture();
  ai.plannerCompletion = async () => { throw new Error("missing duration must bypass the model"); };
  const reply = await p.chat({
    ...dto, date: today(), requestId: "duration-not-given",
    message: "ฝึก code ช่วงบ่าย 15:00 พรุ่งนี้",
  });
  assert.match(reply.message.content, /นานกี่นาที/);
  assert.match(reply.message.outcome, /ยังไม่ได้เปลี่ยนตาราง/);
  assert.equal(reply.message.appliedChanges, undefined);
  assert.equal((await p.get()).sessions.length, 0);
});

test("unparsed explicit-clock add can never be saved at an arbitrary time by the model", async () => {
  const { p, ai } = fixture();
  ai.plannerCompletion = async () => {
    throw new Error("ambiguous explicit clock must bypass the model");
  };
  const result = await p.chat({
    ...dto, date: "2026-10-23", requestId: "unparsed-exact-time",
    message: "ถ้าฉันอยากเพิ่มฝึก Code ตอน 15:00 พรุ่งนี้ ทำได้ไหม?",
  });
  assert.match(result.message.outcome, /ยังไม่ได้เปลี่ยนตาราง/);
  assert.match(result.message.content, /ยังแยกชื่อกิจกรรม/);
  assert.equal(result.message.appliedChanges, undefined);
  assert.equal((await p.get()).sessions.length, 0);
});

test("exact-time request with missing duration may be completed through the next reply", async () => {
  const { p, ai } = fixture();
  ai.plannerCompletion = async () => {
    throw new Error("duration follow-up must preserve the original exact time");
  };
  const first = await p.chat({
    ...dto, date: today(), requestId: "needs-duration",
    message: "ฝึก code ช่วงบ่าย 15:00 พรุ่งนี้",
  });
  assert.match(first.message.outcome, /ยังไม่ได้เปลี่ยนตาราง/);
  const second = await p.chat({
    ...dto, date: today(), requestId: "provided-duration",
    message: "60 นาที",
  });
  assert.equal(second.message.outcome, "บันทึกตารางแล้ว");
  assert.equal(second.message.appliedChanges?.[0]?.start, 900);
  assert.equal(second.message.appliedChanges?.[0]?.duration, 60);
  assert.equal(second.message.appliedChanges?.[0]?.date, runtimeTomorrow);
});

function tomorrowWorkday() {
  const state = durationEditFixture();
  const tomorrow = new Date(Date.parse(today()) + 86400000)
    .toISOString().slice(0, 10);
  for (const s of state.sessions) s.date = tomorrow;
  return { state, tomorrow };
}

test("natural Thai duration edits resolve three synonymous requests to the SAME resize", () => {
  const { state, tomorrow } = tomorrowWorkday();
  for (const prompt of [
    "หางาน พรุ่งนี้ ขอเพียง 30 นาที",
    "พรุ่งนี้ลดหางานเหลือครึ่งชั่วโมง",
    "งานหางานเอาแค่ 30 นาทีพอ",
    "พรุ่งนี้ หางาน ขอแค่ 30 นาที",
  ]) {
    const parsed = parseConversationalDurationEdit(state, tomorrow, prompt);
    assert.deepEqual(parsed?.command, {
      type: "resize", id: "job", date: tomorrow, duration: 30,
    }, prompt);
    const updated = executeCommands(state, [parsed!.command!], tomorrow);
    assert.equal(updated.sessions.find((s) => s.id === "job")?.duration, 30);
    assert.equal(state.sessions.find((s) => s.id === "job")?.duration, 60);
  }
});

test("friendly Thai reductions are persisted by Planner chat without consulting Ollama unnecessarily", async () => {
  const { state, tomorrow } = tomorrowWorkday();
  const { p, ai } = fixture(state);
  ai.plannerCompletion = async () => {
    throw new Error("simple requests must not depend on model availability");
  };
  const request = {
    ...dto, date: tomorrow, requestId: "job-only-thirty",
    message: "หางาน พรุ่งนี้ ขอเพียง 30 นาที",
  };
  const reply = await p.chat(request);
  assert.equal(reply.message.outcome, "บันทึกตารางแล้ว");
  assert.match(reply.message.content, /60 นาที เหลือ 30 นาที/);
  assert.equal(reply.message.appliedChanges?.length, 1);
  assert.equal(reply.message.appliedChanges?.[0]?.id, "job");
  assert.equal(reply.message.appliedChanges?.[0]?.previousDuration, 60);
  assert.equal(reply.message.appliedChanges?.[0]?.duration, 30);
  const stateAfter = await p.get();
  assert.equal(stateAfter.sessions.find((s: any) => s.id === "job")?.duration, 30);
  assert.equal(stateAfter.sessions.length, 5);
  assert.equal((await p.chat(request)).message.id, reply.message.id);
});

test("Ollama can interpret nuanced Thai half-time edits; backend verifies the original text, date and ID", async () => {
  const { state, tomorrow } = tomorrowWorkday();
  const { p, ai } = fixture(state);
  let calls = 0;
  ai.plannerCompletion = async () => {
    calls++;
    if (calls === 1)
      return JSON.stringify({
        reply: "ขอเช็กคำขอนี้ก่อนนะคะ",
        actions: [],
      });
    return JSON.stringify({
      reply: "ลองลดเวลาหางานเป็นครึ่งหนึ่งให้นะคะ",
      actions: [{ type: "resize", id: "job", date: tomorrow, duration: 30 }],
    });
  };
  const response = await p.chat({
    ...dto, date: tomorrow, requestId: "ollama-half-job",
    message: "พรุ่งนี้อยากให้ตารางหางานสั้นลงเหลือแค่ครึ่งหนึ่งของเดิม",
  });
  assert.equal(calls, 2);
  assert.equal(response.message.outcome, "บันทึกตารางแล้ว");
  assert.equal(response.message.appliedChanges?.[0]?.duration, 30);
  assert.equal((await p.get()).sessions.find((s: any) => s.id === "job")?.duration, 30);
});

test("Ollama is never authorized to change the wrong session or invent a duration", async () => {
  const { state, tomorrow } = tomorrowWorkday();
  const { p, ai } = fixture(state);
  ai.plannerCompletion = async () => JSON.stringify({
    reply: "เรียบร้อยแล้วค่ะ",
    actions: [{ type: "resize", id: "learning", date: tomorrow, duration: 15 }],
  });
  const response = await p.chat({
    ...dto, date: tomorrow, requestId: "wrong-ollama-resize",
    message: "พรุ่งนี้อยากให้ตารางหางานสั้นลงเหลือแค่ครึ่งหนึ่งของเดิม",
  });
  assert.match(response.message.outcome, /ยังไม่ได้เปลี่ยนตาราง/);
  assert.equal(response.message.appliedChanges, undefined);
  assert.equal((await p.get()).sessions.find((s: any) => s.id === "job")?.duration, 60);
  assert.equal((await p.get()).sessions.find((s: any) => s.id === "learning")?.duration, 90);
});

test("duplicate names and impossible duration edits never guess which occurrence to change", () => {
  const { state, tomorrow } = tomorrowWorkday();
  state.sessions.push({ ...state.sessions.find((s) => s.id === "job")!,
    id: "job-again" });
  assert.match(
    parseConversationalDurationEdit(state, tomorrow, "หางาน พรุ่งนี้ ขอเพียง 30 นาที")
      ?.reason ?? "", /หลายรายการ/,
  );
  const original = state.sessions.pop()!;
  assert.equal(original.id, "job-again");
  const invalid = parseConversationalDurationEdit(state, tomorrow,
    "หางาน พรุ่งนี้ ขอเพียง 0 นาที");
  assert.match(invalid?.reason ?? "", /5–240/);
  const tiny = parseConversationalDurationEdit(state, tomorrow,
    "หางาน พรุ่งนี้ ขอเพียง 3 นาที");
  assert.match(tiny?.reason ?? "", /5–240/);
});

test("explicit relative increases and decreases do not confuse NEW TOTAL with delta", () => {
  const { state, tomorrow } = tomorrowWorkday();
  const plus = parseConversationalDurationEdit(state, tomorrow,
    "หางาน พรุ่งนี้ เพิ่มอีก 15 นาที");
  assert.equal(plus?.command?.duration, 75);
  const minus = parseConversationalDurationEdit(state, tomorrow,
    "หางาน พรุ่งนี้ ลดลง 15 นาที");
  assert.equal(minus?.command?.duration, 45);
  const set = parseConversationalDurationEdit(state, tomorrow,
    "หางาน พรุ่งนี้ เอาแค่ครึ่งชั่วโมงพอ");
  assert.equal(set?.command?.duration, 30);
});

test("Ollama output validator enforces a grounded target, duration and date", () => {
  const { state, tomorrow } = tomorrowWorkday();
  const command = { type: "resize" as const, id: "job", date: tomorrow, duration: 30 };
  assert.deepEqual(validateOllamaDurationEdit(
    state, tomorrow, "อยากให้เวลาหางานสั้นลงเหลือแค่ครึ่งหนึ่งของเดิม",
    [command],
  )?.command, command);
  assert.match(validateOllamaDurationEdit(
    state, tomorrow, "อยากให้เวลาหางานสั้นลงเหลือแค่ครึ่งหนึ่งของเดิม",
    [{ ...command, duration: 45 }],
  )?.reason ?? "", /ไม่ตรง/);
});

test("multiple mentioned durations choose the requested final total rather than the old one", () => {
  const { state, tomorrow } = tomorrowWorkday();
  const edit = parseConversationalDurationEdit(state, tomorrow,
    "พรุ่งนี้งานหางาน เดิม 60 นาที ขอเพียง 30 นาทีพอ");
  assert.equal(edit?.command?.duration, 30);
  const llm = validateOllamaDurationEdit(state, tomorrow,
    "พรุ่งนี้อยากให้เวลาหางานจาก 60 นาทีเหลือ 30 นาที",
    [{ type: "resize", id: "job", date: tomorrow, duration: 30 }]);
  assert.equal(llm?.command?.duration, 30);
});

test("a Thai question does not authorize a model-initiated calendar edit", () => {
  const { state, tomorrow } = tomorrowWorkday();
  const response = validateOllamaDurationEdit(state, tomorrow,
    "ลดเวลาหางานเหลือ 30 นาทีได้ไหม?",
    [{ type: "resize", id: "job", date: tomorrow, duration: 30 }]);
  assert.equal(response?.command, undefined);
  assert.match(response?.reason ?? "", /คำถาม/);
});

function exerciseBetweenCleaningAndJob() {
  const target = new Date(Date.parse(today()) + 86400000)
    .toISOString().slice(0, 10);
  const state = initial();
  state.settings.maxMinutes = 720;
  state.sessions = [
    { id: "clean", name: "ทำความสะอาดห้อง", start: 510, duration: 30 },
    { id: "job", name: "หางาน", start: 600, duration: 30 },
    { id: "exercise", name: "ออกกำลังกาย", start: 675, duration: 45 },
    { id: "project", name: "ปรับปรุง Anime AI Companion", start: 825, duration: 60 },
  ].map((entry) => ({
    ...entry, date: target, goalId: "daily:" + entry.id,
    status: "planned" as const, fixed: false, reminder: 10,
  }));
  return { state, target };
}

const exerciseNaturalRequest =
  "พรุ่งนี้ช่วง 9 โมง อยากออกกำลังกายซักครึ่งชั่วโมง ช่วยจัดการเวลา ให้มีเวลาพักหลังทำความสะอาดห้องเสร็จ และเตรียมตัวหางาน";

test("compound exercise request fits 09:15–09:45 between cleaning and job search with 15-minute breaks", () => {
  const { state, target } = exerciseBetweenCleaningAndJob();
  const parsed = parseExerciseWithBreaks(state, today(), exerciseNaturalRequest);
  assert.deepEqual(parsed?.command, {
    type: "edit", id: "exercise", date: target, start: 555, duration: 30,
  });
  // A compound reschedule is not a request to resize cleaning or job search.
  assert.equal(validateOllamaDurationEdit(
    state, today(), exerciseNaturalRequest, [
      { type: "edit", id: "exercise", date: target, start: 555, duration: 30 },
    ],
  ), undefined);
  const updated = executeCommands(state, [parsed!.command!], today());
  assert.equal(updated.sessions.length, 4);
  const exercise = updated.sessions.find((item) => item.id === "exercise");
  assert.equal(exercise?.start, 555);
  assert.equal(exercise?.duration, 30);
  assert.equal(updated.sessions.find((item) => item.id === "clean")?.start, 510);
  assert.equal(updated.sessions.find((item) => item.id === "job")?.start, 600);
  assert.equal(updated.sessions.find((item) => item.id === "project")?.start, 825);
  assert.equal(state.sessions.find((item) => item.id === "exercise")?.start, 675);
});

test("companion executes exercise+breaks plan without Ollama inventing a resize", async () => {
  const { state, target } = exerciseBetweenCleaningAndJob();
  const { p, ai } = fixture(state);
  ai.plannerCompletion = async () => {
    throw new Error("clearly grounded compound request should bypass model");
  };
  const request = { ...dto, date: today(), requestId: "exercise-nine-with-breaks",
    message: exerciseNaturalRequest };
  const reply = await p.chat(request);
  assert.equal(reply.message.outcome, "บันทึกตารางแล้ว");
  assert.match(reply.message.content, /09:15–09:45/);
  assert.equal(reply.message.appliedChanges?.length, 1);
  assert.deepEqual(reply.message.appliedChanges?.[0], {
    id: "exercise", name: "ออกกำลังกาย", date: target, start: 555,
    duration: 30, status: "planned", previousDuration: 45, kind: "updated",
  });
  const stored = await p.get();
  assert.equal(stored.sessions.length, 4);
  assert.equal(stored.sessions.find((item: any) => item.id === "exercise").start, 555);
  assert.equal((await p.chat(request)).message.id, reply.message.id);
});

test("compound exercise request never changes a fixed or ambiguous workout", () => {
  const { state, target } = exerciseBetweenCleaningAndJob();
  const fixed = structuredClone(state);
  fixed.sessions[2].fixed = true;
  assert.match(parseExerciseWithBreaks(fixed, target, exerciseNaturalRequest)?.reason ?? "",
    /ล็อก/);
  const duplicate = structuredClone(state);
  duplicate.sessions.push({ ...state.sessions[2], id: "exercise-duplicate" });
  assert.match(parseExerciseWithBreaks(duplicate, target, exerciseNaturalRequest)?.reason ?? "",
    /หลายรายการ/);
  const constrained = structuredClone(state);
  constrained.sessions[1].start = 570;
  assert.match(parseExerciseWithBreaks(constrained, target, exerciseNaturalRequest)?.reason ?? "",
    /ยังหาช่วง/);
  assert.equal(constrained.sessions.length, 4);
});

test("plain duration reductions still use the existing conversational resize validator", () => {
  const { state, target } = exerciseBetweenCleaningAndJob();
  const edit = parseConversationalDurationEdit(
    state, target, "หางาน พรุ่งนี้ ขอเพียง 20 นาที",
  );
  assert.equal(edit?.command?.type, "resize");
  assert.equal(edit?.command?.duration, 20);
});

function timeOnlyMoveDay(date = future) {
  const state = initial();
  state.settings.maxMinutes = 720;
  state.sessions = [
    { id: "code", name: "ฝึก code", start: 900, duration: 60, date,
      goalId: "daily:code", fixed: false, status: "planned" as const, reminder: 10 },
    { id: "job", name: "หางาน", start: 600, duration: 30, date,
      goalId: "daily:job", fixed: false, status: "planned" as const, reminder: 10 },
    { id: "reading", name: "อ่านหนังสือ", start: 1050, duration: 30, date,
      goalId: "daily:reading", fixed: false, status: "planned" as const, reminder: 10 },
  ];
  return state;
}

test("time-only Thai move preserves existing duration and other schedule slots", () => {
  const state = timeOnlyMoveDay();
  const parsed = parseExistingTimeMove(state, future, "เลื่อนฝึก code 16:00");
  assert.deepEqual(parsed?.command, {
    type: "edit", id: "code", date: future, start: 960, duration: 60,
    preserveOtherSlots: true,
  });
  const result = executeCommands(state, [parsed!.command!], future);
  assert.deepEqual(result.sessions.map((x) => [x.id, x.start, x.duration]), [
    ["code", 960, 60], ["job", 600, 30], ["reading", 1050, 30],
  ]);
  assert.equal(state.sessions[0].start, 900);
  assert.equal(result.sessions.length, 3);
});

test("time-only move accepts explicit relative day, absolute date and alternative verbs", () => {
  const tomorrow = new Date(Date.parse(today()) + 86400000).toISOString().slice(0, 10);
  const state = timeOnlyMoveDay(tomorrow);
  for (const msg of [
    "พรุ่งนี้ เลื่อนฝึก code ไป 16:00",
    "ย้ายฝึก code เป็น 16:00 พรุ่งนี้",
    "ช่วยเปลี่ยนเวลา ฝึก code เป็น 16:00",
    "เลื่อนฝึก code 16:00 " + tomorrow,
  ]) {
    const parsed = parseExistingTimeMove(state, tomorrow, msg);
    assert.equal(parsed?.command?.date, tomorrow, msg);
    assert.equal(parsed?.command?.start, 960, msg);
    assert.equal(parsed?.command?.duration, 60, msg);
  }
});

test("time-only move does not guess task ID or accept ambiguous names and times", () => {
  const state = timeOnlyMoveDay();
  const none = parseExistingTimeMove(state, future, "เลื่อนงานที่ไม่มี 16:00");
  assert.match(none?.reason ?? "", /ไม่พบกิจกรรม/);
  const dup = structuredClone(state);
  dup.sessions.push({ ...dup.sessions[0], id: "code-duplicate" });
  assert.match(parseExistingTimeMove(dup, future, "เลื่อนฝึก code 16:00")?.reason ?? "",
    /มากกว่าหนึ่งรายการ/);
  const unclear = parseExistingTimeMove(state, future, "เลื่อนฝึก code 16:00 ถึง 17:00");
  assert.match(unclear?.reason ?? "", /หลายค่า/);
  assert.equal(parseExistingTimeMove(state, future, "เลื่อนฝึก code 28:00")?.command, undefined);
  assert.equal(parseExistingTimeMove(state, future, "เลื่อนฝึก code 16:00 ได้ไหม?"), undefined);
});

test("a time-only move with a conflict never relocates another activity silently", () => {
  const state = timeOnlyMoveDay();
  state.sessions.push({
    id: "appointment", name: "ประชุม", start: 990, duration: 60, date: future,
    status: "planned", fixed: true, reminder: 10,
  });
  const action = parseExistingTimeMove(state, future, "เลื่อนฝึก code 16:00")!.command!;
  assert.throws(() => executeCommands(state, [action], future), /เลื่อนไป 16:00 ไม่ได้/);
  assert.equal(state.sessions[0].start, 900);
  assert.equal(state.sessions.find((x) => x.id === "appointment")?.start, 990);
});

test("chat correctly moves an existing code session to 16:00 and returns an actual receipt", async () => {
  const { p, ai } = fixture(timeOnlyMoveDay());
  ai.plannerCompletion = async () => {
    throw new Error("the local model should not invent duration for an exact existing-task move");
  };
  const request = { ...dto, requestId: "move-code-16", message: "เลื่อนฝึก code 16:00" };
  const first = await p.chat(request);
  assert.equal(first.message.outcome, "บันทึกตารางแล้ว");
  assert.match(first.message.content, /16:00–17:00/);
  assert.match(first.message.content, /กิจกรรมอื่นยังอยู่เวลาเดิม/);
  assert.equal(first.message.appliedChanges?.length, 1);
  assert.deepEqual(first.message.appliedChanges?.[0], {
    id: "code", name: "ฝึก code", date: future, start: 960, duration: 60,
    status: "planned", kind: "updated",
  });
  const saved = await p.get();
  assert.equal(saved.sessions.find((x: any) => x.id === "code")?.start, 960);
  assert.equal(saved.sessions.length, 3);
  assert.equal((await p.chat(request)).message.id, first.message.id);
  assert.equal((await p.get()).sessions.length, 3);
});

test("chat rejects a conflicting time-only move without saving or hiding original plan", async () => {
  const state = timeOnlyMoveDay();
  state.sessions.push({
    id: "appointment", name: "ประชุม", start: 990, duration: 60, date: future,
    status: "planned", fixed: true, reminder: 10,
  });
  const { p, ai } = fixture(state);
  ai.plannerCompletion = async () => {
    throw new Error("should be handled without the local model");
  };
  const result = await p.chat({
    ...dto, requestId: "move-code-conflict", message: "เลื่อนฝึก code 16:00",
  });
  assert.match(result.message.outcome ?? "", /ยังไม่ได้เปลี่ยนตาราง/);
  assert.match(result.message.content, /16:00/);
  assert.equal(result.message.appliedChanges, undefined);
  assert.equal((await p.get()).sessions.find((x: any) => x.id === "code")?.start, 900);
});

const threeNewLearningRequest =
  "okey ช่วยจัดเวลา ฝึก ติวสอบ TOEIC (Test of English for International Communication) และ ฝึกฟังภาษาอังกฤษจาก youtube และ ฝึก devoop";

function completedDayForLearning(date = future, limit = 720) {
  const state = initial();
  state.settings.maxMinutes = limit;
  state.sessions = [
    { id: "old-clean", name: "ทำความสะอาดห้อง", start: 550, duration: 30 },
    { id: "old-job", name: "หางาน", start: 675, duration: 30 },
    { id: "old-code", name: "ฝึก code", start: 900, duration: 60 },
  ].map((task) => ({
    ...task, date, goalId: "daily:" + task.id,
    status: "done" as const, fixed: false, reminder: 10,
  }));
  return state;
}

test("three new learning tasks are classified as ADD not modification of completed work", () => {
  const parsed = parseMultipleNewTasks(threeNewLearningRequest, future);
  assert.equal(parsed?.date, future);
  assert.deepEqual(parsed?.names, [
    "ติวสอบ TOEIC (Test of English for International Communication)",
    "ฝึกฟังภาษาอังกฤษจาก youtube",
    "ฝึก DevOps",
  ]);
  assert.deepEqual(parsed?.durations, [undefined, undefined, undefined]);
  assert.equal(parseMultipleNewTasks("วันนี้เหลืออะไรบ้าง", future), undefined);
  assert.equal(parseMultipleNewTasks("ช่วยจัดเวลา ติว TOEIC", future), undefined);
});

test("multiple new tasks require confirmation and preserve every completed session", async () => {
  const old = completedDayForLearning();
  const { p, ai } = fixture(old);
  ai.plannerCompletion = async () => {
    throw new Error("clear multi-add intent must not touch existing completed IDs");
  };
  const request = {
    ...dto, requestId: "multi-new-learning-tasks",
    message: threeNewLearningRequest, autoApply: true,
  };
  const response = await p.chat(request);
  assert.match(response.message.outcome ?? "", /รอยืนยันแผนเพิ่ม 3 กิจกรรม/);
  assert.match(response.message.content, /ติวสอบ TOEIC/);
  assert.match(response.message.content, /ฝึก DevOps/);
  assert.ok(response.proposal);
  const proposed = response.proposal!.sessions.filter((x: any) =>
    !old.sessions.some((y) => y.id === x.id));
  assert.equal(proposed.length, 3);
  assert.deepEqual(proposed.map((x: any) => x.duration), [30, 30, 30]);
  assert.ok(proposed.every((x: any) => x.date === future && x.status === "planned"));
  assert.ok(proposed.every((x: any, i: number) =>
    proposed.every((y: any, j: number) => i === j ||
      x.start + x.duration + 15 <= y.start ||
      x.start >= y.start + y.duration + 15)));
  assert.deepEqual((await p.get()).sessions, old.sessions);
  const retry = await p.chat(request);
  assert.equal(retry.message.id, response.message.id);
  await p.confirm(response.proposal!.id);
  const saved = await p.get();
  assert.equal(saved.sessions.length, 6);
  assert.deepEqual(saved.sessions.filter((x: any) =>
    x.id.startsWith("old-")), old.sessions);
});

test("multi-add defaults to 20-minute sessions when 30-minute sessions exceed a safe limit", async () => {
  const { p, ai } = fixture(completedDayForLearning(future, 190));
  ai.plannerCompletion = async () => {
    throw new Error("multi-add needs no model-generated IDs");
  };
  const response = await p.chat({
    ...dto, requestId: "multi-20min-preview",
    message: threeNewLearningRequest,
  });
  assert.ok(response.proposal);
  const proposed = response.proposal!.sessions.filter((x: any) =>
    !x.id.startsWith("old-"));
  assert.equal(proposed.length, 3);
  assert.deepEqual(proposed.map((x: any) => x.duration), [20, 20, 20]);
  assert.equal((await p.get()).sessions.length, 3);
});

test("multi-add with no feasible slots reports a conflict, not 'กิจกรรมนี้บันทึกผลแล้ว'", async () => {
  const state = completedDayForLearning(future, 140);
  const { p, ai } = fixture(state);
  ai.plannerCompletion = async () => {
    throw new Error("should be handled by validated batch proposals");
  };
  const result = await p.chat({
    ...dto, requestId: "multi-conflict",
    message: threeNewLearningRequest,
  });
  assert.match(result.message.outcome ?? "", /ยังไม่ได้เปลี่ยนตาราง/);
  assert.doesNotMatch(result.message.content, /กิจกรรมนี้บันทึกผลแล้ว/);
  assert.equal(result.proposal, undefined);
  assert.equal((await p.get()).sessions.length, 3);
});

const quotedEveningRequest = [
  "• ติวสอบ TOEIC (Test of English for International Communication) 17:30–18:00 (30 นาที)",
  "• ฝึกฟังภาษาอังกฤษจาก youtube 18:15–18:45 (30 นาที)",
  "• ฝึก devoop ; ตอนกลางคืนที่ 19:00–19:30 (30 นาที)",
  "ย้ายไปที่ เริ่ม ตั้งแต่ 2 ทุ่ม",
].join("\n");

test("pasted draft with three old slots can be shifted to 20:00 preserving 15-minute breaks", () => {
  const state = completedDayForLearning();
  const shifted = parseGroupShiftPlan(state, future, quotedEveningRequest);
  assert.deepEqual(shifted?.actions?.map((x) => ({
    name: x.name, start: x.start, duration: x.duration, date: x.date,
  })), [
    { name: "ติวสอบ TOEIC (Test of English for International Communication)",
      start: 1200, duration: 30, date: future },
    { name: "ฝึกฟังภาษาอังกฤษจาก youtube",
      start: 1245, duration: 30, date: future },
    { name: "ฝึก DevOps",
      start: 1290, duration: 30, date: future },
  ]);
  const result = executeCommands(state, shifted!.actions!, future);
  assert.equal(result.sessions.length, 6);
  assert.deepEqual(result.sessions.slice(0, 3), state.sessions);
  assert.deepEqual(result.sessions.slice(3).map((x) => x.start),
    [1200, 1245, 1290]);
  assert.equal(result.sessions[5].start + result.sessions[5].duration, 1320);
});

test("follow-up to pending plan uses proposal task names and durations instead of guessing", () => {
  const state = completedDayForLearning();
  const pending = [
    { name: "ติวสอบ TOEIC", start: 1035, duration: 30 },
    { name: "ฝึกฟังภาษาอังกฤษ YouTube", start: 1095, duration: 30 },
    { name: "ฝึก DevOps", start: 1140, duration: 30 },
  ].map((x, index) => ({
    ...x, id: "draft-" + index, date: future,
    goalId: "daily:draft-" + index, status: "planned" as const,
    fixed: false, reminder: 10,
  }));
  const onlyShift = parseGroupShiftPlan(
    state, future, "ย้ายไปเริ่มตั้งแต่ 2 ทุ่ม", pending,
  );
  assert.deepEqual(onlyShift?.actions?.map((x) => x.start),
    [1200, 1245, 1290]);
  assert.deepEqual(onlyShift?.actions?.map((x) => x.name),
    pending.map((x) => x.name));
  assert.match(parseGroupShiftPlan(state, future,
    quotedEveningRequest, pending)?.reason ?? "", /ไม่ตรงกับแผน/);
});

test("shifted multi-task group refuses invalid rest, past bedtime or existing named tasks", () => {
  const state = completedDayForLearning();
  state.settings.sleep = 1290;
  assert.match(parseGroupShiftPlan(state, future, quotedEveningRequest)
    ?.reason ?? "", /เกินเวลาเข้านอน/);
  const duplicate = completedDayForLearning();
  duplicate.sessions.push({
    id: "existing-toeic", name: "ติวสอบ TOEIC (Test of English for International Communication)",
    start: 1110, duration: 30, date: future, fixed: false,
    status: "planned", reminder: 10,
  });
  assert.match(parseGroupShiftPlan(duplicate, future, quotedEveningRequest)
    ?.reason ?? "", /มีอยู่ในตารางจริง/);
  assert.match(parseGroupShiftPlan(completedDayForLearning(), future,
    "ย้ายไปเริ่มตั้งแต่ 2 ทุ่ม")?.reason ?? "", /ยังไม่พบแผน/);
  assert.equal(parseGroupShiftPlan(completedDayForLearning(), future,
    "อยากให้ลองจัด TOEIC ไหม?"), undefined);
});

test("Yuna replaces a prior proposal with an 8pm multi-task preview and confirms it safely", async () => {
  const original = completedDayForLearning();
  const { p, ai } = fixture(original);
  ai.plannerCompletion = async () => {
    throw new Error("pending multi-task shift should not need Ollama to invent task IDs");
  };
  const first = await p.chat({
    ...dto, requestId: "initial-three-slot-proposal",
    message: threeNewLearningRequest, autoApply: true,
  });
  assert.ok(first.proposal);
  assert.equal((await p.get()).sessions.length, 3);
  const shifted = await p.chat({
    ...dto, requestId: "move-group-to-20",
    message: "ย้ายไปที่ เริ่ม ตั้งแต่ 2 ทุ่ม", autoApply: true,
  });
  assert.match(shifted.message.outcome ?? "", /รอยืนยันแผนเพิ่ม 3 กิจกรรม/);
  assert.match(shifted.message.content, /20:00–20:30/);
  assert.match(shifted.message.content, /20:45–21:15/);
  assert.match(shifted.message.content, /21:30–22:00/);
  assert.ok(shifted.proposal);
  assert.notEqual(shifted.proposal!.id, first.proposal!.id);
  assert.deepEqual((await p.get()).sessions, original.sessions);
  const retry = await p.chat({
    ...dto, requestId: "move-group-to-20",
    message: "ย้ายไปที่ เริ่ม ตั้งแต่ 2 ทุ่ม", autoApply: true,
  });
  assert.equal(retry.message.id, shifted.message.id);
  await p.confirm(shifted.proposal!.id);
  const saved = await p.get();
  assert.deepEqual(saved.sessions.slice(0, 3), original.sessions);
  assert.deepEqual(saved.sessions.slice(3).map((x: any) => x.start),
    [1200, 1245, 1290]);
  assert.equal(saved.sessions.length, 6);
});

test("copied multi-activity plan builds a preview without an active proposal", async () => {
  const original = completedDayForLearning();
  const { p, ai } = fixture(original);
  ai.plannerCompletion = async () => {
    throw new Error("quoted group shift must not be parsed as a single add");
  };
  const response = await p.chat({
    ...dto, requestId: "quoted-three-slot-evening",
    message: quotedEveningRequest,
  });
  assert.ok(response.proposal);
  assert.match(response.message.outcome ?? "", /รอยืนยันแผนเพิ่ม 3 กิจกรรม/);
  assert.equal(response.proposal!.sessions.length, 6);
  assert.equal((await p.get()).sessions.length, 3);
});

test("multi-task group collision returns a truthful refusal without changing completed tasks", async () => {
  const state = completedDayForLearning();
  state.sessions.push({
    id: "reserved", name: "นัดคงที่", date: future, start: 1245,
    duration: 30, fixed: true, status: "planned", reminder: 10,
  });
  const { p, ai } = fixture(state);
  ai.plannerCompletion = async () => {
    throw new Error("group shift conflict must not fall through to Ollama");
  };
  const response = await p.chat({
    ...dto, requestId: "conflicted-group-shift",
    message: quotedEveningRequest,
  });
  assert.match(response.message.outcome ?? "", /ยังไม่ได้เปลี่ยนตาราง/);
  assert.match(response.message.content, /ยังย้ายแผนทั้งชุด/);
  assert.equal(response.proposal, undefined);
  assert.deepEqual((await p.get()).sessions, state.sessions);
});

const fiveTomorrowRequests =
  "พรุ้งนี้ อยาก ออกกำลังกาย ,อ่านข่าว bbc, ทำความสะอาดห้อง ,เรียน coding และ ทำ assignment for software developer position ของ Playtorium จัดเวลาให้ที";
const askAlternative =
  "ช่วยเสนอช่วงเวลาอื่นที่ไม่ชนตารางเดิมและเป็นไปตามข้อจำกัด โดยยังไม่เปลี่ยนตารางเดิม";
const tomorrowFromNow = new Date(Date.parse(today()) + 86400000)
  .toISOString().slice(0, 10);

test("comma+and five-task Thai request is a clear batch even with prefix and suffix planning verbs", () => {
  const parsed = parseMultipleNewTasks(fiveTomorrowRequests, today());
  assert.equal(parsed?.date, tomorrowFromNow);
  assert.deepEqual(parsed?.names, [
    "ออกกำลังกาย", "อ่านข่าว bbc", "ทำความสะอาดห้อง",
    "เรียน coding", "ทำ assignment for software developer position ของ Playtorium",
  ]);
  assert.deepEqual(parsed?.durations, [undefined, undefined, undefined, undefined, undefined]);
  assert.equal(parseMultipleNewTasks(
    "อยากรู้ว่าวันพรุ่งนี้ตารางมีอะไรไหม?", today()), undefined);
  assert.equal(parseMultipleNewTasks(
    "ช่วยจัดเวลา ออกกำลังกาย และ อ่านข่าว bbc เวลา 09:00", today()), undefined);
});

test("the empty next-day calendar fits all 5 activities and must offer a validated preview", async () => {
  const state = initial();
  state.settings.maxMinutes = 720;
  state.settings.sleep = 1260;
  const { p, ai } = fixture(state);
  ai.plannerCompletion = async () => {
    throw new Error("clear five-task requests must not rely on the local model's inaccurate full-day claim");
  };
  const response = await p.chat({
    ...dto, requestId: "five-tomorrow-preview", date: today(),
    message: fiveTomorrowRequests, autoApply: true,
  });
  assert.match(response.message.outcome ?? "", /รอยืนยันแผนเพิ่ม 5 กิจกรรม/);
  assert.match(response.message.content, /ออกกำลังกาย/);
  assert.match(response.message.content, /Playtorium/);
  assert.match(response.message.content, /30 นาที/);
  assert.ok(response.proposal);
  const tasks = response.proposal!.sessions.filter((item: any) =>
    item.date === tomorrowFromNow && item.status === "planned");
  assert.equal(tasks.length, 5);
  assert.deepEqual(tasks.map((item: any) => item.duration), [30, 30, 30, 30, 30]);
  for (let i = 1; i < tasks.length; i++)
    assert.ok(tasks[i].start >= tasks[i-1].start + tasks[i-1].duration + 15);
  assert.equal(tasks.reduce((minutes: number, item: any) => minutes + item.duration, 0), 150);
  assert.equal((await p.get()).sessions.length, 0);
});

test("free-time follow-up offers a DISTINCT later proposal without changing the original schedule", async () => {
  const state = initial();
  state.settings.maxMinutes = 720;
  const { p, ai } = fixture(state);
  ai.plannerCompletion = async () => {
    throw new Error("concrete free-time follow-up should not need the model to invent times");
  };
  const first = await p.chat({
    ...dto, requestId: "first-five-tasks", date: today(),
    message: fiveTomorrowRequests, autoApply: true,
  });
  assert.ok(first.proposal);
  const second = await p.chat({
    ...dto, requestId: "alternative-five-tasks", date: today(),
    message: askAlternative, autoApply: true,
  });
  assert.match(second.message.outcome ?? "", /รอยืนยันแผนเพิ่ม 5 กิจกรรม/);
  assert.match(second.message.content, /เสนอช่วงเวลาใหม่/);
  assert.ok(second.proposal);
  assert.notEqual(first.proposal!.id, second.proposal!.id);
  assert.equal(second.proposal!.sessions.length, 5);
  assert.ok(second.proposal!.sessions[0].start > first.proposal!.sessions[0].start);
  assert.equal((await p.get()).sessions.length, 0);
  await p.confirm(second.proposal!.id);
  const saved = await p.get();
  assert.equal(saved.sessions.length, 5);
  assert.deepEqual(saved.sessions.map((item: any) => item.id),
    second.proposal!.sessions.map((item: any) => item.id));
});

test("free-time follow-up can recover previous user batch after a legacy Ollama refusal", async () => {
  const state = initial() as any;
  state.settings.maxMinutes = 720;
  state.chats = {
    yuna: [
      { id: "legacy-request", role: "user", content: fiveTomorrowRequests,
        createdAt: new Date().toISOString() },
      { id: "legacy-refusal", role: "assistant",
        content: "พรุ่งนี้กิจกรรมทั้งหมดชนกัน จัดตารางไม่ได้ ต้องเสนอเวลาอื่น",
        outcome: "คำตอบจาก Yuna", createdAt: new Date().toISOString() },
    ],
  };
  assert.deepEqual(
    parseBatchAlternativeFollowUp(state.chats.yuna, askAlternative, today())?.names,
    parseMultipleNewTasks(fiveTomorrowRequests, today())?.names,
  );
  const { p, ai } = fixture(state);
  ai.plannerCompletion = async () => {
    throw new Error("do not repeat unsupported capacity refusals on an empty day");
  };
  const response = await p.chat({
    ...dto, requestId: "legacy-alternative-five", date: today(),
    message: askAlternative, autoApply: true,
  });
  assert.ok(response.proposal);
  assert.equal(response.proposal!.sessions.length, 5);
  assert.match(response.message.content, /ยูนะตรวจตารางจริงแล้ว/);
  assert.equal((await p.get()).sessions.length, 0);
});

test("five-task free-time request rejects truly insufficient capacity without fabricated success", async () => {
  const state = initial();
  state.settings.maxMinutes = 60;
  const { p, ai } = fixture(state);
  ai.plannerCompletion = async () => {
    throw new Error("insufficient capacity must be explained by deterministic validation");
  };
  const response = await p.chat({
    ...dto, requestId: "five-not-fit", date: today(), message: fiveTomorrowRequests,
  });
  assert.match(response.message.outcome ?? "", /ยังไม่ได้เปลี่ยนตาราง/);
  assert.match(response.message.content, /ยังจัดกิจกรรมใหม่ทั้ง 5 รายการ/);
  assert.equal(response.proposal, undefined);
  assert.equal((await p.get()).sessions.length, 0);
});

function draggableDay(date = future) {
  const state = initial();
  state.settings.maxMinutes = 720;
  state.settings.sleep = 1320;
  state.sessions = [
    { id: "exercise", name: "ออกกำลังกาย", start: 480, duration: 30 },
    { id: "bbc", name: "อ่านข่าว BBC", start: 525, duration: 15 },
    { id: "cleaning", name: "ทำความสะอาดห้อง", start: 555, duration: 15 },
    { id: "coding", name: "เรียน coding", start: 585, duration: 30 },
    { id: "playtorium", name: "Assignment Playtorium", start: 630, duration: 120 },
  ].map((item) => ({
    ...item, date, goalId: "daily:" + item.id, fixed: false,
    status: "planned" as const, reminder: 10,
  }));
  return state;
}

test("drag swap exercise with BBC reflows durations and at least 15 minutes rest", () => {
  const state = draggableDay();
  const result = swapDaySessions(state, future, "exercise", "bbc");
  const sorted = result.sessions
    .filter((item) => item.date === future)
    .sort((a, b) => a.start - b.start);
  assert.deepEqual(sorted.map((item) => [item.id, item.start, item.duration]), [
    ["bbc", 480, 15],
    ["exercise", 525, 30],
    ["cleaning", 570, 15],
    ["coding", 600, 30],
    ["playtorium", 645, 120],
  ]);
  assert.equal(result.changed.length, 5);
  assert.equal(sorted.reduce((sum, item) => sum + item.duration, 0), 210);
  for (let i = 1; i < sorted.length; i++)
    assert.ok(sorted[i].start - (sorted[i - 1].start + sorted[i - 1].duration) >= 15);
  assert.equal(state.sessions.find((item) => item.id === "exercise")!.start, 480);
});

test("drag swap through the service persists and survives a new get() without new tasks", async () => {
  const state = draggableDay();
  const { p } = fixture(state);
  const original = await p.get();
  const response = await p.swapSessions({
    date: future, sourceId: "exercise", targetId: "bbc",
    expectedRevision: original.revision,
  });
  assert.equal(response.ok, true);
  assert.equal(response.revision, original.revision + 1);
  assert.ok(response.changed.some((item: any) =>
    item.id === "exercise" && item.start === 525));
  const refreshed = await p.get();
  assert.equal(refreshed.revision, 1);
  assert.equal(refreshed.sessions.length, 5);
  assert.equal(refreshed.sessions.find((item: any) => item.id === "bbc").start, 480);
  assert.equal(refreshed.sessions.find((item: any) => item.id === "exercise").start, 525);
  assert.equal((await p.history("yuna")).length, 0);
});

test("drag swap invalidates pending proposals and rejects stale revisions atomically", async () => {
  const { p } = fixture(draggableDay());
  const proposal = await p.propose({ date: future, energy: "normal" });
  await p.swapSessions({ date: future, sourceId: "exercise",
    targetId: "bbc", expectedRevision: 0 });
  await assert.rejects(() => p.confirm(proposal.id), /หมดอายุ|ข้อมูลเปลี่ยน/);
  await assert.rejects(() => p.swapSessions({ date: future,
    sourceId: "bbc", targetId: "exercise", expectedRevision: 0 }), /ตารางมีการเปลี่ยนแปลง/);
  assert.equal((await p.get()).revision, 1);
  assert.equal((await p.get()).sessions.find((s: any) => s.id === "bbc").start, 480);
});

test("drag swaps respect completed tasks, fixed appointments and future starts", async () => {
  const completed = draggableDay();
  completed.sessions[1].status = "done";
  assert.throws(() => swapDaySessions(completed, future, "exercise", "bbc"), /ยังไม่เสร็จ/);
  const fixed = draggableDay();
  fixed.sessions[1].fixed = true;
  assert.throws(() => swapDaySessions(fixed, future, "exercise", "cleaning"), /สลับข้าม/);
  const alreadyStarted = draggableDay();
  assert.throws(() => swapDaySessions(
    alreadyStarted, future, "exercise", "bbc",
    Date.parse(future + "T08:10:00+07:00"),
  ), /ยังไม่เริ่ม/);
  const { p } = fixture(completed);
  await assert.rejects(() => p.swapSessions({ date: future,
    sourceId: "exercise", targetId: "bbc", expectedRevision: 0 }));
  assert.equal((await p.get()).revision, 0);
});

test("drag swap outside bedtime rejects entire mutation, no partial rescheduling", async () => {
  const seed = draggableDay();
  seed.settings.sleep = 750; // last existing task ends at 12:30
  const snapshot = structuredClone(seed.sessions);
  assert.throws(() => swapDaySessions(seed, future, "exercise", "bbc"), /เวลาตื่น–นอน/);
  assert.deepEqual(seed.sessions, snapshot);
  const { p } = fixture(seed);
  await assert.rejects(() => p.swapSessions({
    date: future, sourceId: "exercise", targetId: "bbc", expectedRevision: 0,
  }), /เวลาตื่น–นอน/);
  assert.deepEqual((await p.get()).sessions, snapshot);
});

test("drag swap rejects wrong date, same task, and missing targets", () => {
  const state = draggableDay();
  assert.throws(() => swapDaySessions(state, future, "exercise", "exercise"), /กิจกรรมอื่น/);
  assert.throws(() => swapDaySessions(state, future, "exercise", "bad-id"), /ไม่พบสล็อต/);
  assert.throws(() => swapDaySessions(state, "2020-01-01", "exercise", "bbc"), /วันนี้หรือวันในอนาคต/);
});

test("inline time edit can update one task duration without changing any other card", () => {
  const seed = draggableDay();
  const edited = editDaySessionTime(seed, "bbc", future, 525, 10);
  assert.equal(edited.start, 525);
  assert.equal(edited.duration, 10);
  assert.equal(edited.id, "bbc");
  assert.equal(seed.sessions.find((x) => x.id === "bbc")?.duration, 15);
  assert.equal(seed.sessions.find((x) => x.id === "exercise")?.start, 480);
});

test("inline time edit can change start and duration, persist and reflect revised end", async () => {
  const seed = draggableDay();
  const { p } = fixture(seed);
  const prior = await p.get();
  const response = await p.editSessionTime("playtorium", {
    date: future, start: 645, duration: 90,
    expectedRevision: prior.revision,
  });
  assert.equal(response.ok, true);
  assert.equal(response.revision, 1);
  assert.deepEqual(response.session, {
    id: "playtorium", date: future, name: "Assignment Playtorium",
    start: 645, duration: 90, status: "planned",
  });
  const reloaded = await p.get();
  assert.equal(reloaded.sessions.find((x: any) => x.id === "playtorium").start, 645);
  assert.equal(reloaded.sessions.find((x: any) => x.id === "playtorium").duration, 90);
  assert.equal(reloaded.sessions.length, 5);
  assert.deepEqual(reloaded.sessions.filter((x: any) => x.id !== "playtorium"),
    prior.sessions.filter((x: any) => x.id !== "playtorium"));
});

test("inline time edit rejects overlap, insufficient breaks and sleep violations atomically", async () => {
  const seed = draggableDay();
  const { p } = fixture(seed);
  const before = await p.get();
  for (const [start, duration] of [
    [510, 15], // Exercise ends 08:30; 08:30 collides with rest
    [525, 35], // BBC overlaps cleaning at 09:15
    [1290, 120], // Beyond 22:00 bedtime
  ]) {
    await assert.rejects(() => p.editSessionTime("bbc", {
      date: future, start, duration, expectedRevision: 0,
    }), /เวลาที่แก้ชนกิจกรรมอื่น/);
  }
  const after = await p.get();
  assert.deepEqual(after.sessions, before.sessions);
  assert.equal(after.revision, before.revision);
});

test("inline editor rejects completed, fixed, started sessions and wrong date", async () => {
  const seed = draggableDay();
  seed.sessions[0].status = "done";
  seed.sessions[2].fixed = true;
  const { p } = fixture(seed);
  await assert.rejects(() => p.editSessionTime("exercise", {
    date: future, start: 480, duration: 20, expectedRevision: 0,
  }), /ยังรอทำ/);
  await assert.rejects(() => p.editSessionTime("cleaning", {
    date: future, start: 570, duration: 15, expectedRevision: 0,
  }), /ยังรอทำ/);
  const otherValidDate = new Date(Date.parse(future) + 86400000)
    .toISOString().slice(0, 10);
  await assert.rejects(() => p.editSessionTime("bbc", {
    date: otherValidDate, start: 525, duration: 10, expectedRevision: 0,
  }), /ไม่พบกิจกรรมในวันที่เลือก/);
  assert.equal((await p.get()).revision, 0);
  const overdue = draggableDay();
  const atEightOhFive = Date.parse(future + "T08:05:00+07:00");
  const movedOverdue = editDaySessionTime(
    overdue, "exercise", future, 495, 15, atEightOhFive,
  );
  assert.equal(movedOverdue.start, 495);
  assert.equal(movedOverdue.status, "planned");
  assert.throws(() => editDaySessionTime(
    overdue, "exercise", future, 480, 15, atEightOhFive,
  ), /ยังมาไม่ถึง/);
});

test("inline time edit refuses invalid durations and capacity growth", async () => {
  const seed = draggableDay();
  const { p } = fixture(seed);
  assert.throws(() => editDaySessionTime(
    seed, "bbc", future, 525, 241,
  ), /5–240/);
  assert.throws(() => editDaySessionTime(
    seed, "bbc", future, 525, 0,
  ), /5–240/);
  assert.throws(() => editDaySessionTime(
    seed, "bbc", future, 525, 15,
  ), /เหมือนเดิม/);
  const lowCap = draggableDay();
  lowCap.settings.maxMinutes = 210;
  // Only 15 minutes for BBC originally; attempting to grow a flexible task
  // beyond the capacity limit must not be persisted.
  lowCap.sessions = lowCap.sessions.filter((s) => s.id === "bbc");
  lowCap.sessions.push({
    id: "long-study", name: "Study", date: future,
    start: 600, duration: 200, fixed: false,
    status: "planned", reminder: 10,
  });
  assert.throws(() => editDaySessionTime(lowCap, "bbc", future, 525, 20),
    /เพดาน/);
  await assert.rejects(() => p.editSessionTime("bbc", {
    date: future, start: 525, duration: 241, expectedRevision: 0,
  }), /5–240/);
  assert.equal((await p.get()).revision, 0);
});

test("inline editor rejects optimistic revision conflicts and invalidates old proposals", async () => {
  const { p } = fixture(draggableDay());
  const proposed = await p.propose({ date: future, energy: "normal" });
  await p.editSessionTime("bbc", {
    date: future, start: 525, duration: 10, expectedRevision: 0,
  });
  await assert.rejects(() => p.confirm(proposed.id), /หมดอายุ|ข้อมูลเปลี่ยน/);
  await assert.rejects(() => p.editSessionTime("bbc", {
    date: future, start: 525, duration: 5, expectedRevision: 0,
  }), /ตารางมีการเปลี่ยนแปลงแล้ว/);
  assert.equal((await p.get()).sessions.find((x: any) => x.id === "bbc").duration, 10);
});

test("the exact BBC screenshot phrase strips ไปเวลา and resolves the existing activity", () => {
  const date = "2026-10-25";
  const atEightFortyFour = Date.parse(date + "T08:44:00+07:00");
  const state = initial();
  state.settings.maxMinutes = 720;
  state.sessions = [
    { id: "bbc", name: "อ่านข่าว bbc", date, start: 480, duration: 15,
      fixed: false, status: "planned", reminder: 10 },
    { id: "clean", name: "ทำความสะอาดห้อง", date, start: 615, duration: 15,
      fixed: false, status: "planned", reminder: 10 },
    { id: "assignment", name: "Assignment Playtorium", date, start: 915, duration: 120,
      fixed: false, status: "planned", reminder: 10 },
    { id: "coding", name: "เรียน coding", date, start: 1290, duration: 30,
      fixed: false, status: "planned", reminder: 10 },
  ];
  const parsed = parseExistingTimeMove(
    state, date, "เลื่อน อ่านข่าว bbc ไปเวลา 08:55", atEightFortyFour,
  );
  assert.deepEqual(parsed?.command, {
    type: "edit", id: "bbc", date, start: 535, duration: 15,
    preserveOtherSlots: true,
  });
  const next = executeCommands(
    state, [parsed!.command!], date, atEightFortyFour,
  );
  assert.equal(next.sessions.length, 4);
  assert.deepEqual(next.sessions.find((x) => x.id === "bbc"), {
    ...state.sessions[0], start: 535, notified: false,
  });
  assert.deepEqual(next.sessions.slice(1), state.sessions.slice(1));
  assert.equal(state.sessions[0].start, 480);
});

test("time-only rescheduling resolves common Thai prepositions as clock markers", () => {
  const date = new Date(Date.parse(today()) + 86400000)
    .toISOString().slice(0, 10);
  const seed = timeOnlyMoveDay(date);
  seed.sessions[0].name = "อ่านข่าว BBC";
  for (const phrase of [
    "เลื่อน อ่านข่าว bbc ไปเวลา 16:00",
    "เลื่อน อ่านข่าว BBC เป็นเวลา 16:00",
    "ขอย้าย อ่านข่าว BBC ไปที่ 16:00",
    "เปลี่ยนเวลา อ่านข่าว BBC เป็น 16:00",
    "อ่านข่าว BBC เลื่อนไปเวลา 16:00",
  ]) {
    const result = parseExistingTimeMove(seed, date, phrase);
    assert.equal(result?.command?.id, "code", phrase);
    assert.equal(result?.command?.start, 960, phrase);
    assert.equal(result?.command?.duration, 60, phrase);
  }
});

test("overdue planned work is movable to future, but completed and skipped work is protected", () => {
  const date = "2026-10-25";
  const now = Date.parse(date + "T08:44:00+07:00");
  const seed = initial();
  seed.settings.maxMinutes = 720;
  seed.sessions = [{
    id: "bbc", name: "อ่านข่าว BBC", date, start: 480, duration: 15,
    fixed: false, status: "planned", reminder: 10,
  }];
  const request = "เลื่อน อ่านข่าว BBC ไปเวลา 08:55";
  const cmd = parseExistingTimeMove(seed, date, request, now)!.command!;
  assert.equal(executeCommands(seed, [cmd], date, now).sessions[0].start, 535);
  assert.equal(editDaySessionTime(seed, "bbc", date, 535, 15, now).start, 535);
  assert.match(parseExistingTimeMove(seed, date,
    "เลื่อน อ่านข่าว BBC ไปเวลา 08:35", now)?.reason ?? "", /ผ่านไปแล้ว/);
  assert.throws(() => editDaySessionTime(seed, "bbc", date, 520, 15, now),
    /ยังมาไม่ถึง/);
  for (const status of ["done", "skipped"] as const) {
    const blocked = structuredClone(seed);
    blocked.sessions[0].status = status;
    const parse = parseExistingTimeMove(blocked, date, request, now);
    assert.match(parse?.reason ?? "", /บันทึกผลแล้ว/);
    assert.throws(() => editDaySessionTime(blocked, "bbc", date, 535, 15, now),
      /ยังรอทำ/);
    assert.deepEqual(blocked.sessions[0], { ...seed.sessions[0], status });
  }
  const fixed = structuredClone(seed);
  fixed.sessions[0].fixed = true;
  assert.match(parseExistingTimeMove(fixed, date, request, now)?.reason ?? "", /ล็อกเวลา/);
});

test("overdue BBC move still rejects collisions without moving other sessions", () => {
  const date = "2026-10-25";
  const now = Date.parse(date + "T08:44:00+07:00");
  const state = initial();
  state.settings.maxMinutes = 720;
  state.sessions = [
    { id: "bbc", name: "อ่านข่าว bbc", date, start: 480,
      duration: 15, status: "planned", fixed: false, reminder: 10 },
    { id: "meeting", name: "ประชุม", date, start: 540,
      duration: 30, status: "planned", fixed: true, reminder: 10 },
  ];
  const cmd = parseExistingTimeMove(
    state, date, "เลื่อน อ่านข่าว bbc ไปเวลา 08:55", now,
  )!.command!;
  assert.throws(() => executeCommands(state, [cmd], date, now),
    /เลื่อนไป 08:55 ไม่ได้/);
  assert.equal(state.sessions[0].start, 480);
  assert.equal(state.sessions[1].start, 540);
});

const screenshotDay = "2026-10-25";
const screenshotMorning = Date.parse("2026-10-25T08:44:00+07:00");
function insertExerciseSeed(date = screenshotDay) {
  const state = initial();
  state.settings.maxMinutes = 240;
  state.settings.sleep = 1320;
  state.sessions = [
    { id: "bbc", name: "อ่านข่าว bbc", start: 540, duration: 15 },
    { id: "clean", name: "ทำความสะอาดห้อง", start: 615, duration: 15 },
    { id: "assignment", name: "ทำ Assignment Playtorium", start: 915, duration: 120 },
    { id: "coding", name: "เรียน coding", start: 1290, duration: 30 },
  ].map((task) => ({
    ...task, goalId: "daily:" + task.id, date,
    status: "planned" as const, fixed: false, reminder: 10,
  }));
  return state;
}

test("availability question calculates 30 usable exercise minutes between BBC and cleaning", () => {
  const state = insertExerciseSeed();
  const initialState = structuredClone(state);
  const inquiry = previewInsertionMinutes(
    state, screenshotDay, "ช่วง 9 โมง แทรกออกกำลังกายได้ไหม", screenshotMorning,
  );
  assert.deepEqual(inquiry, {
    date: screenshotDay, name: "ออกกำลังกาย", hour: 9,
    start: 570, duration: 30, remainingCapacity: 60, breakMinutes: 15,
  });
  assert.deepEqual(state, initialState);
});

test("insertion availability observes real current minute, daily cap and minimum breaks", () => {
  const message = "ช่วง 9 โมง แทรกออกกำลังกายได้กี่นาที";
  const seed = insertExerciseSeed();
  assert.equal(previewInsertionMinutes(
    seed, screenshotDay, message,
    Date.parse("2026-10-25T09:41:00+07:00"),
  )?.duration, 15);
  assert.equal(previewInsertionMinutes(
    seed, screenshotDay, message,
    Date.parse("2026-10-25T09:57:00+07:00"),
  )?.duration, 0);
  const cap = insertExerciseSeed();
  cap.settings.maxMinutes = 190;
  assert.equal(previewInsertionMinutes(
    cap, screenshotDay, message, screenshotMorning,
  )?.duration, 10);
  const noCapacity = insertExerciseSeed();
  noCapacity.settings.maxMinutes = 180;
  const result = previewInsertionMinutes(
    noCapacity, screenshotDay, message, screenshotMorning,
  );
  assert.equal(result?.duration, 0);
  assert.match(result?.reason ?? "", /เพดาน/);
  const tighter = insertExerciseSeed();
  tighter.settings.breakMinutes = 20;
  assert.equal(previewInsertionMinutes(
    tighter, screenshotDay, message, screenshotMorning,
  )?.duration, 20);
});

test("question is read-only; explicit insert requests and non-questions are not intercepted", () => {
  const seed = insertExerciseSeed();
  assert.equal(previewInsertionMinutes(
    seed, screenshotDay, "เพิ่มออกกำลังกายเวลา 09:30 นาน 30 นาที",
    screenshotMorning,
  ), undefined);
  assert.equal(previewInsertionMinutes(
    seed, screenshotDay, "ย้ายอ่านข่าว BBC ไปเวลา 09:30",
    screenshotMorning,
  ), undefined);
  assert.equal(previewInsertionMinutes(
    seed, screenshotDay, "ช่วง 9 โมงว่างไหม",
    screenshotMorning,
  ), undefined);
  assert.equal(previewInsertionMinutes(
    seed, screenshotDay, "ช่วง 9 โมง แทรกออกกำลังกายได้ไหม",
    Date.parse("2026-10-26T08:00:00+07:00"),
  ), undefined);
});

test("Yuna answers insertion minutes from the actual timetable without invoking AI or saving anything", async () => {
  const date = new Date(Date.parse(today()) + 86400000).toISOString().slice(0, 10);
  const seed = insertExerciseSeed(date);
  const { p, ai } = fixture(seed);
  ai.plannerCompletion = async () => {
    throw new Error("verified availability should not depend on Ollama's guessing");
  };
  const request = {
    ...dto, date, requestId: "insert-exercise-preview-9am",
    message: "ช่วง 9 โมง แทรกออกกำลังกายได้ไหม", autoApply: true,
  };
  const reply = await p.chat(request);
  assert.match(reply.message.content, /สูงสุด 30 นาที/);
  assert.match(reply.message.content, /09:30–10:00/);
  assert.match(reply.message.content, /ไม่ได้เพิ่มลงตาราง/);
  assert.equal(reply.message.outcome, "คำตอบจาก ยูนะ");
  assert.equal(reply.message.appliedChanges, undefined);
  assert.equal(reply.proposal, undefined);
  assert.deepEqual((await p.get()).sessions, seed.sessions);
  assert.equal(reply.message.followUps?.[0]?.label, "เพิ่ม 30 นาที");
  assert.match(reply.message.followUps?.[0]?.prompt ?? "",
    /09:30 นาน 30 นาที/);
  const retry = await p.chat(request);
  assert.equal(retry.message.id, reply.message.id);
  assert.deepEqual((await p.get()).sessions, seed.sessions);
});

test("Yuna explains no available insertion minutes when daily workload is full", async () => {
  const date = new Date(Date.parse(today()) + 86400000).toISOString().slice(0, 10);
  const seed = insertExerciseSeed(date);
  seed.settings.maxMinutes = 180;
  const { p, ai } = fixture(seed);
  ai.plannerCompletion = async () => { throw new Error("must be deterministic"); };
  const reply = await p.chat({
    ...dto, date, requestId: "exercise-hour-no-capacity",
    message: "ช่วง 9 โมง แทรกออกกำลังกายได้กี่นาที",
  });
  assert.match(reply.message.content, /ไม่ได้แม้แต่ 5 นาที/);
  assert.match(reply.message.content, /เพดาน/);
  assert.equal(reply.message.appliedChanges, undefined);
  assert.deepEqual((await p.get()).sessions, seed.sessions);
});
