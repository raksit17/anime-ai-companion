import { activityKeyFor, fits, occupiedMinutes, timestamp, today, validDate, type Session, type State } from './engine';
import { recommendDay } from './recommendations';

export function isRecommendationRequest(message: string): boolean {
  const text = message.trim();
  return /แนะนำ|recommend|suggest|ทำอะไรต่อ|ทำอะไรดี/iu.test(text) &&
    !/เพิ่มงาน|บันทึก|เลื่อน|ลบ|ย้าย|เสร็จแล้ว|ทำเสร็จ|ยืนยัน/u.test(text);
}

const clock = (n: number) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;

export function recommendationWindow(message: string): { start: number; end: number } | null {
  const range = message.match(/(\d{1,2}):(\d{2})\s*(?:-|–|ถึง)\s*(\d{1,2}):(\d{2})/u);
  if (range) {
    const [h,m,h2,m2] = range.slice(1).map(Number);
    if (h > 23 || h2 > 23 || m > 59 || m2 > 59 || h2*60+m2 <= h*60+m) throw new Error('invalid time');
    return {start:h*60+m,end:h2*60+m2};
  }
  const thai = message.match(/(บ่าย|เย็น|เช้า)\s*(\d{1,2})(?::(\d{2})|\s*โมง)?/u);
  const numeric = message.match(/(?:เวลา|ช่วง|ตอน|เริ่ม|หลัง)\s*(\d{1,2}):(\d{2})/u);
  if (!thai && !numeric) return null;
  let h = Number(thai?.[2] ?? numeric![1]);
  const m = Number(thai?.[3] ?? (thai ? 0 : numeric![2]));
  if (thai && ['บ่าย','เย็น'].includes(thai[1]) && h >= 1 && h <= 11) h += 12;
  if (h > 23 || m > 59 || (thai?.[1] === 'เช้า' && h > 11)) throw new Error('invalid time');
  const start = h*60+m;
  return {start, end: Math.min(1440,start+60)};
}

