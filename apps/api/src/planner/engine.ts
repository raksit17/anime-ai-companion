import { randomUUID } from "node:crypto";
export type ActivityCategory =
  "exercise" | "study" | "work" | "chores" | "wellbeing" | "other";

/** Stable across ad-hoc chat sessions, even when their goalId is random.
 * This key is NOT a user ID and should never identify the user.
 */
export function normalizeActivityName(name: string): string {
  return name.normalize("NFC").toLocaleLowerCase("th-TH")
    .replace(/^(?:งาน|กิจกรรม)\s*/u, "")
    .replace(/[\p{P}\p{S}\s]+/gu, " ").trim();
}
export function classifyActivity(name: string): ActivityCategory {
  const n = normalizeActivityName(name);
  if (/ออกกำลังกาย|ออกกำลัง|fitness|workout|วิ่ง|โยคะ/u.test(n)) return "exercise";
  if (/ทำความสะอาด|ล้างจาน|ซักผ้า|กวาด|จัดห้อง|เก็บห้อง/u.test(n)) return "chores";
  if (/นอน|พักผ่อน|สมาธิ|meditat/u.test(n)) return "wellbeing";
  if (/assignment|playtorium|หางาน|สมัครงาน|resume|project|โปรเจค|โปรเจกต์|โปรเจกต|ทำงาน/u.test(n)) return "work";
  if (/เรียน|ฝึก|ติว|ศึกษา|อ่านข่าว|ภาษาอังกฤษ|coding|code|devops|toeic|bbc/u.test(n)) return "study";
  return "other";
}
export function activityKeyFor(name: string): string {
  const n = normalizeActivityName(name)
    .replace(/\b(?:read|watch)\b/gu, "")
    .replace(/\s+/gu, " ").trim();
  // Group common title variations while leaving other distinct tasks alone.
  const alias = /^(?:ออกกำลัง(?:กาย)?|workout)$/u.test(n) ? "exercise" :
    /^(?:อ่านข่าว\s*bbc|bbc\s*(?:news|ข่าว)|อ่านข่าวจาก\s*bbc)$/u.test(n) ? "bbc-news" :
    /^(?:ทำความสะอาดห้อง|เก็บห้อง|จัดห้อง)$/u.test(n) ? "room-cleaning" :
    n;
  return classifyActivity(name) + ":" + (alias || "unnamed");
}
export function sessionActivityIdentity(session: Session) {
  return {
    activityKey: session.activityKey ?? activityKeyFor(session.name),
    category: session.category ?? classifyActivity(session.name),
  };
}
export type Goal = {
  id: string;
  name: string;
  duration: number;
  days: number[];
  preferred: number;
  priority: number;
  restDays: number;
  reminder: number;
  flexible: boolean;
};
export type Session = {
  id: string;
  goalId?: string;
  name: string;
  /** Identity for historical grouping; independent of goalId/session ID. */
  activityKey?: string;
  category?: ActivityCategory;
  date: string;
  start: number;
  duration: number;
  status: "planned" | "done" | "skipped" | "deferred";
  fixed: boolean;
  reminder: number;
  notified?: boolean;
  note?: string;
  /** ISO timestamp of actual confirmation. The original booked duration stays intact. */
  completedAt?: string;
  /** Actual start is recorded only when explicitly started, never guessed. */
  actualStartedAt?: string;
  /** Manually entered after the work; may have no remembered clock. */
  historicalTimeAccuracy?: "exact" | "estimated" | "unknown";
  historicalRequestId?: string;
  recordedAt?: string;
};
export type State = {
  goals: Goal[];
  sessions: Session[];
  // Deleted recurring occurrences must not be recreated by a later plan().
  // Other dates and the recurring goal template are unaffected.
  suppressedOccurrences?: Record<string, string[]>;
  // A user-approved exception applies to one calendar day only.
  capacityOverrides?: Record<string, number>;
  settings: {
    wake: number;
    sleep: number;
    breakMinutes: number;
    maxMinutes: number;
  };
  revision: number;
};
export const initial = (): State => ({
  goals: [],
  sessions: [],
  suppressedOccurrences: {},
  capacityOverrides: {},
  settings: { wake: 480, sleep: 1320, breakMinutes: 15, maxMinutes: 240 },
  revision: 0,
});
export function validDate(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
export function today(now = Date.now()) {
  return new Date(now + 7 * 3600000).toISOString().slice(0, 10);
}
export function timestamp(date: string, minutes: number) {
  return Date.parse(`${date}T00:00:00+07:00`) + minutes * 60000;
}
/** End of reserved time in Bangkok minutes. Early completion frees only
 * the unused tail of the booked slot, never overwrites planned duration.
 * Old completed records without a timestamp remain backwards compatible.
 */
export function occupiedEnd(session: Session): number {
  if (session.historicalTimeAccuracy === "unknown") return session.start;
  const scheduledEnd = session.start + session.duration;
  if (session.status !== "done" || !session.completedAt)
    return scheduledEnd;
  const finishedAt = Date.parse(session.completedAt);
  if (!Number.isFinite(finishedAt)) return scheduledEnd;
  // A task marked done BEFORE its booked start happened outside the planned
  // slot. We do not know when it actually started, and cannot treat the
  // entire booking as 100% "finished early" or recovered capacity.
  // Keep the booking reserved until the user explicitly cancels/moves it.
  if (finishedAt < timestamp(session.date, session.start))
    return scheduledEnd;
  const finishedOnDay = Math.ceil((finishedAt - timestamp(session.date, 0)) / 60000);
  return Math.min(scheduledEnd, finishedOnDay);
}

/** Different from completing a started booking early: a completion
 * timestamp earlier than the SCHEDULED start provides no measured work time
 * and no reliable reclaimable capacity.
 */
export function completedBeforeScheduledStart(session: Session): boolean {
  if (session.status !== "done" || !session.completedAt) return false;
  const actual = Date.parse(session.completedAt);
  return Number.isFinite(actual) &&
    actual < timestamp(session.date, session.start);
}

export function releasedEarlyMinutes(session: Session): number {
  return session.status === "done"
    ? Math.max(0, session.start + session.duration - occupiedEnd(session))
    : 0;
}

export function occupiedMinutes(session: Session): number {
  return Math.max(0, occupiedEnd(session) - session.start);
}

export function startSessionNow(session: Session, now = Date.now()): Session {
  if (session.status !== "planned" || session.actualStartedAt)
    throw new Error("เริ่มได้เฉพาะกิจกรรมที่ยังรอทำและยังไม่ได้กดเริ่ม");
  if (session.date !== today(now))
    throw new Error("บันทึกเวลาเริ่มจริงได้เฉพาะกิจกรรมวันนี้");
  return {
    ...session, ...sessionActivityIdentity(session),
    actualStartedAt: new Date(now).toISOString(),
  };
}

export function actualWorkedMinutes(session: Session): number | null {
  if (session.historicalTimeAccuracy === "unknown" ||
      session.historicalTimeAccuracy === "estimated") return null;
  if (!session.actualStartedAt || !session.completedAt) return null;
  const start = Date.parse(session.actualStartedAt);
  const end = Date.parse(session.completedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start)
    return null;
  return Math.round((end - start) / 60000);
}

export function finishSessionNow(session: Session, now = Date.now()): Session {
  if (session.status !== "planned")
    throw new Error("กิจกรรมนี้บันทึกผลแล้ว");
  return { ...session, ...sessionActivityIdentity(session), status: "done", completedAt: new Date(now).toISOString() };
}

export function fits(state: State, session: Session, now: number) {
  const { wake, sleep, breakMinutes, maxMinutes } = state.settings;
  const dailyLimit = state.capacityOverrides?.[session.date] ?? maxMinutes;
  const others = state.sessions.filter(
    (s) =>
      s.id !== session.id &&
      s.date === session.date &&
      (s.status === "planned" || s.status === "done") &&
      s.historicalTimeAccuracy !== "unknown",
  );
  return (
    session.start >= wake &&
    session.start + session.duration <= sleep &&
    timestamp(session.date, session.start) >= now &&
    others.every(
      (s) =>
        session.start + session.duration + breakMinutes <= s.start ||
        session.start >= occupiedEnd(s) + breakMinutes,
    ) &&
    (!session.goalId ||
      others.filter((s) => !!s.goalId).reduce((n, s) => n + occupiedMinutes(s), 0) +
        session.duration <=
        dailyLimit)
  );
}

/** Swap the positions of two flexible, unfinished sessions on the same day.
 * Reflow later flexible sessions only as far as mandatory breaks require.
 * Completed and fixed sessions remain anchored; if an anchored task or
 * bedtime makes the swap impossible, reject the entire change.
 */

/** Edit a single flexible session inline. Never move another task, mutate
 * history or silently shorten breaks. The backend is authoritative.
 */
export function editDaySessionTime(
  state: State,
  id: string,
  date: string,
  start: number,
  duration: number,
  now = Date.now(),
): Session {
  const existing = state.sessions.find((task) => task.id === id);
  if (!existing || existing.date !== date || !validDate(date))
    throw new Error("ไม่พบกิจกรรมในวันที่เลือก");
  if (existing.fixed || existing.status !== "planned")
    throw new Error("แก้เวลาได้เฉพาะกิจกรรมยืดหยุ่นที่ยังรอทำ");
  // A session whose clock time passed but is still "planned" is overdue,
  // not completed. Allow moving it to the future while protecting history.
  if (timestamp(date, start) <= now)
    throw new Error("ต้องเลือกเวลาเริ่มใหม่ที่ยังมาไม่ถึง");
  if (!Number.isInteger(start) || start < 0 || start > 1439 ||
      !Number.isInteger(duration) || duration < 5 || duration > 240)
    throw new Error("กรุณาระบุเวลาเริ่มและระยะเวลา 5–240 นาทีให้ถูกต้อง");
  if (start === existing.start && duration === existing.duration)
    throw new Error("เวลาและระยะเวลายังเหมือนเดิม");
  const proposed = { ...existing, start, duration, notified: false };
  // Enforce the 15-minute minimum on direct editing, even when a legacy
  // user setting contains a smaller break value.
  const strict: State = {
    ...state,
    settings: {
      ...state.settings,
      breakMinutes: Math.max(15, state.settings.breakMinutes),
    },
  };
  const asClock = (minutes: number) =>
    String(Math.floor(minutes / 60)).padStart(2, "0") + ":" +
    String(minutes % 60).padStart(2, "0");
  const plannedEnd = start + duration;
  if (start < strict.settings.wake)
    throw new Error("เวลาเริ่ม " + asClock(start) +
      " อยู่ก่อนเวลาเริ่มวัน " + asClock(strict.settings.wake));
  if (plannedEnd > strict.settings.sleep)
    throw new Error("เวลาเสร็จ " + asClock(plannedEnd) +
      " เกินเวลาเข้านอน " + asClock(strict.settings.sleep) +
      " กรุณาย้ายเวลาให้จบไม่เกิน " + asClock(strict.settings.sleep) +
      " หรือลดระยะเวลากิจกรรม");
  const gap = strict.settings.breakMinutes;
  const conflict = strict.sessions.find((s) =>
    s.id !== id && s.date === date &&
    (s.status === "planned" || s.status === "done") &&
    !(plannedEnd + gap <= s.start || start >= occupiedEnd(s) + gap));
  if (conflict)
    throw new Error("ช่วง " + asClock(start) + "–" +
      asClock(plannedEnd) + " ชนหรือพักไม่ครบ " + gap +
      " นาทีจากกิจกรรม " + conflict.name + " (" +
      asClock(conflict.start) + "–" +
      asClock(conflict.start + conflict.duration) +
      ") กรุณาเลือกเวลาอื่น");
  if (!fits(strict, proposed, now))
    throw new Error("ช่วงเวลานี้ไม่ผ่านเงื่อนไขตารางหรือเพดานกิจกรรมรายวัน กรุณาตรวจเวลาอีกครั้ง");
  // Non-recurring one-off activities are not accounted for by fits()'s
  // goal-based capacity guard. Preserve the current load, reject only
  // changes that add load beyond the daily cap.
  const oldMinutes = state.sessions.filter((task) =>
    task.date === date && task.status === "planned" && !task.fixed)
    .reduce((minutes, task) => minutes + task.duration, 0);
  const newMinutes = oldMinutes - existing.duration + duration;
  const limit = state.capacityOverrides?.[date] ?? state.settings.maxMinutes;
  if (newMinutes > oldMinutes && newMinutes > limit)
    throw new Error("การเพิ่มระยะเวลาเกินเพดานกิจกรรมยืดหยุ่นรายวัน");
  return proposed;
}

export function swapDaySessions(
  input: State,
  date: string,
  sourceId: string,
  targetId: string,
  now = Date.now(),
): { sessions: Session[]; changed: Session[] } {
  if (!validDate(date) || date < today(now))
    throw new Error("สลับได้เฉพาะกิจกรรมของวันนี้หรือวันในอนาคต");
  if (sourceId === targetId)
    throw new Error("กรุณาลากไปยังกิจกรรมอื่นเพื่อสลับลำดับ");
  const active = input.sessions
    .filter((s) => s.date === date && (s.status === "planned" || s.status === "done"))
    .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
  const sourceIndex = active.findIndex((s) => s.id === sourceId);
  const targetIndex = active.findIndex((s) => s.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0)
    throw new Error("ไม่พบสล็อตกิจกรรมที่ยังอยู่ในตารางวันนั้น");
  const eligible = (s: Session) =>
    s.status === "planned" && !s.fixed &&
    timestamp(s.date, s.start) > now;
  if (!eligible(active[sourceIndex]) || !eligible(active[targetIndex]))
    throw new Error("ลากสลับได้เฉพาะกิจกรรมยืดหยุ่นที่ยังไม่เริ่มและยังไม่เสร็จ");
  const first = Math.min(sourceIndex, targetIndex);
  const last = Math.max(sourceIndex, targetIndex);
  if (active.slice(first, last + 1).some((s) => !eligible(s)))
    throw new Error("สลับข้ามกิจกรรมที่ล็อกเวลา ทำเสร็จ หรือเริ่มไปแล้วไม่ได้");

  const reordered = [...active];
  [reordered[sourceIndex], reordered[targetIndex]] =
    [reordered[targetIndex], reordered[sourceIndex]];
  const gap = Math.max(15, input.settings.breakMinutes);
  const { wake, sleep } = input.settings;
  const changedById = new Map<string, Session>();
  let nextFree = wake;
  for (let index = 0; index < reordered.length; index++) {
    const activity = reordered[index];
    const oldSlotStart = active[index].start;
    // Preserve every unaffected slot's original time where possible.
    const desiredStart = index < first
      ? activity.start : Math.max(oldSlotStart, nextFree);
    if (!eligible(activity)) {
      if (desiredStart !== activity.start || activity.start < nextFree)
        throw new Error("การสลับชนกิจกรรมที่ล็อกเวลา หรือบันทึกเสร็จแล้ว");
      nextFree = activity.start + activity.duration + gap;
      continue;
    }
    if (desiredStart < wake || desiredStart + activity.duration > sleep ||
        timestamp(date, desiredStart) <= now)
      throw new Error("ลำดับใหม่นอกช่วงเวลาตื่น–นอน หรือกิจกรรมเริ่มไปแล้ว");
    if (desiredStart !== activity.start)
      changedById.set(activity.id, { ...activity, start: desiredStart, notified: false });
    nextFree = desiredStart + activity.duration + gap;
  }
  const sessions = input.sessions.map((s) => changedById.get(s.id) ?? s);
  const final = sessions.filter((s) =>
    s.date === date && (s.status === "planned" || s.status === "done"))
    .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
  for (let i = 0; i < final.length; i++) {
    const item = final[i];
    if (item.start < wake || item.start + item.duration > sleep ||
        (i > 0 && final[i - 1].start + final[i - 1].duration + gap > item.start))
      throw new Error("ตารางหลังสลับไม่ผ่านเงื่อนไขเวลาพักหรือเวลาเข้านอน");
  }
  return {
    sessions,
    changed: final.filter((s) => changedById.has(s.id)),
  };
}

export function plan(
  input: State,
  from: string,
  energy: "normal" | "low",
  now = Date.now(),
) {
  const state: State = structuredClone(input);
  const unscheduled: string[] = [];
  for (let day = 0; day < 7; day++) {
    const date = new Date(Date.parse(from) + day * 86400000)
      .toISOString()
      .slice(0, 10);
    const weekday = new Date(date).getUTCDay();
    for (const goal of [...state.goals].sort(
      (a, b) => b.priority - a.priority || a.id.localeCompare(b.id),
    )) {
      if (
        !goal.days.includes(weekday) ||
        state.sessions.some((s) => s.goalId === goal.id && s.date === date) ||
        state.suppressedOccurrences?.[goal.id]?.includes(date)
      )
        continue;
      if (
        state.sessions.some(
          (s) =>
            s.goalId === goal.id &&
            (s.status === "planned" || s.status === "done") &&
            Math.abs(Date.parse(s.date) - Date.parse(date)) / 86400000 <=
              goal.restDays,
        )
      ) {
        unscheduled.push(`${date}: ${goal.name} — เว้นวันพัก`);
        continue;
      }
      const session: Session = {
        id: randomUUID(),
        goalId: goal.id,
        name: goal.name,
        date,
        start: goal.preferred,
        duration:
          energy === "low" ? Math.min(goal.duration, 20) : goal.duration,
        status: "planned",
        fixed: !goal.flexible,
        reminder: goal.reminder,
      };
      const slots = goal.flexible
        ? [goal.preferred, ...Array.from({ length: 96 }, (_, i) => i * 15)]
        : [goal.preferred];
      const start = slots.find((start) =>
        fits(state, { ...session, start }, now),
      );
      if (start === undefined)
        unscheduled.push(`${date}: ${goal.name} — ไม่มีช่วงว่างที่เหมาะสม`);
      else state.sessions.push({ ...session, start });
    }
  }
  return { state, unscheduled };
}
