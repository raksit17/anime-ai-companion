import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { PlannerService } = require("../dist/planner/planner.js");
const { initial } = require("../dist/planner/engine.js");
function fixture() {
  let stored = initial();
  const db = {
    $transaction: async (fn: any) => {
      let draft = structuredClone(stored);
      const result = await fn({
        $executeRaw: async () => 0,
        plannerStore: {
          findUnique: async () => ({ data: draft }),
          upsert: async ({ update }: any) => {
            draft = update.data;
          },
        },
      });
      stored = structuredClone(draft);
      return result;
    },
  };
  return new PlannerService(db, {}, {});
}
const date = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
const goal = {
  name: "Coding",
  days: [0, 1, 2, 3, 4, 5, 6],
  duration: 60,
  preferred: 600,
  priority: 2,
  restDays: 0,
  reminder: 10,
  flexible: true,
};
test("proposal does not modify live sessions until explicit confirmation; confirm is single use", async () => {
  const p = fixture();
  await p.goal(goal);
  const draft = await p.propose({ date, energy: "normal" });
  assert.equal((await p.get()).sessions.length, 0);
  await p.confirm(draft.id);
  assert.equal((await p.get()).sessions.length, 7);
  await assert.rejects(() => p.confirm(draft.id));
});
test("concurrent state change invalidates proposed plan", async () => {
  const p = fixture();
  await p.goal(goal);
  const draft = await p.propose({ date, energy: "normal" });
  await p.goal({ ...goal, name: "English" });
  await assert.rejects(() => p.confirm(draft.id));
  assert.equal((await p.get()).sessions.length, 0);
});
test("move checks conflict and preserves original before confirmation", async () => {
  const p = fixture();
  await p.goal(goal);
  await p.confirm((await p.propose({ date, energy: "normal" })).id);
  const x = (await p.get()).sessions[0];
  await p.event({ name: "Interview", date, start: 780, duration: 60 });
  await assert.rejects(() => p.move(x.id, { date, start: 800 }));
  const proposal = await p.move(x.id, { date, start: 900 });
  assert.equal((await p.get()).sessions[0].start, 600);
  await p.confirm(proposal.id);
  assert.equal((await p.get()).sessions[0].start, 900);
});
test("status transitions cannot be double counted", async () => {
  const p = fixture();
  await p.goal(goal);
  await p.confirm((await p.propose({ date, energy: "normal" })).id);
  const x = (await p.get()).sessions[0];
  await p.progress(x.id, { status: "done", note: "Map and Set" });
  await assert.rejects(() => p.progress(x.id, { status: "done" }));
  assert.equal((await p.get()).progress.minutes, 60);
});

test("adaptive event commits appointment and moved work together, with stale protection", async () => {
  const p = fixture();
  await p.goal(goal);
  await p.confirm((await p.propose({ date, energy: "normal" })).id);
  const before = await p.get();
  const draft = await p.adaptiveEvent({
    name: "Interview",
    date,
    start: 600,
    duration: 60,
  });
  assert.deepEqual((await p.get()).sessions, before.sessions);
  await p.confirm(draft.id);
  const after = await p.get();
  assert.equal(
    after.sessions.filter((x: any) => x.name === "Interview").length,
    1,
  );
  assert.notEqual(
    after.sessions.find((x: any) => x.id === before.sessions[0].id).start,
    600,
  );
  const stale = await p.adaptive({ date, energy: "low" });
  await p.goal({ ...goal, name: "Reading" });
  await assert.rejects(() => p.confirm(stale.id));
});
test("weekly report is cached and concurrent AI requests share one generation", async () => {
  const p = fixture();
  const week = (await p.get()).weekly;
  let calls = 0;
  await p.access((s: any) => {
    s.sessions.push({
      id: "past",
      goalId: "g",
      name: "Coding",
      date: week.from,
      start: 600,
      duration: 60,
      status: "done",
      fixed: false,
      reminder: 10,
    });
  }, true);
  p.advice = async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 5));
    return { text: "Try a lighter schedule" };
  };
  const [a, b] = await Promise.all([p.weeklyAnalysis(), p.weeklyAnalysis()]);
  assert.deepEqual(a, b);
  await p.weeklyAnalysis();
  assert.equal(calls, 1);
  assert.equal((await p.get()).weeklyReport.text, "Try a lighter schedule");
});
test("empty week does not request AI", async () => {
  const p = fixture();
  p.advice = () => {
    throw new Error("must not run");
  };
  assert.match((await p.weeklyAnalysis()).text, /ยังไม่มี/);
});


