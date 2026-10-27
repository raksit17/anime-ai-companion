import test from "node:test";
import assert from "node:assert/strict";
import { initial, today, actualWorkedMinutes, fits, type Session } from "../src/planner/engine";
import { makePastActivity, parsePastActivityMessage } from "../src/planner/past-activity";
import { analyzeDay } from "../src/planner/day-analytics";
import { computeHabitProfile } from "../src/planner/history";

const now = Date.parse("2026-10-27T09:28:00+07:00");
const date = "2026-10-26";
function pastInput(overrides: Record<string, unknown> = {}) {
  return { name: "ฝึก TOEIC", date, duration: 45, ...overrides };
}

test("exact retroactive activity is completed on past date, without new future booking", () => {
  const state = initial();
  const entry = makePastActivity(state, pastInput({
    start: 540, accuracy: "exact", note: "ลืมกรอกเมื่อวาน",
  }), now);
  assert.equal(entry.status, "done");
  assert.equal(entry.date, date);
  assert.equal(entry.start, 540);
  assert.equal(entry.historicalTimeAccuracy, "exact");
  assert.equal(entry.actualStartedAt, "2026-10-26T02:00:00.000Z");
  assert.equal(entry.completedAt, "2026-10-26T02:45:00.000Z");
  assert.equal(entry.note, "ลืมกรอกเมื่อวาน");
  assert.equal(actualWorkedMinutes(entry), null); // Self-report is not stopwatch.
  assert.equal(state.sessions.length, 0); // Pure validator does not persist.
  state.sessions.push(entry);
  const summary = analyzeDay(state, date, now);
  assert.equal(summary.reservedMinutes, 45);
  assert.equal(summary.completedBookedMinutes, 45);
  assert.equal(summary.actualMeasuredMinutes, 0);
  assert.equal(summary.categories[0].done, 1);
});

test("unknown past time counts as completed but leaves the graph free and never blocks scheduling", () => {
  const state = initial();
  const entry = makePastActivity(state, pastInput({ duration: 35 }), now);
  assert.equal(entry.historicalTimeAccuracy, "unknown");
  assert.equal(entry.start, 0); // Internal sentinel only; never displayed as 00:00.
  assert.equal(entry.actualStartedAt, undefined);
  assert.equal(entry.completedAt, undefined);
  state.sessions.push(entry);
  const summary = analyzeDay(state, date, now);
  assert.equal(summary.unknownTimeCount, 1);
  assert.equal(summary.unknownTimeReportedMinutes, 35);
  assert.equal(summary.completedBookedMinutes, 0);
  assert.equal(summary.freeMinutes, summary.awakeMinutes);
  const profile = computeHabitProfile(state.sessions, [], 7, now);
  assert.equal(profile.completed, 1);
  assert.equal(profile.activities[0].done, 1);
  assert.equal(profile.activities[0].preferredStart, null);
  assert.equal(profile.timeClusters.length, 0);
  const futureDate = "2026-10-27";
  state.sessions.push({ ...entry, id: "historical-on-same-day", date: futureDate });
  const proposed: Session = { id: "fresh", date: futureDate,
    name: "Interview", start: 540, duration: 30, fixed: false,
    reminder: 10, status: "planned", goalId: "daily:fresh" };
  assert.ok(fits(state, proposed, now));
});

test("approximate time appears in chart but not measured-work or confirmed-time clustering", () => {
  const state = initial();
  const entry = makePastActivity(state, pastInput({
    start: 630, duration: 30, accuracy: "estimated",
  }), now);
  state.sessions.push(entry);
  const summary = analyzeDay(state, date, now);
  assert.equal(summary.completedBookedMinutes, 30);
  assert.equal(summary.actualSampleCount, 0);
  const profile = computeHabitProfile(state.sessions, [], 7, now);
  assert.equal(profile.completed, 1);
  assert.equal(profile.activities[0].preferredStart, null);
});

test("past completion guards future, impossible clock, conflicts, malformed duration and old dates", () => {
  const state = initial();
  const exact = makePastActivity(state, pastInput({ start: 600 }), now);
  state.sessions.push(exact);
  assert.throws(() => makePastActivity(state, pastInput({ start: 615 }), now), /ทับซ้อน/);
  assert.throws(() => makePastActivity(state, pastInput({ start: 1420 }), now), /วันเดียวกัน/);
  assert.throws(() => makePastActivity(state, pastInput({ date: "2026-10-28" }), now), /ย้อนหลัง/);
  assert.throws(() => makePastActivity(state, pastInput({ date: "2025-01-01" }), now), /ย้อนหลัง/);
  assert.throws(() => makePastActivity(state, pastInput({ date: "2026-10-99" }), now), /ย้อนหลัง/);
  assert.throws(() => makePastActivity(state, pastInput({ duration: 0 }), now), /5–720/);
  assert.throws(() => makePastActivity(state, pastInput({
    date: "2026-10-27", start: 600,
  }), now), /ยังไม่ถึงเวลา/);
});

test("Thai retrospective request never invents missing start clock, ignores advice questions", () => {
  const unknown = parsePastActivityMessage("เมื่อวานออกกำลังกาย 30 นาที ลืมบันทึก", now);
  assert.deepEqual(unknown, { name: "ออกกำลังกาย", date,
    duration: 30 });
  assert.deepEqual(
    parsePastActivityMessage("เมื่อวานเวลา 18:00 ฝึก TOEIC 45 นาที ทำเสร็จแล้ว", now),
    { name: "ฝึก TOEIC", date, start: 1080, accuracy: "exact", duration: 45 },
  );
  assert.equal(parsePastActivityMessage("พรุ่งนี้ออกกำลังกาย 30 นาที", now), undefined);
  assert.equal(parsePastActivityMessage("เมื่อวานฉันน่าจะทำงานอะไรไปบ้าง?", now), undefined);
});
