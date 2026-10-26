import { randomUUID } from "node:crypto";
import {
  ActivityCategory, Session, actualWorkedMinutes, activityKeyFor,
  classifyActivity, sessionActivityIdentity, today, timestamp,
} from "./engine";

export type ActivityEventKind =
  "created" | "moved" | "resized" | "rescheduled" | "started" |
  "completed" | "skipped" | "deferred" | "cancelled" | "updated";

export type ActivityEvent = {
  id: string;
  plannerId: string;
  sessionId: string;
  activityKey: string;
  category: ActivityCategory;
  kind: ActivityEventKind;
  occurredAt: Date;
  before: Session | null;
  after: Session | null;
};

/** Derive immutable audit records from a single committed transaction.
 * Never derive activity history from the 80 most recent chat messages.
 */
export function diffSessionEvents(
  before: Session[], after: Session[], at = new Date(),
): ActivityEvent[] {
  const old = new Map(before.map((session) => [session.id, session]));
  const next = new Map(after.map((session) => [session.id, session]));
  const result: ActivityEvent[] = [];
  for (const id of new Set([...old.keys(), ...next.keys()])) {
    const previous = old.get(id);
    const current = next.get(id);
    if (!previous && !current) continue;
    let kind: ActivityEventKind | undefined;
    if (!previous) kind = "created";
    else if (!current) kind = "cancelled";
    else if (previous.status !== current.status) {
      kind = current.status === "done" ? "completed" :
        current.status === "skipped" ? "skipped" :
        current.status === "deferred" ? "deferred" : "updated";
    } else if (!previous.actualStartedAt && current.actualStartedAt)
      kind = "started";
    else if (previous.date !== current.date || previous.start !== current.start)
      kind = previous.duration !== current.duration ? "rescheduled" : "moved";
    else if (previous.duration !== current.duration) kind = "resized";
    else if (previous.name !== current.name || previous.fixed !== current.fixed)
      kind = "updated";
    if (!kind) continue; // Ignore notification acknowledgements.
    const session = current ?? previous!;
    result.push({
      id: randomUUID(), plannerId: "local", sessionId: id,
      ...sessionActivityIdentity(session),
      kind, occurredAt: at,
      before: previous ?? null, after: current ?? null,
    });
  }
  return result;
}

type SnapshotEvent = Pick<ActivityEvent,
  "sessionId" | "activityKey" | "category" | "kind" | "occurredAt" | "before" | "after">;