test("rename changes just one session title, updates its cluster and preserves goal/timing", async () => {
  const p = fixture();
  await p.goal(goal);
  await p.confirm((await p.propose({ date, energy: "normal" })).id);
  const before = await p.get();
  const target = before.sessions[0];
  const result = await p.renameSession(target.id, {
    name: "  ออกกำลังกาย  ", expectedRevision: before.revision,
  });
  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  const after = await p.get();
  const edited = after.sessions.find((s: any) => s.id === target.id);
  assert.equal(edited.name, "ออกกำลังกาย");
  assert.equal(edited.category, "exercise");
  assert.equal(edited.activityKey, "exercise:exercise");
  assert.equal(edited.goalId, target.goalId);
  assert.equal(edited.date, target.date);
  assert.equal(edited.start, target.start);
  assert.equal(edited.duration, target.duration);
  assert.equal(edited.status, target.status);
  assert.equal(edited.fixed, target.fixed);
  assert.equal(after.revision, before.revision + 1);
  assert.equal(after.goals[0].name, "Coding");
  assert.equal(after.sessions.filter((s: any) => s.id !== target.id)
    .every((s: any) => s.name === "Coding"), true);
});
test("rename completed historical activity without altering progress or completion metadata", async () => {
  const p = fixture();
  await p.goal(goal);
  await p.confirm((await p.propose({ date, energy: "normal" })).id);
  const target = (await p.get()).sessions[0];
  await p.progress(target.id, { status: "done", note: "Reviewed code" });
  const before = await p.get();
  const result = await p.renameSession(target.id, {
    name: "ทบทวน TypeScript", expectedRevision: before.revision,
  });
  const after = await p.get();
  const updated = after.sessions.find((s: any) => s.id === target.id);
  assert.equal(result.changed, true);
  assert.equal(updated.name, "ทบทวน TypeScript");
  assert.equal(updated.status, "done");
  assert.equal(updated.note, "Reviewed code");
  assert.equal(updated.completedAt,
    before.sessions.find((s: any) => s.id === target.id).completedAt);
  assert.equal(after.progress.done, before.progress.done);
  assert.equal(after.progress.minutes, before.progress.minutes);
});
test("rename validates missing/blank/overlong names and rejects stale revisions", async () => {
  const p = fixture();
  await p.goal(goal);
  await p.confirm((await p.propose({ date, energy: "normal" })).id);
  const before = await p.get();
  const id = before.sessions[0].id;
  await assert.rejects(() => p.renameSession("not-found", {
    name: "Anything", expectedRevision: before.revision,
  }), /ไม่พบ/);
  await assert.rejects(() => p.renameSession(id, {
    name: "    ", expectedRevision: before.revision,
  }), /ชื่อกิจกรรม/);
  await assert.rejects(() => p.renameSession(id, {
    name: "A".repeat(121), expectedRevision: before.revision,
  }), /ชื่อกิจกรรม/);
  const noop = await p.renameSession(id, {
    name: "Coding", expectedRevision: before.revision,
  });
  assert.equal(noop.changed, false);
  assert.equal((await p.get()).revision, before.revision);
  await p.renameSession(id, {
    name: "Updated", expectedRevision: before.revision,
  });
  await assert.rejects(() => p.renameSession(id, {
    name: "Stale", expectedRevision: before.revision,
  }), /ตารางมีการเปลี่ยนแปลง/);
  assert.equal((await p.get()).sessions[0].name, "Updated");
});
test("renaming a saved session invalidates existing planner proposals", async () => {
  const p = fixture();
  await p.goal(goal);
  await p.confirm((await p.propose({ date, energy: "normal" })).id);
  const pending = await p.propose({ date, energy: "low" });
  const state = await p.get();
  const id = state.sessions[0].id;
  await p.renameSession(id, { name: "New title", expectedRevision: state.revision });
  await assert.rejects(() => p.confirm(pending.id), /หมดอายุ|ข้อมูลเปลี่ยน/);
  assert.equal((await p.get()).sessions[0].name, "New title");
});


test("retroactive API persists a done activity and retries with same requestId are idempotent", async () => {
  const p = fixture();
  const date = new Date(Date.parse(new Date(Date.now() + 7 * 3600000)
    .toISOString().slice(0, 10)) - 86400000).toISOString().slice(0, 10);
  const request = { name: "อ่านข่าว BBC", date, duration: 30,
    requestId: "retro-bbc-01" };
  const first = await p.recordPastActivity(request);
  const retried = await p.recordPastActivity(request);
  assert.equal(first.id, retried.id);
  const state = await p.get();
  assert.equal(state.sessions.length, 1);
  assert.equal(state.sessions[0].status, "done");
  assert.equal(state.sessions[0].historicalTimeAccuracy, "unknown");
  assert.equal(state.progress.done, 1);
  assert.equal((await p.dayAnalytics(date)).unknownTimeCount, 1);
  await assert.rejects(() => p.recordPastActivity({
    ...request, requestId: "retro-bbc-other",
  }), /บันทึกแล้ว/);
});

test("retroactive completion invalidates pending proposal and keeps done activity immutable", async () => {
  const p = fixture();
  await p.goal(goal);
  const proposal = await p.propose({ date, energy: "normal" });
  const y = new Date(Date.parse(new Date(Date.now() + 7 * 3600000)
    .toISOString().slice(0, 10)) - 86400000).toISOString().slice(0, 10);
  const entry = await p.recordPastActivity({
    name: "ทำความสะอาดห้อง", date: y, duration: 20,
    start: 600, accuracy: "exact",
  });
  await assert.rejects(() => p.confirm(proposal.id), /หมดอายุ|ข้อมูลเปลี่ยน/);
  await assert.rejects(() => p.progress(entry.id, { status: "done" }), /บันทึกผลแล้ว/);
  assert.equal((await p.get()).sessions.length, 1);
});
