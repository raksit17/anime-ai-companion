import test from "node:test";
import assert from "node:assert/strict";
import {
  fits,
  initial,
  plan,
  timestamp,
  validDate,
} from "../src/planner/engine";
const goal = {
  id: "english",
  name: "English",
  days: [0, 1, 2, 3, 4, 5, 6],
  duration: 45,
  preferred: 780,
  priority: 2,
  restDays: 0,
  reminder: 10,
  flexible: true,
};
const now = Date.parse("2030-01-01T00:00:00+07:00");
test("planner fills seven days without duplicate sessions on regeneration", () => {
  const s = initial();
  s.goals = [goal];
  const first = plan(s, "2030-01-01", "normal", now);
  assert.equal(first.state.sessions.length, 7);
  assert.equal(
    plan(first.state, "2030-01-01", "normal", now).state.sessions.length,
    7,
  );
  assert.equal(s.sessions.length, 0);
});
test("fixed appointment and breaks are respected", () => {
  const s = initial();
  s.goals = [goal];
  s.sessions = [
    {
      id: "meeting",
      name: "Interview",
      date: "2030-01-01",
      start: 780,
      duration: 60,
      status: "planned",
      fixed: true,
      reminder: 10,
    },
  ];
  const result = plan(s, "2030-01-01", "normal", now);
  assert.equal(result.state.sessions[0].start, 780);
  const session = result.state.sessions.find(
    (x) => x.goalId && x.date === "2030-01-01",
  )!;
  assert.ok(
    session.start + session.duration + 15 <= 780 || session.start >= 855,
  );
});
test("daily budget applies to fixed-time habits too", () => {
  const s = initial();
  s.settings.maxMinutes = 30;
  s.goals = [{ ...goal, flexible: false }];
  const result = plan(s, "2030-01-01", "normal", now);
  assert.equal(result.state.sessions.length, 0);
  assert.equal(result.unscheduled.length, 7);
});
test("rest days and reduced duration", () => {
  const s = initial();
  s.goals = [{ ...goal, restDays: 1 }];
  const result = plan(s, "2030-01-01", "low", now);
  assert.equal(result.state.sessions.length, 4);
  assert.ok(result.state.sessions.every((x) => x.duration === 20));
});
test("skipped sessions are not recreated and past times are excluded", () => {
  const s = initial();
  s.goals = [goal];
  const result = plan(s, "2030-01-01", "normal", now).state;
  result.sessions[0].status = "skipped";
  assert.equal(
    plan(result, "2030-01-01", "normal", now).state.sessions.length,
    7,
  );
  assert.equal(
    plan(s, "2030-01-01", "normal", now + 86400000).state.sessions.length,
    6,
  );
});
test("calendar validation and Bangkok timestamps", () => {
  assert.equal(validDate("2030-02-30"), false);
  assert.equal(validDate("2030-02-28"), true);
  assert.equal(
    new Date(timestamp("2030-01-01", 480)).toISOString(),
    "2030-01-01T01:00:00.000Z",
  );
});
test("moves cannot overlap, exceed sleep or capacity", () => {
  const s = initial();
  s.goals = [goal];
  const x = plan(s, "2030-01-01", "normal", now).state.sessions[0];
  s.sessions = [x];
  assert.equal(fits(s, { ...x, id: "other", start: x.start + 30 }, now), false);
  assert.equal(fits(s, { ...x, start: 1310 }, now), false);
  assert.equal(fits(s, { ...x, start: 900 }, now), true);
});
