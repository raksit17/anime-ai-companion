import { randomUUID } from "node:crypto";
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
  date: string;
  start: number;
  duration: number;
  status: "planned" | "done" | "skipped" | "deferred";
  fixed: boolean;
  reminder: number;
  notified?: boolean;
  note?: string;
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
export function fits(state: State, session: Session, now: number) {
  const { wake, sleep, breakMinutes, maxMinutes } = state.settings;
  const dailyLimit = state.capacityOverrides?.[session.date] ?? maxMinutes;
  const others = state.sessions.filter(
    (s) =>
      s.id !== session.id &&
      s.date === session.date &&
      (s.status === "planned" || s.status === "done"),
  );
  return (
    session.start >= wake &&
    session.start + session.duration <= sleep &&
    timestamp(session.date, session.start) >= now &&
    others.every(
      (s) =>
        session.start + session.duration + breakMinutes <= s.start ||
        session.start >= s.start + s.duration + breakMinutes,
    ) &&
    (!session.goalId ||
      others.filter((s) => !!s.goalId).reduce((n, s) => n + s.duration, 0) +
        session.duration <=
        dailyLimit)
  );
}

/** Swap the positions of two flexible, unfinished sessions on the same day.
 * Reflow later flexible sessions only as far as mandatory breaks require.
 * Completed and fixed sessions remain anchored; if an anchored task or
 * bedtime makes the swap impossible, reject the entire change.
 */
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
