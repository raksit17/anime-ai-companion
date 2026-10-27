import {
  actualWorkedMinutes, classifyActivity, occupiedEnd, Session, State,
  timestamp, validDate,
} from "./engine";

/** All figures describe SAVED calendar slots, not an inferred activity log.
 * Actual durations are reported separately only when both timestamps exist.
 */
export type DailyTimeKind = "activity" | "break" | "free" | "sleep";
export type DailyTimeSegment = {
  start: number;
  end: number;
  minutes: number;
  kind: DailyTimeKind;
  category: string;
  label: string;
  status?: "done" | "planned";
};
export type DailyCategoryCluster = {
  category: string;
  minutes: number;
  completedMinutes: number;
  plannedMinutes: number;
  sessions: number;
  done: number;
  actualMinutes: number;
  actualSamples: number;
};
export type DailyTimeAnalytics = {
  date: string;
  timezone: "Asia/Bangkok";
  wake: number;
  sleep: number;
  totalMinutes: number;
  awakeMinutes: number;
  sleepMinutes: number;
  reservedMinutes: number;
  completedBookedMinutes: number;
  plannedBookedMinutes: number;
  breakMinutes: number;
  freeMinutes: number;
  futureFreeMinutes: number;
  freePercentOfAwake: number;
  actualMeasuredMinutes: number;
  actualSampleCount: number;
  noActualStartCount: number;
  unknownTimeCount: number;
  unknownTimeReportedMinutes: number;
  ignoredSessions: number;
  overlappedMinutes: number;
  categories: DailyCategoryCluster[];
  timeline: DailyTimeSegment[];
  freeWindows: Array<{ start: number; end: number; minutes: number }>;
  note: string;
};

type Cell = {
  kind: DailyTimeKind;
  category: string;
  label: string;
  status?: "done" | "planned";
};
const unallocated = (): Cell => ({ kind: "free", category: "free", label: "เวลาว่าง" });
const sameCell = (a: Cell, b: Cell) =>
  a.kind === b.kind && a.category === b.category &&
  a.label === b.label && a.status === b.status;
const categoryFor = (s: Session) => s.category ?? classifyActivity(s.name);

/** Return a complete 24h allocation; sleeping time is NEVER treated as free.
 * Breaks are only reserved BETWEEN distinct saved activities. The rest of a
 * gap remains free, so any unused time is not mistakenly counted as rest.
 */