export function computeHabitProfile(
  sessions: Session[],
  events: SnapshotEvent[],
  days = 90,
  now = Date.now(),
) {
  const durationDays = Math.max(7, Math.min(365, Math.floor(days) || 90));
  const latest = today(now);
  const start = new Date(Date.parse(latest) - (durationDays - 1) * 86400000)
    .toISOString().slice(0, 10);
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const cancellations = new Map<string, SnapshotEvent>();
  // Preserve cancelled occurrences even after their slot was physically removed.
  for (const event of [...events].sort((a, b) =>
    new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime())) {
    if (event.kind === "cancelled" && event.before && !event.after)
      cancellations.set(event.sessionId, event);
    else if (event.after)
      cancellations.delete(event.sessionId);
  }
  const rows: Array<{ session: Session; cancelled: boolean }> = [
    ...sessions.map((session) => ({ session, cancelled: false })),
    ...[...cancellations].filter(([id]) => !byId.has(id))
      .map(([, e]) => ({ session: e.before!, cancelled: true })),
  ].filter(({ session }) => session.date >= start && session.date <= latest);
  const clusters = new Map<string, {
    activityKey: string; category: ActivityCategory; name: string;
    total: number; done: number; skipped: number; missed: number;
    pending: number; cancelled: number; scheduledMinutes: number;
    observedActualMinutes: number; actualSamples: number;
    starts: number[]; weekdays: Record<number, number>;
  }>();
  for (const { session: s, cancelled } of rows) {
    const identity = {
      activityKey: s.activityKey ?? activityKeyFor(s.name),
      category: s.category ?? classifyActivity(s.name),
    };
    let group = clusters.get(identity.activityKey);
    if (!group) {
      group = { ...identity, name: s.name, total: 0, done: 0,
        skipped: 0, missed: 0, pending: 0, cancelled: 0,
        scheduledMinutes: 0, observedActualMinutes: 0, actualSamples: 0,
        starts: [], weekdays: {} };
      clusters.set(identity.activityKey, group);
    }
    group.total++;
    group.scheduledMinutes += s.duration;
    if (cancelled) group.cancelled++;
    else if (s.status === "done") {
      group.done++;
      group.starts.push(s.start);
      const actual = actualWorkedMinutes(s);
      if (actual !== null) { group.observedActualMinutes += actual; group.actualSamples++; }
      const weekday = new Date(s.date).getUTCDay();
      group.weekdays[weekday] = (group.weekdays[weekday] ?? 0) + 1;
    } else if (s.status === "skipped") group.skipped++;
    else if (s.status === "planned" && timestamp(s.date, s.start + s.duration) < now)
      group.missed++;
    else group.pending++;
  }
  const activities = [...clusters.values()].map(({ starts, weekdays, ...group }) => {
    const sorted = starts.sort((a, b) => a - b);
    const medianStart = sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : null;
    const preferredWeekday = Object.entries(weekdays).sort((a, b) =>
      b[1] - a[1])[0]?.[0];
    const completedRate = group.done + group.skipped + group.missed
      ? group.done / (group.done + group.skipped + group.missed) : null;
    return {
      ...group, completionRate: completedRate,
      averageActualMinutes: group.actualSamples
        ? Math.round(group.observedActualMinutes / group.actualSamples) : null,
      preferredStart: medianStart,
      preferredWeekday: preferredWeekday === undefined ? null : Number(preferredWeekday),
      evidenceCount: group.done,
      recurringPattern: group.done >= 3,
    };
  }).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  const categories = [...new Set(activities.map((s) => s.category))].map((category) => ({
    category,
    total: activities.filter((s) => s.category === category)
      .reduce((n, s) => n + s.total, 0),
    done: activities.filter((s) => s.category === category)
      .reduce((n, s) => n + s.done, 0),
  }));
  const recommendations = activities.filter((a) =>
    a.recurringPattern && a.completionRate !== null &&
    a.completionRate >= 0.5 && a.preferredStart !== null)
    .slice(0, 5)
    .map((a) => ({
      activityKey: a.activityKey, name: a.name,
      category: a.category, evidenceCount: a.done,
      suggestedMinutes: Math.max(5, Math.min(120,
        Math.round((a.scheduledMinutes / a.total) / 5) * 5)),
      preferredStart: Math.round(a.preferredStart! / 15) * 15,
      preferredWeekday: a.preferredWeekday,
      reason: "พบการทำสำเร็จ " + a.done +
        " ครั้งใน " + durationDays + " วัน (เป็นข้อเสนอ ไม่ใช่กำหนดการอัตโนมัติ)",
    }));
  const eventKinds = [...new Set(events.map((event) => event.kind))].map((kind) => ({
    kind, count: events.filter((event) => event.kind === kind &&
      new Date(event.occurredAt).getTime() >= Date.parse(start)).length,
  }));
  return {
    from: start, to: latest, days: durationDays,
    activityCount: rows.length,
    completed: rows.filter(({ session, cancelled }) => !cancelled && session.status === "done").length,
    cancelled: rows.filter(({ cancelled }) => cancelled).length,
    missingActualStarts: rows.filter(({ session, cancelled }) =>
      !cancelled && session.status === "done" && !session.actualStartedAt).length,
    activities, categories, eventKinds, recommendations,
    note: "สถิติอ้างอิงประวัติกิจกรรมที่บันทึกจริง ไม่ใช้แชตเดาผล งานเสร็จที่ไม่กดเริ่มจะไม่มีระยะเวลาทำจริง",
  };
}

export type HabitProfile = ReturnType<typeof computeHabitProfile>;
