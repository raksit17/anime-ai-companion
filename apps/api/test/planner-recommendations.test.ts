import test from "node:test";
import assert from "node:assert/strict";
import { initial, type Session, type State } from "../src/planner/engine";
import { recommendDay } from "../src/planner/recommendations";

const now = Date.parse("2026-10-27T11:30:00+07:00");
const target = "2026-11-02";
const mondayDates = ["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"];
function done(date: string, i: number, overrides: Partial<Session> = {}): Session {
  return {
    id: "completed-" + i, name: "อ่านข่าว BBC", date, start: 510,
    duration: 30, status: "done", fixed: false, reminder: 10,
    completedAt: date + "T02:00:00.000Z", ...overrides,
  };
}
function fixture(): State {
  const state = initial();
  state.sessions = mondayDates.map((date, i) => done(date, i));
  return state;
}
test("recommends observed Monday routine without modifying the original", () => {
  const state = fixture();
  const result = recommendDay(state, target, "normal", now);
  assert.equal(state.sessions.length, 4);
  assert.equal(result.sessions.length, 5);
  assert.equal(result.suggestions.length, 1);
  assert.equal(result.suggestions[0].evidenceCount, 4);
  assert.equal(result.suggestions[0].confidence, "high");
  assert.equal(result.suggestions[0].plannedStart, 510);
  const proposed = result.sessions.at(-1)!;
  assert.equal(proposed.start, 510);
  assert.equal(proposed.duration, 30);
  assert.equal(proposed.status, "planned");
  assert.equal(proposed.fixed, false);
});
test("finds another slot near habitual start while respecting fixed event and breaks", () => {
  const state = fixture();
  state.settings.breakMinutes = 5;
  state.sessions.push({
    id: "fixed", name: "นัดแพทย์", date: target, start: 510,
    duration: 60, status: "planned", fixed: true, reminder: 0,
  });
  const result = recommendDay(state, target, "normal", now);
  assert.equal(result.breakMinutes, 15);
  assert.equal(result.suggestions.length, 1);
  assert.equal(result.suggestions[0].plannedStart, 585);
  assert.equal(state.settings.breakMinutes, 5); // Input is immutable.
  assert.equal(result.sessions.find((s) => s.id === "fixed")?.start, 510);
});
test("never doubles an already scheduled activity on target date", () => {
  const state = fixture();
  state.sessions.push({
    id: "present", name: "BBC news", date: target,
    start: 540, duration: 30, status: "planned",
    fixed: false, reminder: 10,
  });
  const result = recommendDay(state, target, "normal", now);
  assert.equal(result.suggestions.length, 0);
  assert.equal(result.sessions.length, state.sessions.length);
});
test("low-energy recommendation is at most 20 minutes", () => {
  const result = recommendDay(fixture(), target, "low", now);
  assert.equal(result.suggestions.length, 1);
  assert.equal(result.sessions.at(-1)?.duration, 20);
});
test("only verified completed work across multiple weeks becomes a recommendation", () => {
  const state = fixture();
  state.sessions.forEach((s) => { s.status = "planned"; });
  assert.equal(recommendDay(state, target, "normal", now).suggestions.length, 0);
  const singleWeek = fixture();
  singleWeek.sessions = [
    done("2026-10-19", 1), done("2026-10-20", 2), done("2026-10-21", 3),
  ];
  assert.equal(recommendDay(singleWeek, target, "normal", now).suggestions.length, 0);
});
test("respect wake/sleep window, no past slots for today, and daily capacity", () => {
  const state = fixture();
  assert.equal(recommendDay(state, "2026-10-27", "normal", now).suggestions.length, 0);
  state.settings.maxMinutes = 30;
  state.sessions.push({
    id: "busy", name: "Coding", date: target, start: 600,
    duration: 30, fixed: false, status: "planned", reminder: 10,
    goalId: "daily:busy",
  });
  const result = recommendDay(state, target, "normal", now);
  assert.equal(result.suggestions.length, 0);
  assert.ok(result.unscheduled.some((s) => s.includes("เพดาน")));
});
test("reject invalid dates and respects recurring goal weekday and rest constraints", () => {
  const state = fixture();
  assert.throws(() => recommendDay(state, "2026-10-25", "normal", now), /วันนี้/);
  assert.throws(() => recommendDay(state, "2026-11-33", "normal", now), /วันนี้/);
  state.goals.push({
    id: "bbc", name: "BBC news", duration: 30, preferred: 510,
    days: [1], restDays: 1, priority: 2, reminder: 10, flexible: true,
  });
  state.sessions.push(done("2026-11-01", 9, { goalId: "bbc" }));
  assert.equal(recommendDay(state, target, "normal", now).suggestions.length, 0);
  state.sessions.pop();
  state.suppressedOccurrences = { bbc: [target] };
  assert.equal(recommendDay(state, target, "normal", now).suggestions.length, 0);
});

