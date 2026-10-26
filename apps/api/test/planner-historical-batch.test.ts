import test from "node:test";
import assert from "node:assert/strict";
import { initial, today, type Session } from "../src/planner/engine";
import {
  parseHistoricalBatch, historicalActivityKey, planHistoricalBatch,
} from "../src/planner/historical-batch";

const addDays = (date: string, days: number) =>
  new Date(Date.parse(date) + days * 86400000).toISOString().slice(0, 10);
const screenshot = "พรุ่งนี้จัดเวลาที่ ทำความสะอาด,ออกกำลังกาย,หางาน,ฝึกสัมภาษณ์ ชาวต่างชาติ อ่านข่าว bbc,ติว toeic,ฝึกฟังอังกฤษ youtube streamer .เพิ่มสำหรับพรุ่งนี้";
function sample(name: string, date: string, start: number, duration: number,
  status: Session["status"] = "done"): Session {
  return { id: name + date, name, date, start, duration,
    fixed: false, reminder: 10, status };
}

test("parses exact Android screenshot: seven independent activities, tomorrow, no model guess", () => {
  const now = Date.parse("2026-10-26T23:05:00+07:00");
  const result = parseHistoricalBatch(screenshot, "2026-10-27", now);
  assert.deepEqual(result, {
    date: "2026-10-27",
    names: ["ทำความสะอาด", "ออกกำลังกาย", "หางาน",
      "ฝึกสัมภาษณ์ ชาวต่างชาติ", "อ่านข่าว bbc",
      "ติว toeic", "ฝึกฟังอังกฤษ youtube streamer"],
    durations: Array.from({ length: 7 }, () => undefined),
  });
  assert.equal(parseHistoricalBatch("ยูนะวิเคราะห์แผนเก่าให้หน่อย", "2026-10-27", now), undefined);
  assert.equal(parseHistoricalBatch("ฝึกสัมภาษณ์ 15:00 วันพรุ่งนี้ และ TOEIC", "2026-10-27", now), undefined);
});

test("historical matching is topic specific rather than lumping all studying together", () => {
  assert.equal(historicalActivityKey("อ่านข่าว BBC"), historicalActivityKey("อ่านข่าว bbc"));
  assert.equal(historicalActivityKey("ติว TOEIC"), historicalActivityKey("เรียน TOEIC"));
  assert.notEqual(historicalActivityKey("ฝึกสัมภาษณ์"), historicalActivityKey("ติว TOEIC"));
  assert.notEqual(historicalActivityKey("อ่านข่าว BBC"), historicalActivityKey("ฝึกฟังอังกฤษ youtube streamer"));
});

test("seven tasks are allocated tomorrow using actual previous plans, within capacity with breaks", () => {
  const now = Date.parse("2026-10-26T23:05:00+07:00");
  const state = initial();
  state.settings.sleep = 1260; // 08:00–21:00
  state.sessions.push(
    sample("อ่านข่าว BBC", "2026-10-24", 570, 30, "done"),
    sample("ติว TOEIC", "2026-10-23", 720, 40, "done"),
    sample("ทำความสะอาดห้อง", "2026-10-24", 540, 30, "planned"),
  );
  const request = parseHistoricalBatch(screenshot, "2026-10-27", now)!;
  const original = structuredClone(state);
  const result = planHistoricalBatch(state, request, now);
  assert.equal(result.commands.length, 7);
  assert.equal(result.booked.length, 7);
  assert.deepEqual(state, original);
  assert.ok(result.commands.every((a) => a.date === "2026-10-27"));
  assert.ok(result.booked.reduce((sum, s) => sum + s.duration, 0) <= 240);
  const sorted = [...result.booked].sort((a, b) => a.start - b.start);
  assert.ok(sorted.every((s) => s.start >= 480 && s.start + s.duration <= 1260));
  for (let i = 1; i < sorted.length; i++)
    assert.ok(sorted[i].start >= sorted[i-1].start + sorted[i-1].duration + 15);
  assert.equal(result.evidence.find((x) => x.name === "อ่านข่าว bbc")?.kind, "completed");
  assert.equal(result.evidence.find((x) => x.name === "ทำความสะอาด")?.kind, "planned");
  assert.equal(result.evidence.find((x) => x.name === "ฝึกสัมภาษณ์ ชาวต่างชาติ")?.kind, "none");
});

test("already booked activities are not duplicated; preserves appointments", () => {
  const now = Date.parse("2026-10-26T23:05:00+07:00");
  const state = initial();
  const date = "2026-10-27";
  state.sessions = [
    { ...sample("ติว toeic", date, 720, 30, "planned"), fixed: false },
    { ...sample("พบแพทย์", date, 600, 60, "planned"), fixed: true },
  ];
  const before = structuredClone(state);
  const result = planHistoricalBatch(state, parseHistoricalBatch(screenshot, date, now)!, now);
  assert.equal(result.booked.length, 6);
  assert.ok(!result.booked.some((s) => historicalActivityKey(s.name) === "toeic"));
  assert.deepEqual(state, before);
  assert.ok(result.booked.every((s) =>
    s.start + s.duration + 15 <= 600 || s.start >= 675));
});

test("all-or-nothing when explicit durations cannot fit; never silently shorten them", () => {
  const now = Date.parse("2026-10-26T23:05:00+07:00");
  const state = initial();
  state.settings.maxMinutes = 60;
  const request = parseHistoricalBatch("พรุ่งนี้จัดเวลาที่ อ่านข่าว BBC 60 นาที,ติว TOEIC 60 นาที", today(now), now)!;
  const result = planHistoricalBatch(state, request, now);
  assert.equal(result.commands.length, 0);
  assert.equal(result.booked.length, 0);
  assert.match(result.notice, /ยังจัดทั้ง/);
  assert.equal(state.sessions.length, 0);
});

test("one completed task from the last four days guides historical time without claiming a habit", () => {
  const now = Date.parse("2026-10-26T23:05:00+07:00");
  const state = initial();
  state.sessions = [sample("อ่านข่าว BBC", "2026-10-24", 570, 45)];
  const result = planHistoricalBatch(state, {
    date: "2026-10-27", names: ["อ่านข่าว bbc"], durations: [undefined],
  }, now);
  assert.equal(result.evidence[0].matches, 1);
  assert.equal(result.evidence[0].preferredStart, 570);
  assert.equal(result.evidence[0].kind, "completed");
  assert.equal(result.commands[0].start, 570);
  assert.match(result.notice, /ไม่ถือเป็นกิจวัตร/);
});

test("today at 23:05 does not book morning slots in the past", () => {
  const now = Date.parse("2026-10-26T23:05:00+07:00");
  const state = initial();
  const result = planHistoricalBatch(state, {
    date: today(now), names: ["อ่านข่าว BBC", "ฝึก TOEIC"], durations: [30, 30],
  }, now);
  assert.equal(result.booked.length, 0);
  assert.equal(state.sessions.length, 0);
});
