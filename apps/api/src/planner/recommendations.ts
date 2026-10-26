import { randomUUID } from "node:crypto";
import {
  actualWorkedMinutes, activityKeyFor, classifyActivity, fits,
  occupiedMinutes, Session, State, timestamp, today, validDate,
} from "./engine";

export type HabitSuggestion = {
  sessionId: string;
  activityKey: string;
  category: string;
  name: string;
  evidenceCount: number;
  preferredStart: number;
  plannedStart: number;
  confidence: "high" | "medium";
  reason: string;
};

export type HabitDayPreview = {
  date: string;
  energy: "normal" | "low";
  sessions: Session[];
  suggestions: HabitSuggestion[];
  reasons: string[];
  unscheduled: string[];
  breakMinutes: number;
};

const weekday = (date: string) => new Date(date + "T12:00:00Z").getUTCDay();
const isWorkday = (date: string) => weekday(date) >= 1 && weekday(date) <= 5;
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
};
const clock = (minutes: number) =>
  String(Math.floor(minutes / 60)).padStart(2, "0") + ":" +
  String(minutes % 60).padStart(2, "0");

/**
 * A deterministic scheduler: use verified completions, not an LLM's guess.
 * Nothing is persisted here. The caller must save a revision-bound proposal
 * and then require the existing confirmation endpoint.
 */