test("4-day trial uses previous four COMPLETE days and can suggest one verified task", () => {
  const nowFour = Date.parse("2026-10-26T11:30:00+07:00");
  const state = initial();
  state.sessions = [
    done("2026-10-21", 1, { name: "เรียน TOEIC" }), // Out of window
    done("2026-10-24", 2, { name: "ทำความสะอาดห้อง", start: 600, duration: 30 }),
    done("2026-10-26", 3, { name: "ออกกำลังกาย" }), // Today is incomplete
  ];
  const result = recommendDay(state, "2026-10-27", "normal", nowFour, 4);
  assert.equal(result.mode, "recent-trial");
  assert.equal(result.lookbackDays, 4);
  assert.equal(result.analysisFrom, "2026-10-22");
  assert.equal(result.analysisTo, "2026-10-25");
  assert.equal(result.suggestions.length, 1);
  assert.equal(result.suggestions[0].name, "ทำความสะอาดห้อง");
  assert.equal(result.suggestions[0].evidenceCount, 1);
  assert.equal(result.suggestions[0].confidence, "low");
  assert.match(result.suggestions[0].reason, /ยังไม่ยืนยันว่าเป็นกิจวัตร/);
  assert.equal(state.sessions.length, 3);
  // The same sparse history must not become a confirmed long-term habit.
  assert.equal(recommendDay(state, "2026-10-27", "normal", nowFour, 90).suggestions.length, 0);
});
test("4-day trial can reflow past morning clock later today without changing old sessions", () => {
  const nowFour = Date.parse("2026-10-26T11:30:00+07:00");
  const state = initial();
  state.sessions = [done("2026-10-24", 1, {
    name: "เรียนภาษาอังกฤษ", start: 510, duration: 30,
  })];
  const result = recommendDay(state, "2026-10-26", "normal", nowFour, 4);
  assert.equal(result.suggestions.length, 1);
  assert.ok(result.suggestions[0].plannedStart >= 690);
  assert.match(result.suggestions[0].reason, /เลื่อนเวลาเสนอเป็น/);
});
test("4-day trial ignores one-off locked appointments, duplicates and capacity collisions", () => {
  const nowFour = Date.parse("2026-10-26T11:30:00+07:00");
  const state = initial();
  state.sessions = [
    done("2026-10-24", 1, { name: "ประชุม", fixed: true }),
    done("2026-10-24", 2, { name: "เรียน TOEIC", start: 540 }),
  ];
  const trial = recommendDay(state, "2026-10-27", "normal", nowFour, 4);
  assert.deepEqual(trial.suggestions.map((s) => s.name), ["เรียน TOEIC"]);
  state.sessions.push({
    id: "existing", name: "เรียน TOEIC", date: "2026-10-27",
    start: 540, duration: 30, fixed: false, status: "planned", reminder: 10,
  });
  assert.equal(recommendDay(state, "2026-10-27", "normal", nowFour, 4).suggestions.length, 0);
  state.sessions.pop();
  state.settings.maxMinutes = 10;
  assert.equal(recommendDay(state, "2026-10-27", "normal", nowFour, 4).suggestions.length, 0);
});
