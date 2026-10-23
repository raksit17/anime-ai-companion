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
