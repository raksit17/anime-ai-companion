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