export function analyzeDay(
  state: State,
  date: string,
  now = Date.now(),
): DailyTimeAnalytics {
  if (!validDate(date)) throw new Error("วันที่ไม่ถูกต้อง");
  const { wake, sleep, breakMinutes } = state.settings;
  if (!Number.isInteger(wake) || !Number.isInteger(sleep) ||
      wake < 0 || sleep > 1440 || sleep <= wake)
    throw new Error("ช่วงเวลาตื่น–นอนไม่ถูกต้อง");

  // Minute-resolution strips prevent overlap or out-of-bounds records from
  // being counted twice. A "done" record takes priority on a shared slot.
  const cells: Cell[] = Array.from({ length: 1440 }, (_, minute) =>
    minute >= wake && minute < sleep ? unallocated() :
      { kind: "sleep", category: "sleep", label: "นอน / นอกเวลาตื่น" });
  const unknownTime = state.sessions.filter((s) => s.date === date &&
    s.status === "done" && s.historicalTimeAccuracy === "unknown");
  const active = state.sessions
    .filter((s) => s.date === date &&
      s.historicalTimeAccuracy !== "unknown" &&
      (s.status === "done" || s.status === "planned"))
    .sort((a, b) => a.start - b.start ||
      Number(b.status === "done") - Number(a.status === "done") ||
      a.id.localeCompare(b.id));
  let overlappedMinutes = 0;
  let completedBookedMinutes = 0;
  let plannedBookedMinutes = 0;
  const clusters = new Map<string, DailyCategoryCluster>();
  let actualMeasuredMinutes = 0;
  let actualSampleCount = 0;
  let noActualStartCount = 0;
  for (const session of active) {
    const category = categoryFor(session);
    const cluster = clusters.get(category) ?? {
      category, minutes: 0, completedMinutes: 0, plannedMinutes: 0,
      sessions: 0, done: 0, actualMinutes: 0, actualSamples: 0,
    };
    cluster.sessions++;
    if (session.status === "done") {
      cluster.done++;
      const actual = actualWorkedMinutes(session);
      if (actual === null) noActualStartCount++;
      else {
        cluster.actualMinutes += actual;
        cluster.actualSamples++;
        actualMeasuredMinutes += actual;
        actualSampleCount++;
      }
    }
    clusters.set(category, cluster);
    const start = Math.max(wake, 0, Math.floor(session.start));
    const end = Math.min(sleep, 1440, Math.ceil(occupiedEnd(session)));
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    for (let minute = start; minute < end; minute++) {
      if (cells[minute].kind !== "free") { overlappedMinutes++; continue; }
      cells[minute] = {
        kind: "activity", category, label: session.name,
        status: session.status as "done" | "planned",
      };
      cluster.minutes++;
      if (session.status === "done") { cluster.completedMinutes++; completedBookedMinutes++; }
      else { cluster.plannedMinutes++; plannedBookedMinutes++; }
    }
  }

  // Occupied runs may have different adjacent categories, but they still
  // form ONE contiguous booked interval when allocating mandatory breaks.
  const workRuns: Array<{ start: number; end: number }> = [];
  for (let i = wake; i < sleep;) {
    if (cells[i].kind !== "activity") { i++; continue; }
    const start = i;
    while (i < sleep && cells[i].kind === "activity") i++;
    workRuns.push({ start, end: i });
  }
  const restGap = Math.max(15, Math.min(120, Number.isFinite(breakMinutes) ? breakMinutes : 15));
  let requiredBreak = 0;
  for (let i = 0; i + 1 < workRuns.length; i++) {
    const prev = workRuns[i], next = workRuns[i + 1];
    const end = Math.min(prev.end + restGap, next.start);
    for (let minute = prev.end; minute < end; minute++) {
      if (cells[minute].kind !== "free") continue;
      cells[minute] = { kind: "break", category: "break", label: "เวลาพักระหว่างกิจกรรม" };
      requiredBreak++;
    }
  }

  const timeline: DailyTimeSegment[] = [];
  for (let i = 0; i < cells.length;) {
    const start = i, first = cells[i];
    while (i < cells.length && sameCell(cells[i], first)) i++;
    timeline.push({
      start, end: i, minutes: i - start,
      kind: first.kind, category: first.category,
      label: first.label, ...(first.status ? { status: first.status } : {}),
    });
  }
  const freeWindows = timeline.filter((x) => x.kind === "free")
    .map(({ start, end, minutes }) => ({ start, end, minutes }));
  const freeMinutes = freeWindows.reduce((sum, x) => sum + x.minutes, 0);
  // Only future unallocated minutes count as still remaining today.
  const futureFreeMinutes = date < new Date(now + 7 * 3600000).toISOString().slice(0, 10) ? 0 :
    date > new Date(now + 7 * 3600000).toISOString().slice(0, 10) ? freeMinutes :
    freeWindows.reduce((sum, x) =>
      sum + Math.max(0, x.end - Math.max(x.start,
        Math.ceil((now - timestamp(date, 0)) / 60000))), 0);
  const awakeMinutes = sleep - wake;
  const sleepMinutes = 1440 - awakeMinutes;
  const reservedMinutes = completedBookedMinutes + plannedBookedMinutes;
  if (reservedMinutes + requiredBreak + freeMinutes !== awakeMinutes)
    throw new Error("การคำนวณเวลาภายในหนึ่งวันไม่สมดุล");

  return {
    date, timezone: "Asia/Bangkok", wake, sleep,
    totalMinutes: 1440, awakeMinutes, sleepMinutes,
    reservedMinutes, completedBookedMinutes, plannedBookedMinutes,
    breakMinutes: requiredBreak, freeMinutes, futureFreeMinutes,
    freePercentOfAwake: Math.round((freeMinutes / awakeMinutes) * 100),
    actualMeasuredMinutes, actualSampleCount, noActualStartCount,
    unknownTimeCount: unknownTime.length,
    unknownTimeReportedMinutes: unknownTime.reduce((n, s) => n + s.duration, 0),
    ignoredSessions: state.sessions.filter((s) => s.date === date &&
      (s.status === "skipped" || s.status === "deferred")).length,
    overlappedMinutes,
    categories: [...clusters.values()].filter((x) => x.minutes > 0)
      .sort((a, b) => b.minutes - a.minutes || a.category.localeCompare(b.category)),
    timeline, freeWindows,
    note: (unknownTime.length ? "มี " + unknownTime.length + " กิจกรรมย้อนหลังที่ไม่ทราบช่วงเวลา (รวม " + unknownTime.reduce((n, s) => n + s.duration, 0) + " นาที) จึงไม่หักออกจากเวลาที่ไม่มีการจอง กราฟอาจแสดงช่องว่างมากกว่าความว่างจริง · " : "") + "แสดงการจัดสรรตามเวลาจอง ไม่ใช่เวลาที่ทำจริงทั้งหมด งานที่กดยืนยันเสร็จจะแสดงเป็นเสร็จตามตารางเดิม (คืนช่วงเวลาที่เสร็จก่อนกำหนดเมื่อมีเวลายืนยัน) ส่วนเวลาทำจริงนับเฉพาะงานที่มีทั้งเวลาเริ่มและสิ้นสุด การคำนวณวันเก่าใช้เวลาตื่น–นอนที่ตั้งค่าไว้ปัจจุบัน",
  };
}
