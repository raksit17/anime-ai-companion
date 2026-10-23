import { randomUUID } from "node:crypto";
import { fits, Session, State, timestamp, today } from "./engine";
export const addDays = (date: string, n: number) =>
  new Date(Date.parse(date) + n * 86400000).toISOString().slice(0, 10);
export function weeklyReview(state: State, now = Date.now()) {
  const current = today(now),
    weekday = new Date(current).getUTCDay();
  const weekKey = addDays(current, -((weekday + 6) % 7));
  const from = addDays(weekKey, -7),
    to = addDays(weekKey, -1);
  const rows = state.sessions.filter(
    (s) => s.goalId && s.date >= from && s.date <= to,
  );
  const goals = [...new Set(rows.map((s) => s.goalId!))].map((id) => {
    const entries = rows.filter((s) => s.goalId === id),
      done = entries.filter((s) => s.status === "done").length;
    return {
      id,
      name: state.goals.find((g) => g.id === id)?.name ?? entries[0].name,
      total: entries.length,
      done,
      skipped: entries.filter((s) => s.status === "skipped").length,
      missed: entries.filter((s) => s.status === "planned").length,
      deferred: entries.filter((s) => s.status === "deferred").length,
      completedMinutes: entries
        .filter((s) => s.status === "done")
        .reduce((n, s) => n + s.duration, 0),
      rate: done / entries.length,
      reduce: entries.length >= 3 && done / entries.length < 0.6,
    };
  });
  return {
    weekKey,
    from,
    to,
    total: rows.length,
    done: rows.filter((s) => s.status === "done").length,
    goals,
    recommendations: goals
      .filter((g) => g.reduce)
      .map(
        (g) =>
          `${g.name}: ทำสำเร็จ ${g.done}/${g.total} ครั้ง เสนอลดเวลาครั้งละ 25% ในแผนถัดไป โดยไม่เพิ่มงานชดเชย`,
      ),
  };
}
export function adapt(
  input: State,
  from: string,
  energy: "normal" | "low",
  event?: Omit<Session, "id" | "status" | "fixed" | "reminder">,
  now = Date.now(),
) {
  const state = structuredClone(input),
    review = weeklyReview(input, now),
    until = addDays(from, 6);
  const reasons: string[] = [],
    unscheduled: string[] = [];
  // Every plan reserves at least 15 minutes between activities. Never change saved settings.
  const breakMinutes = Math.max(15, state.settings.breakMinutes);
  const work = { ...state, settings: { ...state.settings, breakMinutes } };
  const candidates = state.sessions.filter(
    (s) =>
      (s.status === "planned" || s.status === "deferred") &&
      !s.fixed &&
      s.date >= from &&
      s.date <= until &&
      timestamp(s.date, s.start) >= now,
  );
  work.sessions = state.sessions.filter(
    (s) => !candidates.some((c) => c.id === s.id),
  );
  if (event) {
    const appointment: Session = {
      ...event,
      id: randomUUID(),
      fixed: true,
      status: "planned",
      reminder: 10,
    };
    if (!fits(work, appointment, now))
      throw new Error(
        "นัดใหม่ชนเวลาคงที่ กิจกรรมที่เริ่มแล้ว หรืออยู่นอกเวลาว่าง",
      );
    work.sessions.push(appointment);
  }
  candidates.sort(
    (a, b) =>
      (state.goals.find((g) => g.id === b.goalId)?.priority ?? 1) -
        (state.goals.find((g) => g.id === a.goalId)?.priority ?? 1) ||
      a.date.localeCompare(b.date) ||
      a.start - b.start ||
      a.id.localeCompare(b.id),
  );
  for (const old of candidates) {
    const goal = state.goals.find((g) => g.id === old.goalId);
    const reduce = review.goals.find((g) => g.id === old.goalId)?.reduce;
    // Base on goal duration so repeated previews/confirmations never compound reductions.
    const baseline = Math.min(old.duration, goal?.duration ?? old.duration);
    const target =
      energy === "low"
        ? Math.min(baseline, 20)
        : reduce
          ? Math.min(
              baseline,
              Math.max(10, Math.floor((goal?.duration ?? baseline) * 0.75)),
            )
          : baseline;
    let placed: Session | undefined;
    for (let day = 0; day < 7 && !placed; day++) {
      const date = addDays(old.date, day);
      if (date > until) break;
      if (day > 0 && goal && !goal.days.includes(new Date(date).getUTCDay()))
        continue;
      if (
        goal &&
        work.sessions.some(
          (s) =>
            s.goalId === goal.id &&
            (s.status === "planned" || s.status === "done") &&
            Math.abs(Date.parse(s.date) - Date.parse(date)) / 86400000 <=
              goal.restDays,
        )
      )
        continue;
      const slots = [
        old.start,
        ...Array.from({ length: 96 }, (_, i) => i * 15),
      ];
      for (const start of slots) {
        const next: Session = {
          ...old,
          date,
          start,
          duration: target,
          status: "planned",
          notified: false,
        };
        if (fits(work, next, now)) {
          placed = next;
          break;
        }
      }
    }
    if (placed) {
      if (
        placed.date === old.date &&
        placed.start === old.start &&
        old.status === "planned"
      )
        placed.notified = old.notified;
      work.sessions.push(placed);
      if (placed.duration !== old.duration)
        reasons.push(
          `${old.name}: ลด ${old.duration} → ${placed.duration} นาที (${energy === "low" ? "พลังงานต่ำ" : "สัปดาห์ก่อนทำไม่ทัน"})`,
        );
      if (placed.date !== old.date || placed.start !== old.start)
        reasons.push(
          `${old.name}: ย้ายเพื่อหลีกเลี่ยงนัดและเว้นพัก ${breakMinutes} นาที`,
        );
    } else {
      work.sessions.push({ ...old, status: "deferred", notified: false });
      unscheduled.push(
        `${old.date}: ${old.name} — พักไว้ ยังหาช่วงที่เหมาะสมไม่ได้ ไม่ถือว่าข้ามหรือสำเร็จ`,
      );
    }
  }
  return {
    sessions: work.sessions,
    unscheduled,
    reasons,
    review,
    breakMinutes,
  };
}
