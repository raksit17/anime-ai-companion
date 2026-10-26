import {
  actualWorkedMinutes, activityKeyFor, fits, normalizeActivityName,
  type Session, type State, timestamp, today,
} from "./engine";
import { executeCommands, type Command } from "./chat-engine";

export type HistoricalBatch = {
  date: string;
  names: string[];
  durations: (number | undefined)[];
};
export type HistoricalBatchPlan = {
  commands: Command[];
  booked: Session[];
  evidence: Array<{ name: string; kind: "completed" | "planned" | "none";
    matches: number; preferredStart?: number; suggestedMinutes: number }>;
  notice: string;
};

const dayAdd = (base: string, offset: number) =>
  new Date(Date.parse(base) + offset * 86400000).toISOString().slice(0, 10);
const minute = (m: number) =>
  String(Math.floor(m / 60)).padStart(2, "0") + ":" +
  String(m % 60).padStart(2, "0");
const median = (numbers: number[]) => {
  const sorted = [...numbers].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
};

/** Narrow, explicit request detector; never reinterpret a conversational
 * list or an existing-slot edit as a new multi-activity booking.
 * Supports commas, Thai และ, and the colloquial "... เพิ่มสำหรับพรุ่งนี้".
 */
export function parseHistoricalBatch(
  message: string,
  selected: string,
  now = Date.now(),
): HistoricalBatch | undefined {
  const source = message.trim();
  if (!/(?:จัด(?:เวลา|ตาราง)|ลงตาราง|เพิ่ม(?:งาน|กิจกรรม|สำหรับ)?)/u.test(source) ||
      !/(?:[,，、]|(?:\s+และ\s+))/u.test(source) ||
      /(?:ได้ไหม|หรือเปล่า|\?)/u.test(source) ||
      /\d{1,2}:\d{2}/u.test(source)) return undefined;
  const relativeDays = [...source.matchAll(/วันนี้|พรุ่งนี้|พรุ้งนี้|มะรืน(?:นี้)?/gu)]
    .map((x) => x[0] === "พรุ้งนี้" ? "พรุ่งนี้" : x[0].startsWith("มะรืน") ? "มะรืน" : x[0]);
  if (new Set(relativeDays).size > 1) return undefined;
  const when = relativeDays[0];
  const date = when === "วันนี้" ? today(now) :
    when === "พรุ่งนี้" ? dayAdd(today(now), 1) :
    when === "มะรืน" ? dayAdd(today(now), 2) : selected;
  if (date < today(now)) return undefined;
  let body = source
    .replace(/[.。]\s*เพิ่ม(?:งาน|กิจกรรม)?สำหรับ(?:วัน)?(?:พรุ่งนี้|พรุ้งนี้|วันนี้|มะรืน(?:นี้)?)\s*$/u, "")
    .replace(/(?:ช่วย\s*)?(?:เพิ่ม(?:งาน|กิจกรรม)?|จัด(?:เวลา|ตาราง)(?:ให้|ที่)?|ลงตาราง)(?:\s*สำหรับ)?(?:วัน)?(?:พรุ่งนี้|พรุ้งนี้|วันนี้)?\s*$/u, "")
    .replace(/^(?:(?:วันนี้|พรุ่งนี้|พรุ้งนี้|มะรืน(?:นี้)?)\s*)?(?:ช่วย\s*)?(?:จัด(?:เวลา|ตาราง)(?:ให้|ที่)?|ลงตาราง|เพิ่ม(?:งาน|กิจกรรม)?)(?:ให้(?:ที|หน่อย))?\s*/u, "")
    .replace(/^(?:พรุ่งนี้|พรุ้งนี้|วันนี้|มะรืน(?:นี้)?)\s*/u, "")
    .replace(/(?:ให้หน่อย|ด้วยนะ|ด้วย|หน่อย|ครับ|ค่ะ)\s*$/u, "")
    .replace(/\s+(?=อ่านข่าว\s*(?:bbc|บีบีซี)\b)/giu, ",")
    .trim();
  if (body.startsWith("ที่ ")) body = body.slice(3).trim();
  const parts = body.split(/\s*[,，、]\s*|\s+และ\s+/u)
    .map((x) => x.trim().replace(/[.。]+$/u, "").trim())
    .filter(Boolean);
  if (parts.length < 2 || parts.length > 12) return undefined;
  const names: string[] = [];
  const durations: (number | undefined)[] = [];
  for (const part of parts) {
    const match = part.match(/(?:นาน|ใช้เวลา|ระยะเวลา)?\s*(\d{1,3})\s*(นาที|ชั่วโมง)\s*$/u);
    const duration = match ? Number(match[1]) * (match[2] === "ชั่วโมง" ? 60 : 1) : undefined;
    if (duration !== undefined && (duration < 5 || duration > 240)) return undefined;
    const name = (match ? part.slice(0, match.index) : part)
      .replace(/^(?:อยาก|ขอ|ช่วย)\s*/u, "")
      .replace(/^(?:กิจกรรม|งาน)\s*/u, "")
      .replace(/\s+/gu, " ").trim();
    if (!name || name.length > 120 || !/[\p{L}]/u.test(name)) return undefined;
    names.push(name);
    durations.push(duration);
  }
  if (new Set(names.map((x) => normalizeActivityName(x))).size !== names.length)
    return undefined;
  return { date, names, durations };
}

