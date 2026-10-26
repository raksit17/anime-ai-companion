import test from "node:test";
import assert from "node:assert/strict";
import { initial, type Session } from "../src/planner/engine";
import { analyzeDay } from "../src/planner/day-analytics";

const date = "2026-10-26";
const now = Date.parse("2026-10-26T13:20:00+07:00");
function session(
  id: string, name: string, start: number, duration: number,
  overrides: Partial<Session> = {},
): Session {
  return {
    id, name, date, start, duration, status: "planned",
    fixed: false, reminder: 10, ...overrides,
  };
}
test("empty daily chart has 24h including separate sleep, zero breaks and free awake time", () => {
  const state = initial();
  state.settings.sleep = 1260; // 08:00–21:00
  const day = analyzeDay(state, date, now);
  assert.equal(day.totalMinutes, 1440);
  assert.equal(day.awakeMinutes, 780);
  assert.equal(day.sleepMinutes, 660);
  assert.equal(day.freeMinutes, 780);
  assert.equal(day.futureFreeMinutes, 460);
  assert.equal(day.freePercentOfAwake, 100);
  assert.equal(day.reservedMinutes, 0);
  assert.equal(day.breakMinutes, 0);
  assert.equal(day.timeline.reduce((n, segment) => n + segment.minutes, 0), 1440);
  assert.equal(day.categories.length, 0);
});
test("category clusters and break time conserve awake minutes; extra gaps remain free", () => {
  const state = initial();
  state.settings.sleep = 1260;
  state.sessions = [
    session("study", "เรียน TOEIC", 540, 60, { status: "done" }),
    session("work", "ทำโปรเจกต์", 630, 30),
    session("skip", "ออกกำลังกาย", 750, 40, { status: "skipped" }),
    session("defer", "ทำความสะอาด", 800, 50, { status: "deferred" }),
  ];
  const day = analyzeDay(state, date, now);
  assert.equal(day.reservedMinutes, 90);
  assert.equal(day.completedBookedMinutes, 60);
  assert.equal(day.plannedBookedMinutes, 30);
  assert.equal(day.breakMinutes, 15);
  assert.equal(day.freeMinutes, 675);
  assert.equal(day.ignoredSessions, 2);
  assert.equal(day.categories.find((x) => x.category === "study")?.minutes, 60);
  assert.equal(day.categories.find((x) => x.category === "work")?.minutes, 30);
  assert.equal(day.freeWindows.reduce((n, x) => n + x.minutes, 0), 675);
  assert.equal(day.freeMinutes + day.breakMinutes + day.reservedMinutes, 780);
  assert.equal(day.timeline.reduce((n, x) => n + x.minutes, 0), 1440);
});
test("early completion releases scheduled tail; real duration is only from actual timestamps", () => {
  const state = initial();
  state.sessions = [
    session("done", "ออกกำลังกาย", 540, 60, {
      status: "done",
      actualStartedAt: "2026-10-26T09:00:00+07:00",
      completedAt: "2026-10-26T09:45:00+07:00",
    }),
  ];
  const day = analyzeDay(state, date, now);
  assert.equal(day.reservedMinutes, 45);
  assert.equal(day.freeMinutes, day.awakeMinutes - 45);
  assert.equal(day.actualMeasuredMinutes, 45);
  assert.equal(day.actualSampleCount, 1);
  assert.equal(day.noActualStartCount, 0);
});
test("completed record without explicit start NEVER creates synthetic worked minutes", () => {
  const state = initial();
  state.sessions = [
    session("old", "เรียนภาษาอังกฤษ", 540, 60, {
      status: "done", completedAt: "2026-10-26T10:15:00+07:00",
    }),
  ];
  const day = analyzeDay(state, date, now);
  assert.equal(day.completedBookedMinutes, 60);
  assert.equal(day.actualMeasuredMinutes, 0);
  assert.equal(day.actualSampleCount, 0);
  assert.equal(day.noActualStartCount, 1);
});
test("corrupted overlaps do not double count allocated time", () => {
  const state = initial();
  state.sessions = [
    session("a", "เรียน TOEIC", 540, 60),
    session("b", "ทำโปรเจกต์", 570, 60),
  ];
  const day = analyzeDay(state, date, now);
  assert.equal(day.reservedMinutes, 90);
  assert.equal(day.overlappedMinutes, 30);
  assert.equal(day.breakMinutes, 0);
  assert.equal(day.reservedMinutes + day.freeMinutes, day.awakeMinutes);
  assert.equal(day.timeline.reduce((n, x) => n + x.minutes, 0), 1440);
});
test("clamps slots outside awake time and keeps past remaining-free at zero", () => {
  const state = initial();
  state.sessions = [
    session("early", "เรียนภาษาอังกฤษ", 450, 90, { date: "2026-10-24" }),
    session("late", "ทำโปรเจกต์", 1300, 90, { date: "2026-10-24" }),
  ];
  const day = analyzeDay(state, "2026-10-24", now);
  assert.equal(day.reservedMinutes, 60);
  assert.equal(day.futureFreeMinutes, 0);
  assert.equal(day.sleepMinutes + day.awakeMinutes, 1440);
  assert.equal(day.timeline.reduce((n, x) => n + x.minutes, 0), 1440);
});
test("future dates expose full free capacity, historical settings are read-only", () => {
  const state = initial();
  state.settings.breakMinutes = 5;
  const before = structuredClone(state);
  const day = analyzeDay(state, "2026-10-27", now);
  assert.equal(day.freeMinutes, day.futureFreeMinutes);
  assert.deepEqual(state, before);
  assert.throws(() => analyzeDay(state, "2026-10-99", now), /วันที่/);
});