export function recommendDay(
  input: State,
  date: string,
  energy: "normal" | "low",
  now = Date.now(),
  days = 90,
  maxSuggestions = 5,
): HabitDayPreview {
  if (!validDate(date) || date < today(now) ||
      timestamp(date, 0) > now + 366 * 86400000)
    throw new Error("แนะนำได้เฉพาะวันนี้หรือวันภายในหนึ่งปีข้างหน้า");
  if (energy !== "normal" && energy !== "low")
    throw new Error("ระดับพลังงานไม่ถูกต้อง");
  const durationDays = Math.max(7, Math.min(365, Math.floor(days) || 90));
  const start = new Date(Date.parse(today(now)) - (durationDays - 1) * 86400000)
    .toISOString().slice(0, 10);
  const work: State = structuredClone(input);
  work.settings.breakMinutes = Math.max(15, work.settings.breakMinutes);
  const groups = new Map<string, Session[]>();
  for (const session of input.sessions) {
    // Planned, skipped, deferred and future sessions are not completion evidence.
    if (session.status !== "done" || session.date < start ||
        session.date >= date || session.date > today(now)) continue;
    const key = session.activityKey ?? activityKeyFor(session.name);
    groups.set(key, [...(groups.get(key) ?? []), session]);
  }
  type Candidate = {
    key: string; name: string; category: string; preferred: number;
    duration: number; evidence: number; confidence: "high" | "medium";
    score: number; goalId?: string; fixed: boolean; reminder: number;
    reason: string;
  };
  const candidates: Candidate[] = [];
  const day = weekday(date);
  for (const [key, records] of groups) {
    if (new Set(records.map((s) => s.date)).size < 3) continue;
    const exact = records.filter((s) => weekday(s.date) === day);
    const sameType = records.filter((s) => isWorkday(s.date) === isWorkday(date));
    const evidence = exact.length >= 2 ? exact : sameType;
    if (evidence.length < 3 && !(exact.length >= 2 &&
        new Set(exact.map((s) => s.date)).size >= 2)) continue;
    // Repetition within only one week is not yet a routine.
    const weeks = new Set(evidence.map((s) =>
      Math.floor(Date.parse(s.date) / 604800000)));
    if (weeks.size < 2) continue;
    const preferred = Math.round(median(evidence.map((s) => s.start)) / 15) * 15;
    const consistent = evidence.filter((s) =>
      Math.abs(s.start - preferred) <= 60).length;
    if (consistent < Math.max(2, Math.ceil(evidence.length * 0.6))) continue;
    const sample = evidence.find((s) => !!s.name)!;
    const goal = input.goals.find((g) => activityKeyFor(g.name) === key);
    if (goal && (!goal.days.includes(day) ||
        input.suppressedOccurrences?.[goal.id]?.includes(date))) continue;
    const alreadyScheduled = work.sessions.some((s) =>
      s.date === date &&
      ((s.activityKey ?? activityKeyFor(s.name)) === key ||
        (goal && s.goalId === goal.id)));
    if (alreadyScheduled) continue;
    if (goal?.restDays && work.sessions.some((s) =>
      s.goalId === goal.id &&
      (s.status === "planned" || s.status === "done") &&
      Math.abs(Date.parse(date) - Date.parse(s.date)) / 86400000 <= goal.restDays))
      continue;
    const actualSamples = evidence.map(actualWorkedMinutes).filter(
      (v): v is number => v !== null && v > 0);
    const booked = evidence.map((s) => s.duration);
    const typicalDuration = median(actualSamples.length >= 2 ? actualSamples : booked);
    const duration = Math.max(10, Math.min(energy === "low" ? 20 : 120,
      Math.round((goal?.duration ?? typicalDuration) / 5) * 5));
    const high = exact.length >= 3 && weeks.size >= 3;
    candidates.push({
      key, name: goal?.name ?? sample.name,
      category: sample.category ?? classifyActivity(sample.name),
      preferred: goal?.preferred ?? preferred, duration,
      evidence: evidence.length, confidence: high ? "high" : "medium",
      score: (exact.length >= 2 ? 100 : 0) + evidence.length * 10 +
        (goal?.priority ?? 1),
      goalId: goal?.id, fixed: goal ? !goal.flexible : false,
      reminder: goal?.reminder ?? 10,
      reason: (exact.length >= 2 ? "เคยทำสำเร็จในวันเดียวกัน" :
        "เคยทำสำเร็จในช่วงวันประเภทเดียวกัน") +
        " " + evidence.length + " ครั้ง ใกล้เวลา " + clock(preferred),
    });
  }
  candidates.sort((a, b) => b.score - a.score || a.preferred - b.preferred);
  const suggestions: HabitSuggestion[] = [];
  const reasons: string[] = [];
  const unscheduled: string[] = [];
  for (const candidate of candidates.slice(0, 20)) {
    if (suggestions.length >= Math.max(1, Math.min(6, maxSuggestions))) break;
    const current = work.sessions.filter((s) =>
      s.date === date && !s.fixed &&
      (s.status === "planned" || s.status === "done"));
    const used = current.reduce((n, s) => n + occupiedMinutes(s), 0);
    const cap = work.capacityOverrides?.[date] ?? work.settings.maxMinutes;
    if (used + candidate.duration > cap) {
      unscheduled.push(candidate.name + ": เกินเพดานกิจกรรมยืดหยุ่นรายวัน");
      continue;
    }
    const base: Session = {
      id: randomUUID(), goalId: candidate.goalId ?? "habit:" + candidate.key,
      activityKey: candidate.key, category: candidate.category as Session["category"],
      name: candidate.name, date, start: candidate.preferred,
      duration: candidate.duration, status: "planned",
      fixed: candidate.fixed, reminder: candidate.reminder,
    };
    // Search at most two hours around the observed habit. Never move other work.
    const offsets = candidate.fixed ? [0] :
      [0, ...Array.from({ length: 8 }, (_, i) => (i + 1) * 15)
        .flatMap((offset) => [offset, -offset])];
    const slot = offsets.map((offset) => candidate.preferred + offset)
      .find((start) => start >= 0 && start <= 1439 &&
        fits(work, { ...base, start }, now));
    if (slot === undefined) {
      unscheduled.push(candidate.name +
        ": ไม่มีช่วงว่างใกล้เวลาเดิม โดยไม่ชนกิจกรรมหรือเวลาพัก");
      continue;
    }
    const placed = { ...base, start: slot };
    work.sessions.push(placed);
    suggestions.push({
      sessionId: placed.id, activityKey: candidate.key,
      category: candidate.category, name: candidate.name,
      evidenceCount: candidate.evidence,
      preferredStart: candidate.preferred, plannedStart: slot,
      confidence: candidate.confidence,
      reason: candidate.reason + (slot !== candidate.preferred
        ? " (เลื่อนเวลาเสนอเป็น " + clock(slot) + " เพื่อไม่ให้ชนตาราง)" : ""),
    });
    reasons.push(candidate.name + ": " + suggestions[suggestions.length - 1].reason);
  }
  if (!candidates.length)
    unscheduled.push("ข้อมูลทำสำเร็จในหลายสัปดาห์ยังไม่พอสำหรับสร้างแผนจากนิสัย");
  if (candidates.length && !suggestions.length && !unscheduled.length)
    unscheduled.push("ไม่พบช่วงเวลาที่ตรงกับข้อจำกัดตารางวันนี้");
  return { date, energy, sessions: work.sessions, suggestions, reasons,
    unscheduled, breakMinutes: work.settings.breakMinutes };
}