/** Read-only advice from authoritative calendar data, never from chat prose. */
export function recommendNext(state: State, selectedDate: string, message: string, now = Date.now()) {
  const explicitDate = message.match(/\b\d{4}-\d{2}-\d{2}\b/u)?.[0];
  const date = explicitDate ?? (/พรุ่งนี้/u.test(message)
    ? new Date(Date.parse(today(now)) + 86400000).toISOString().slice(0, 10)
    : /วันนี้|ตอนนี้|ต่อไป|ทำอะไรต่อ/u.test(message) ? today(now) : selectedDate);
  const empty = (reply: string) => ({ reply, followUps: [] as {label: string; prompt: string}[] });
  let window: ReturnType<typeof recommendationWindow>;
  try { window = recommendationWindow(message); }
  catch { return empty('เวลาที่ระบุไม่ถูกต้องค่ะ กรุณาระบุ เช่น ช่วงบ่าย 3 หรือช่วง 15:00–16:00'); }
  if (!validDate(date) || timestamp(date, 0) > now + 366 * 86400000)
    return empty('เลือกวันที่ที่ถูกต้องภายในหนึ่งปีข้างหน้าเพื่อแนะนำกิจกรรมค่ะ');
  if (date < today(now)) return empty(`วันที่ ${date} ผ่านไปแล้วค่ะ เลือกวันนี้หรือวันข้างหน้าเพื่อแนะนำกิจกรรมที่ยังทำได้`);
  const searchNow = Math.max(now, window ? timestamp(date, window.start) : now);
  const inWindow = (s: Session) => !window || (s.start >= window.start && s.start + s.duration <= window.end);
  const windowLabel = window ? ` ช่วง ${clock(window.start)}–${clock(window.end)}` : '';
  const day = state.sessions.filter(s => s.date === date);
  const completed = new Set(day.filter(s => s.status === 'done').map(s => s.activityKey ?? activityKeyFor(s.name)));
  const active = day.filter(s => inWindow(s) && s.status === 'planned' &&
    timestamp(date, s.start) <= now && timestamp(date, s.start + s.duration) > now)
    .sort((a,b) => a.start - b.start)[0];
  if (active) return empty(`ตอนนี้ในตารางมี ${active.name} ถึง ${clock(active.start + active.duration)} ค่ะ ถ้ายังทำอยู่แนะนำให้ทำช่วงนี้ก่อน ยังไม่ได้เปลี่ยนตารางค่ะ`);
  const pending = day.filter(s => inWindow(s) && s.status === 'planned' && timestamp(date, s.start) >= searchNow &&
    !completed.has(s.activityKey ?? activityKeyFor(s.name)))
    .sort((a,b) => a.start - b.start);
  if (pending.length) {
    const next = pending[0];
    return empty(`แนะนำกิจกรรมถัดไปตามตารางวันที่ ${date}: ${next.name} เวลา ${clock(next.start)}–${clock(next.start + next.duration)} (${next.duration} นาที) ค่ะ${pending.length > 1 ? ` หลังจากนั้นมี ${pending[1].name} เวลา ${clock(pending[1].start)}` : ''} ยังไม่ได้เปลี่ยนตารางค่ะ`);
  }
  const work = structuredClone(state);
  work.settings.breakMinutes = Math.max(15, work.settings.breakMinutes);
  const used = day.filter(s => !s.fixed && ['planned','done'].includes(s.status)).reduce((n,s) => n + occupiedMinutes(s), 0);
  const remaining = (state.capacityOverrides?.[date] ?? state.settings.maxMinutes) - used;
  const low = /เหนื่อย|พลังงานต่ำ|พัก|เบา/u.test(message);
  const weekday = new Date(date + 'T12:00:00Z').getUTCDay();
  const choices: {session: Session; reason: string}[] = [];
  for (const goal of [...state.goals].sort((a,b) => b.priority - a.priority)) {
    if (!goal.days.includes(weekday) || state.suppressedOccurrences?.[goal.id]?.includes(date) ||
      day.some(s => s.goalId === goal.id || (s.activityKey ?? activityKeyFor(s.name)) === activityKeyFor(goal.name)) ||
      (goal.restDays > 0 && state.sessions.some(s => s.goalId === goal.id && ['done','planned'].includes(s.status) &&
        Math.abs(Date.parse(s.date) - Date.parse(date)) / 86400000 <= goal.restDays))) continue;
    const duration = Math.min(goal.duration, low ? 20 : 60);
    if (duration > remaining) continue;
    const base: Session = {id: 'recommendation:' + goal.id, goalId: goal.id, name: goal.name, date,
      start: goal.preferred, duration, fixed: !goal.flexible, status: 'planned', reminder: goal.reminder};
    const starts = goal.flexible ? Array.from({length:96}, (_,i) => i*15)
      .sort((a,b) => Math.abs(a-goal.preferred)-Math.abs(b-goal.preferred) || a-b) : [goal.preferred];
    const start = starts.find(start => inWindow({...base,start}) && fits(work, {...base, start}, searchNow));
    if (start === undefined) continue;
    choices.push({session: {...base,start}, reason: 'เป็นเป้าหมายที่คุณตั้งไว้และยังไม่ได้ทำในวันนี้'});
    if (choices.length === 3) break;
  }
  if (!choices.length) {
    const preview = recommendDay(state, date, low ? 'low' : 'normal', now, 4, 3);
    for (const suggestion of preview.suggestions) {
      const session = preview.sessions.find(s => s.id === suggestion.sessionId)!;
      const starts = session.fixed ? [session.start] : Array.from({length:96},(_,i)=>i*15)
        .sort((a,b)=>Math.abs(a-session.start)-Math.abs(b-session.start)||a-b);
      const start = starts.find(start => inWindow({...session,start}) && fits(work,{...session,start},searchNow));
      if (start !== undefined && session.duration <= remaining) choices.push({session:{...session,start}, reason:
        suggestion.reason + (start !== session.start ? ` (เลือกเวลา ${clock(start)} ตามช่วงที่ขอ)` : '')});
    }
  }
  if (!choices.length) return empty(`วันที่ ${date}${windowLabel} ไม่พบงานถัดไปที่ยังทำได้ตามตารางและข้อจำกัดค่ะ ${remaining <= 0 ? 'ใช้โควตากิจกรรมวันนี้ครบแล้ว แนะนำพักก่อน' : 'งานเดิมอาจเสร็จแล้วหรือพ้นเวลา และยังไม่มีเป้าหมายหรือประวัติที่ลงในเวลาว่างได้ ลองบอกกิจกรรมที่สนใจและระยะเวลาที่อยากทำ'} ยังไม่ได้เพิ่มหรือเปลี่ยนงานค่ะ`);
  return {reply: `มีตัวเลือกสำหรับวันที่ ${date} ค่ะ ` + choices.map(({session:s,reason}) =>
    `${s.name} ${clock(s.start)}–${clock(s.start+s.duration)} (${s.duration} นาที) เพราะ${reason}`).join(' หรือ ') + ' ตัวเลือกเหล่านี้เป็นทางเลือกแยกกัน ยังไม่ได้บันทึก เลือกกิจกรรมที่ต้องการก่อนค่ะ',
    followUps: choices.map(({session:s}) => ({label: `${s.name} ${clock(s.start)}`, prompt:
      `เพิ่มงาน ${s.name} วันที่ ${date} เวลา ${clock(s.start)} นาน ${s.duration} นาที`}))};
}