/** Same activity with light title differences is safe to learn from. Never
 * group all study/work items together: TOEIC, BBC and interviews stay apart.
 */
export function historicalActivityKey(name: string): string {
  const norm = normalizeActivityName(name);
  if (/ทำความสะอาด|เก็บห้อง|จัดห้อง/u.test(norm)) return "cleaning";
  if (/ออกกำลังกาย|ออกกำลัง|workout|full body/iu.test(norm)) return "exercise";
  if (/หางาน|สมัครงาน|job search/iu.test(norm)) return "job-search";
  if (/สัมภาษณ์|interview/iu.test(norm)) return "interview";
  if (/bbc|บีบีซี/iu.test(norm)) return "bbc";
  if (/toeic|โทอิค/iu.test(norm)) return "toeic";
  if (/youtube|streamer|ฝึกฟังอังกฤษ/iu.test(norm)) return "listening";
  return activityKeyFor(name);
}

/** Build an atomic booking plan from old saved work. A completed session
 * provides stronger evidence than a merely scheduled one; do not label the
 * latter "successful" or invent measured durations.
 * Returns no commands if all requested tasks cannot fit; no partial save.
 */
export function planHistoricalBatch(
  state: State,
  request: HistoricalBatch,
  now = Date.now(),
): HistoricalBatchPlan {
  const { date, names, durations } = request;
  const gap = Math.max(15, state.settings.breakMinutes);
  const startWindow = dayAdd(today(now), -90);
  const allPast = state.sessions.filter((s) =>
    s.date >= startWindow && s.date < date && s.date <= today(now) &&
    (s.status === "done" || s.status === "planned"));
  const records = names.map((name, i) => {
    const key = historicalActivityKey(name);
    const history = allPast.filter((s) => historicalActivityKey(s.name) === key);
    const done = history.filter((s) => s.status === "done");
    const pool = done.length ? done : history;
    const recent = pool.filter((s) => s.date >= dayAdd(today(now), -4));
    const samples = recent.length ? recent : pool;
    const preferred = samples.length ? Math.round(median(samples.map((s) => s.start)) / 15) * 15 : undefined;
    const measured = samples.map(actualWorkedMinutes).filter((n): n is number =>
      n !== null && n >= 5 && n <= 240);
    const typical = samples.length ? median(measured.length >= 2 ? measured :
      samples.map((s) => s.duration)) : 30;
    const suggested = durations[i] ?? Math.max(15, Math.min(45, Math.round(typical / 5) * 5));
    return {
      name, key, duration: durations[i], preferred,
      suggested,
      kind: (done.length ? "completed" : history.length ? "planned" : "none") as
        "completed" | "planned" | "none",
      matches: pool.length,
    };
  });
  const already = new Set(state.sessions.filter((s) =>
    s.date === date && (s.status === "done" || s.status === "planned"))
    .map((s) => historicalActivityKey(s.name)));
  const remaining = records.filter((r) => !already.has(r.key));
  if (!remaining.length)
    return { commands: [], booked: [], evidence: [], notice: "กิจกรรมเหล่านี้อยู่ในตารางของวันนั้นแล้วค่ะ ไม่เพิ่มซ้ำ" };

  // The user explicitly controls duration. Try smaller versions ONLY for
  // omitted durations; never shorten numbers the user stated.
  let lastProblem = "";
  for (const cap of [45, 30, 20, 15]) {
    const proposed = remaining.map((r, i) => ({
      ...r,
      allocated: r.duration ?? Math.min(r.suggested, cap),
      preferredClock: r.preferred ?? state.settings.wake + i * (Math.min(r.suggested, cap) + gap),
    }));
    // Allocate high-confidence historical clocks first; flexible items then
    // occupy the nearest valid 15-minute slot without moving older work.
    const placement = [...proposed].sort((a, b) =>
      (a.kind === "completed" ? 0 : a.kind === "planned" ? 1 : 2) -
      (b.kind === "completed" ? 0 : b.kind === "planned" ? 1 : 2) ||
      a.preferredClock - b.preferredClock);
    let draft = structuredClone(state);
    const placed: Array<{ name: string; start: number; duration: number }> = [];
    let error = "";
    for (const item of placement) {
      const desired = item.preferredClock;
      const slots = Array.from({ length: Math.ceil((state.settings.sleep - state.settings.wake) / 15) }, (_, i) =>
        state.settings.wake + i * 15).filter((start) =>
          start + item.allocated <= state.settings.sleep &&
          timestamp(date, start) >= now);
      slots.sort((a, b) => Math.abs(a - desired) - Math.abs(b - desired) || a - b);
      let picked: { start: number; duration: number } | undefined;
      for (const start of slots) {
        // Reuse authoritative business constraints before every insertion.
        const dummy: Session = {
          id: "preview:new:" + item.name, goalId: "daily:preview:" + item.name,
          name: item.name, date, start, duration: item.allocated,
          status: "planned", fixed: false, reminder: 10,
        };
        if (!fits(draft, dummy, now)) continue;
        try {
          const result = executeCommands(draft, [{
            type: "add", name: item.name, date, start,
            duration: item.allocated, fixed: false,
          }], date, now);
          draft.sessions = result.sessions;
          picked = { start, duration: item.allocated };
          break;
        } catch {
          // The same constraints are checked by executeCommands; try later.
        }
      }
      if (!picked) {
        error = "ช่วงว่างหรือเพดานกิจกรรมไม่พอสำหรับ " + item.name +
          " (" + item.allocated + " นาที)";
        break;
      }
      placed.push({ name: item.name, ...picked });
    }
    if (placed.length !== placement.length) {
      lastProblem = error;
      continue;
    }
    const commands: Command[] = placed
      .sort((a, b) => a.start - b.start)
      .map((s) => ({
        type: "add", name: s.name, date, start: s.start,
        duration: s.duration, fixed: false,
      }));
    const booked = draft.sessions.filter((s) =>
      !state.sessions.some((old) => old.id === s.id));
    const evidence = proposed.map((r) => ({
      name: r.name, kind: r.kind, matches: r.matches,
      ...(r.preferred === undefined ? {} : { preferredStart: r.preferred }),
      suggestedMinutes: r.allocated,
    }));
    return { commands, booked, evidence, notice:
      (records.length - remaining.length > 0
        ? "งานที่อยู่ในตารางแล้ว " + (records.length - remaining.length) + " รายการ ไม่เพิ่มซ้ำ · " : "") +
      "เลือกเวลาใกล้ประวัติที่เคยทำสำเร็จหรือเคยวางแผน แต่ยังไม่ถือเป็นกิจวัตรจนมีหลักฐานเพียงพอ" };
  }
  return { commands: [], booked: [], evidence: [],
    notice: "ยังจัดทั้ง " + remaining.length + " กิจกรรมไม่ครบภายในเวลาที่ตื่นและเพดานรายวัน โดยไม่ย้ายงานเดิม" +
      (lastProblem ? " · " + lastProblem : "") + " กรุณาลดระยะเวลา เลือกงานบางส่วน หรือปรับเพดานผ่านการยืนยัน" };
}
