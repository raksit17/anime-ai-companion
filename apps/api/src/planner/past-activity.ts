import { randomUUID } from "node:crypto";
import {
  actualWorkedMinutes, sessionActivityIdentity, timestamp, today, validDate,
  type Session, type State,
} from "./engine";

export type PastActivityInput = {
  name: string;
  date: string;
  duration: number;
  /** Omit when the user cannot recall the time. NEVER infer it. */
  start?: number;
  accuracy?: "exact" | "estimated";
  note?: string;
  requestId?: string;
};

export function makePastActivity(
  state: State, dto: PastActivityInput, now = Date.now(),
): Session {
  const name = dto.name?.trim();
  if (!name || name.length > 120) throw new Error("กรุณาระบุชื่อกิจกรรม 1–120 ตัวอักษร");
  const current = today(now);
  if (!validDate(dto.date) || dto.date > current ||
      dto.date < new Date(Date.parse(current) - 365 * 86400000).toISOString().slice(0, 10))
    throw new Error("บันทึกย้อนหลังได้ตั้งแต่วันนี้ถึง 365 วันที่ผ่านมา");
  if (!Number.isInteger(dto.duration) || dto.duration < 5 || dto.duration > 720)
    throw new Error("ระยะเวลาที่ทำต้องอยู่ระหว่าง 5–720 นาที");
  if (dto.note !== undefined && (typeof dto.note !== "string" || dto.note.length > 1000))
    throw new Error("บันทึกเพิ่มเติมยาวเกิน 1,000 ตัวอักษร");
  if (dto.start !== undefined &&
      (!Number.isInteger(dto.start) || dto.start < 0 ||
      dto.start + dto.duration > 1440))
    throw new Error("เวลาเริ่มและสิ้นสุดต้องอยู่ภายในวันเดียวกัน");
  if (dto.accuracy && !["exact", "estimated"].includes(dto.accuracy))
    throw new Error("ความแม่นยำของเวลาที่ระบุไม่ถูกต้อง");
  if (dto.start === undefined && dto.accuracy)
    throw new Error("อย่าระบุความแม่นยำถ้าไม่ทราบเวลาเริ่ม");
  if (dto.start !== undefined &&
      timestamp(dto.date, dto.start + dto.duration) > now)
    throw new Error("ยังไม่ถึงเวลาเสร็จของกิจกรรมที่ระบุ");
  if (dto.requestId !== undefined &&
      (typeof dto.requestId !== "string" || !/^[\w-]{1,100}$/.test(dto.requestId)))
    throw new Error("รหัสคำขอบันทึกไม่ถูกต้อง");

  const accuracy = dto.start === undefined ? "unknown" : dto.accuracy ?? "exact";
  if (dto.start !== undefined && state.sessions.some((other) =>
    other.date === dto.date &&
    (other.status === "done" || other.status === "planned") &&
    other.historicalTimeAccuracy !== "unknown" &&
    dto.start! < other.start + other.duration &&
    other.start < dto.start! + dto.duration))
    throw new Error("เวลานี้ทับซ้อนกับกิจกรรมที่มีอยู่ กรุณาตรวจหรือแก้ไขแผนเดิมก่อน");
  // A source-specific marker protects historical records from being
  // mistaken for a future booking, even when the recorded clock is unknown.
  const session: Session = {
    id: randomUUID(), name, date: dto.date, start: dto.start ?? 0,
    duration: dto.duration, status: "done", fixed: false, reminder: 0,
    historicalTimeAccuracy: accuracy,
    recordedAt: new Date(now).toISOString(),
    ...(dto.requestId ? { historicalRequestId: dto.requestId } : {}),
    ...(dto.note?.trim() ? { note: dto.note.trim() } : {}),
    ...(dto.start !== undefined ? {
      completedAt: new Date(timestamp(dto.date, dto.start + dto.duration)).toISOString(),
      ...(accuracy === "exact" ? {
        actualStartedAt: new Date(timestamp(dto.date, dto.start)).toISOString(),
      } : {}),
    } : {}),
  };
  return { ...session, ...sessionActivityIdentity(session) };
}

/** Parse explicitly retrospective Thai completion phrases only. An ordinary
 * planner request must never be silently marked complete.
 */
export function parsePastActivityMessage(
  message: string, now = Date.now(),
): PastActivityInput | undefined {
  const input = message.trim();
  if (!/(?:เมื่อวานซืน|เมื่อวาน|วันนี้|วันที่\s*\d{4}-\d{2}-\d{2})/u.test(input) ||
      !/(?:เสร็จแล้ว|ทำไปแล้ว|ทำแล้ว|ลืม(?:บันทึก|ลงตาราง|ใส่(?:ใน)?(?:แผน|ระบบ))|ไม่ได้(?:บันทึก|ลงตาราง|ใส่(?:ใน)?(?:แผน|ระบบ))|บันทึกย้อนหลัง)/u.test(input) ||
      /(?:\?|ไหม|หรือเปล่า)/u.test(input)) return undefined;
  const calendar = input.match(/วันที่\s*(\d{4}-\d{2}-\d{2})/u);
  const date = calendar?.[1] ??
    new Date(Date.parse(today(now)) -
      (/เมื่อวานซืน/u.test(input) ? 2 : /เมื่อวาน/u.test(input) ? 1 : 0) * 86400000)
      .toISOString().slice(0, 10);
  const durations = [...input.matchAll(/(\d{1,3})\s*(นาที|ชั่วโมง)/gu)];
  if (durations.length !== 1) return undefined;
  const duration = Number(durations[0][1]) *
    (durations[0][2] === "ชั่วโมง" ? 60 : 1);
  const clock = input.match(/(?:เวลา|ตอน)\s*(\d{1,2}):(\d{2})/u);
  const start = clock ? Number(clock[1]) * 60 + Number(clock[2]) : undefined;
  let name = input
    .replace(/วันที่\s*\d{4}-\d{2}-\d{2}|เมื่อวานซืน|เมื่อวาน|วันนี้/gu, " ")
    .replace(/(?:เวลา|ตอน)\s*\d{1,2}:\d{2}/gu, " ")
    .replace(/\d{1,3}\s*(?:นาที|ชั่วโมง)/gu, " ")
    .replace(/(?:แต่)?(?:ฉัน)?(?:ไม่ได้|ลืม)(?:บันทึก|ลงตาราง|ใส่(?:ใน)?(?:แผน|ระบบ))/gu, " ")
    .replace(/(?:ช่วย)?(?:บันทึกย้อนหลัง|บันทึกให้หน่อย|ลงตารางให้หน่อย|เสร็จแล้ว|ทำไปแล้ว|ทำแล้ว)/gu, " ")
    .replace(/^(?:ฉัน|เรา|ได้|ไป)\s*/u, "")
    .replace(/[.!?。]/gu, " ").replace(/\s+/gu, " ").trim();
  if (name.startsWith("ทำไป")) name = name.slice(4).trim();
  if (!name || name.length > 120 || !/[\p{L}]/u.test(name)) return undefined;
  return { name, date, duration, ...(start !== undefined ? { start, accuracy: "exact" as const } : {}) };
}

/** Records with unknown clocks cannot teach a time-of-day preference. */
export function knownPastTime(s: Session): boolean {
  return s.historicalTimeAccuracy !== "unknown" &&
    s.historicalTimeAccuracy !== "estimated";
}
