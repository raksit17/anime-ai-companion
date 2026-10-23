import test from "node:test";
import assert from "node:assert/strict";
import { adapt, weeklyReview } from "../src/planner/adaptive";
import { initial, Goal, Session } from "../src/planner/engine";
const now = Date.parse("2030-01-07T00:00:00+07:00"); // Monday
const goal: Goal = {
  id: "coding",
  name: "Coding",
  days: [0, 1, 2, 3, 4, 5, 6],
  duration: 60,
  preferred: 600,
  priority: 2,
  restDays: 0,
  reminder: 10,
  flexible: true,
};
const session = (
  id: string,
  date = "2030-01-07",
  status: Session["status"] = "planned",
): Session => ({
  id,
  goalId: goal.id,
  name: goal.name,
  date,
  start: 600,
  duration: 60,
  status,
  fixed: false,
  reminder: 10,
});
function state() {
  const s = initial();
  s.goals = [goal];
  return s;
}
test("last completed Bangkok calendar week, unlogged vs skipped vs done, minimum sample", () => {
  const s = state();
  s.sessions = [
    session("1", "2029-12-31", "done"),
    session("2", "2030-01-01", "skipped"),
    session("3", "2030-01-02"),
    session("future"),
  ];
  const r = weeklyReview(s, now);
  assert.equal(r.from, "2029-12-31");
  assert.equal(r.to, "2030-01-06");
  assert.equal(r.total, 3);
  assert.equal(r.goals[0].missed, 1);
  assert.equal(r.goals[0].reduce, true);
  s.sessions = s.sessions.slice(0, 2);
  assert.equal(weeklyReview(s, now).goals[0].reduce, false);
});
test("new appointment reflows flexible work, preserves source and session id", () => {
  const s = state();
  s.sessions = [session("work")];
  const r = adapt(
    s,
    "2030-01-07",
    "normal",
    { name: "Interview", date: "2030-01-07", start: 600, duration: 60 },
    now,
  );
  const work = r.sessions.find((x) => x.id === "work")!;
  assert.equal(s.sessions[0].start, 600);
  assert.notEqual(work.start, 600);
  assert.equal(r.sessions.length, 2);
  assert.ok(work.start + work.duration + 15 <= 600 || work.start >= 675);
});
test("locked conflicts fail instead of moving appointments", () => {
  const s = state();
  s.sessions = [{ ...session("fixed"), fixed: true }];
  assert.throws(() =>
    adapt(
      s,
      "2030-01-07",
      "normal",
      { name: "Interview", date: "2030-01-07", start: 600, duration: 60 },
      now,
    ),
  );
});
test("low completion reduces next week once, without rewriting history or goal", () => {
  const s = state();
  s.sessions = [
    session("1", "2029-12-31", "done"),
    session("2", "2030-01-01", "skipped"),
    session("3", "2030-01-02"),
    session("work"),
  ];
  const first = adapt(s, "2030-01-07", "normal", undefined, now);
  assert.equal(first.sessions.find((x) => x.id === "work")!.duration, 45);
  assert.equal(first.sessions[0].duration, 60);
  const next = adapt(
    { ...s, sessions: first.sessions },
    "2030-01-07",
    "normal",
    undefined,
    now,
  );
  assert.equal(next.sessions.find((x) => x.id === "work")!.duration, 45);
  assert.equal(s.goals[0].duration, 60);
});
test("unschedulable work is deferred, not lost or counted as skipped", () => {
  const s = state();
  s.settings.maxMinutes = 10;
  s.sessions = [session("work")];
  const r = adapt(s, "2030-01-07", "normal", undefined, now);
  assert.equal(r.sessions[0].status, "deferred");
  assert.equal(r.unscheduled.length, 1);
  assert.equal(r.sessions[0].id, "work");
});
test("adaptive minimum break and daily capacity are respected", () => {
  const s = state();
  s.settings.breakMinutes = 0;
  s.settings.maxMinutes = 90;
  s.goals.push({ ...goal, id: "english" });
  s.sessions = [
    session("1"),
    { ...session("2"), goalId: "english", start: 660 },
  ];
  const r = adapt(s, "2030-01-07", "normal", undefined, now);
  const a = r.sessions.find((x) => x.id === "1")!,
    b = r.sessions.find((x) => x.id === "2")!;
  assert.notEqual(a.date, b.date);
  assert.equal(r.breakMinutes, 15);
  assert.equal(s.settings.breakMinutes, 0);
});
test("never reschedules started work and respects recovery days", () => {
  const s = state();
  s.goals[0] = { ...goal, restDays: 1 };
  s.sessions = [session("yesterday", "2030-01-06", "done"), session("work")];
  const r = adapt(s, "2030-01-07", "normal", undefined, now);
  assert.equal(r.sessions.find((x) => x.id === "work")!.date, "2030-01-08");
  assert.deepEqual(
    r.sessions.find((x) => x.id === "yesterday"),
    s.sessions[0],
  );
});
test("low energy reduces existing flexible session; unchanged reminders survive", () => {
  const s = state();
  s.sessions = [{ ...session("work"), notified: true }];
  assert.equal(
    adapt(s, "2030-01-07", "low", undefined, now).sessions[0].duration,
    20,
  );
  assert.equal(
    adapt(s, "2030-01-07", "normal", undefined, now).sessions[0].notified,
    true,
  );
});
