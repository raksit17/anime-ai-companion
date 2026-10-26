import test from "node:test";
import assert from "node:assert/strict";
import {
  activityKeyFor, classifyActivity, initial,
  startSessionNow, finishSessionNow, actualWorkedMinutes,
  type Session,
} from "../src/planner/engine";
import { computeHabitProfile, diffSessionEvents } from "../src/planner/history";
import { weeklyReview } from "../src/planner/adaptive";

function sample(overrides: Partial<Session> = {}): Session {
  return {
    id: "old", name: "อ่านข่าว BBC", date: "2026-10-25",
    start: 540, duration: 30, status: "planned",
    fixed: false, reminder: 10, ...overrides,
  };
}
const now = Date.parse("2026-10-26T11:00:00+07:00");
test("stable grouping ignores temporary goalId and common activity aliases", () => {
  assert.equal(activityKeyFor("อ่านข่าว BBC"), activityKeyFor("BBC news"));
  assert.equal(activityKeyFor("ทำความสะอาดห้อง"), activityKeyFor("เก็บห้อง"));
  assert.equal(classifyActivity("เรียน coding"), "study");
  assert.equal(classifyActivity("ออกกำลังกาย"), "exercise");
  assert.notEqual(activityKeyFor("ทำ Assignment Playtorium"),
    activityKeyFor("เรียน TOEIC"));
});
test("history diff tracks creation, movement, resizing, completion, start and cancelled slots", () => {
  const x = sample();
  assert.equal(diffSessionEvents([], [x])[0].kind, "created");
  const moved = { ...x, start: 570 };
  assert.equal(diffSessionEvents([x], [moved])[0].kind, "moved");
  assert.deepEqual(diffSessionEvents([x], [moved])[0].before, x);
  assert.deepEqual(diffSessionEvents([x], [moved])[0].after, moved);
  assert.equal(diffSessionEvents([x], [{ ...x, duration: 15 }])[0].kind, "resized");
  assert.equal(diffSessionEvents([x], [{ ...x, start: 570, duration: 15 }])[0].kind,
    "rescheduled");
  assert.equal(diffSessionEvents([x], [{ ...x, actualStartedAt: "2026-10-25T02:00:00Z" }])[0].kind,
    "started");
  assert.equal(diffSessionEvents([x], [{ ...x, status: "done" }])[0].kind,
    "completed");
  assert.equal(diffSessionEvents([x], [{ ...x, status: "skipped" }])[0].kind,
    "skipped");
  const cancelled = diffSessionEvents([x], [])[0];
  assert.equal(cancelled.kind, "cancelled");
  assert.equal(cancelled.after, null);
  assert.equal(cancelled.before?.id, "old");
  assert.equal(diffSessionEvents([x], [{ ...x, notified: true }]).length, 0);
});
test("actualStartedAt and completedAt are distinct; no fabricated actual work time", () => {
  const x = sample();
  assert.equal(actualWorkedMinutes({ ...x, status: "done",
    completedAt: "2026-10-25T09:44:00.000Z" }), null);
  const start = Date.parse("2026-10-25T15:15:00+07:00");
  const finished = Date.parse("2026-10-25T16:44:00+07:00");
  const started = startSessionNow(x, start);
  assert.equal(started.actualStartedAt, "2026-10-25T08:15:00.000Z");
  assert.equal(actualWorkedMinutes(finishSessionNow(started, finished)), 89);
  assert.equal(x.actualStartedAt, undefined);
  assert.throws(() => startSessionNow(started, start), /ยังไม่ได้กดเริ่ม/);
});
test("90-day clusters combine one-off tasks, completed no-goal tasks and cancelled deletes", () => {
  const tracked = [
    sample({ id: "a", date: "2026-09-12", status: "done",
      completedAt: "2026-09-12T03:02:00.000Z", goalId: "daily:uuid-a" }),
    sample({ id: "b", date: "2026-10-05", status: "done",
      completedAt: "2026-10-05T03:02:00.000Z" }),
    sample({ id: "c", date: "2026-10-20", status: "done",
      completedAt: "2026-10-20T03:02:00.000Z", goalId: "daily:uuid-c" }),
    sample({ id: "d", name: "เรียน TOEIC", date: "2026-10-20",
      status: "skipped" }),
    sample({ id: "future", name: "เรียน TOEIC", date: "2026-10-26",
      start: 900, status: "planned" }),
  ];
  const removed = sample({ id: "deleted", date: "2026-10-07", name: "อ่านข่าว BBC" });
  const [event] = diffSessionEvents([removed], [], new Date("2026-10-07T03:00:00Z"));
  const profile = computeHabitProfile(tracked, [event], 90, now);
  const bbc = profile.activities.find((a) => a.activityKey === activityKeyFor("BBC news"))!;
  assert.equal(bbc.total, 4);
  assert.equal(bbc.done, 3);
  assert.equal(bbc.cancelled, 1);
  assert.equal(bbc.actualSamples, 0);
  assert.equal(bbc.averageActualMinutes, null);
  assert.equal(profile.missingActualStarts, 3);
  assert.ok(profile.recommendations.some((r) => r.activityKey === bbc.activityKey));
  const toeic = profile.activities.find((a) => a.name === "เรียน TOEIC")!;
  assert.equal(toeic.skipped, 1);
  assert.equal(toeic.pending, 1);
  assert.ok(!profile.recommendations.some((r) => r.activityKey === toeic.activityKey));
  const short = computeHabitProfile(tracked, [event], 7, now);
  assert.equal(short.activities.find((x) => x.activityKey === bbc.activityKey)?.done, 1);
});
test("actual work sample averages only sessions with both verified timestamps", () => {
  const rows = [
    sample({ id: "a", status: "done", duration: 120,
      actualStartedAt: "2026-10-25T08:15:00Z",
      completedAt: "2026-10-25T09:44:00Z" }),
    sample({ id: "b", status: "done", duration: 120,
      completedAt: "2026-10-25T09:44:00Z" }),
  ];
  const profile = computeHabitProfile(rows, [], 90, now);
  const item = profile.activities[0];
  assert.equal(item.actualSamples, 1);
  assert.equal(item.averageActualMinutes, 89);
  assert.equal(item.scheduledMinutes, 240);
});
test("weekly review includes chat-created one-offs and appointments lacking goalIds", () => {
  const state = initial();
  // On 2026-10-26 (Monday), previous review week is 2026-10-19..25.
  state.sessions = [
    sample({ id: "a", status: "done", goalId: "daily:123" }),
    sample({ id: "b", status: "done", goalId: "daily:456" }),
    sample({ id: "c", name: "ประชุม", fixed: true, status: "done" }),
  ];
  const review = weeklyReview(state, now);
  assert.equal(review.total, 3);
  assert.equal(review.done, 3);
  assert.equal(review.goals.length, 2);
  assert.equal(review.goals.find((g) => g.name === "อ่านข่าว BBC")?.total, 2);
});

test("4-day analytics covers Oct 22–25 and exposes one-off completed ideas without calling them habits", () => {
  const rows = [
    sample({ id: "too-old", date: "2026-10-21", status: "done" }),
    sample({ id: "shown", date: "2026-10-24", name: "เรียน TOEIC", status: "done" }),
    sample({ id: "future", date: "2026-10-26", name: "Coding", status: "planned" }),
  ];
  const result = computeHabitProfile(rows, [], 4, now);
  assert.equal(result.from, "2026-10-22");
  assert.equal(result.to, "2026-10-25");
  assert.equal(result.activityCount, 1);
  assert.equal(result.completed, 1);
  assert.equal(result.activities[0].recurringPattern, false);
  assert.equal(result.recommendations.length, 1);
  assert.match(result.recommendations[0].reason, /ข้อมูลน้อย/);
  assert.match(result.note, /โหมดทดลอง 4 วัน/);
});
