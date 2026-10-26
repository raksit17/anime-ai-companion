<script setup lang="ts">
import {
  computed,
  ref,
  watch,
  nextTick,
  onMounted,
  onBeforeUnmount,
} from "vue";
import { api } from "../api";
import { generateRequestId } from "../services/request-id";
import { useChat } from "../stores/chat";
import PlannerAdvanced from "./PlannerAdvanced.vue";
import DailyTimeAnalytics from "./DailyTimeAnalytics.vue";
type Session = {
  id: string;
  name: string;
  date: string;
  start: number;
  duration: number;
  status: string;
  fixed: boolean;
  completedAt?: string;
  actualStartedAt?: string;
};
type PlannerFollowUp = {
  label: string;
  prompt?: string;
  openSettings?: boolean;
};
type AppliedChange = {
  previousDuration?: number;
  id: string;
  date: string;
  name: string;
  start: number;
  duration: number;
  status: string;
  kind: "created" | "updated";
};
type Message = {
  id: string;
  role: string;
  content: string;
  createdAt: string;
  outcome?: string;
  followUps?: PlannerFollowUp[];
  appliedChanges?: AppliedChange[];
};
type Proposal = {
  id: string;
  sessions: Session[];
  unscheduled: string[];
  source?: "habits";
  mode?: "recent-trial" | "habit";
  analysisFrom?: string;
  analysisTo?: string;
  suggestions?: Array<{
    sessionId: string; name: string; reason: string;
    evidenceCount: number; confidence: "low" | "medium" | "high";
    plannedStart: number;
  }>;
  capacityOverride?: {
    date: string;
    previousLimit: number;
    maxMinutes: number;
  };
};
const companion = useChat();
const today = () =>
  new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
const date = ref(today()),
  month = ref(today().slice(0, 7)),
  messages = ref<Message[]>([]),
  sessions = ref<Session[]>([]),
  capacityOverrides = ref<Record<string, number>>({}),
  highlightedSession = ref(""),
  deletingSession = ref<Session | null>(null),
  dragSourceId = ref(""),
  dropTargetId = ref(""),
  reorderMessage = ref(""),
  scheduleRevision = ref(0),
  editingSessionId = ref(""),
  editStart = ref(""),
  editDuration = ref(30),
  editError = ref("");
type HabitSuggestion = {
  activityKey: string; name: string; suggestedMinutes: number;
  preferredStart: number; evidenceCount: number; reason: string;
};
const habitSuggestions = ref<HabitSuggestion[]>([]),
  habitDays = ref<4 | 90>(4), historyFrom = ref(""), historyTo = ref(""),
  habitTip = ref(""), habitLoading = ref(false), showHabitSuggestions = ref(false);
const input = ref(""),
  error = ref(""),
  busy = ref(false),
  loading = ref(false),
  autoApply = ref(true),
  advanced = ref(false),
  proposal = ref<Proposal>();
const reminders = ref<Session[]>([]),
  log = ref<HTMLElement>(),
  now = ref(Date.now());
const settings = ref({
  wake: 480,
  sleep: 1320,
  breakMinutes: 15,
  maxMinutes: 240,
});
const selectedDailyLimit = computed(
  () => capacityOverrides.value[date.value] ?? settings.value.maxMinutes,
);
const clock = (n: number) =>
  `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
const shift = (d: string, n: number) =>
  new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);
const longDate = (d: string) =>
  new Date(d + "T00:00:00+07:00").toLocaleDateString("th-TH", {
    timeZone: "Asia/Bangkok",
    weekday: "long",
    day: "numeric",
    month: "long",
  });

function actualFinishedClock(session: Session) {
  if (!session.completedAt) return "";
  const completed = new Date(session.completedAt);
  return Number.isNaN(completed.getTime()) ? "" :
    completed.toLocaleTimeString("th-TH", {
      timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit",
      hour12: false,
    });
}
function earlyReleasedMinutes(session: Session) {
  if (session.status !== "done" || !session.completedAt) return 0;
  const actual = Date.parse(session.completedAt);
  if (!Number.isFinite(actual)) return 0;
  const startOfDay = Date.parse(`${session.date}T00:00:00+07:00`);
  const completedMinutes = Math.ceil((actual - startOfDay) / 60000);
  const plannedEnd = session.start + session.duration;
  return Math.max(0, plannedEnd -
    Math.max(session.start, Math.min(plannedEnd, completedMinutes)));
}

const daySessions = computed(() =>
  sessions.value
    .filter((s) => s.date === date.value)
    .sort((a, b) => a.start - b.start),
);
const active = computed(() =>
  daySessions.value.filter(
    (s) => s.status === "planned" || s.status === "done",
  ),
);
const done = computed(
  () => daySessions.value.filter((s) => s.status === "done").length,
);
const totalMinutes = computed(() =>
  active.value.reduce((n, s) => n + s.duration, 0),
);
const next = computed(
  () =>
    sessions.value
      .filter(
        (s) =>
          s.status === "planned" &&
          Date.parse(`${s.date}T00:00:00+07:00`) +
            (s.start + s.duration) * 60000 >
            now.value,
      )
      .sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start)[0],
);
const calendar = computed(() => {
  const first = month.value + "-01";
  const offset = (new Date(first).getUTCDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, i) => {
    const d = shift(first, i - offset);
    return {
      date: d,
      day: Number(d.slice(-2)),
      other: !d.startsWith(month.value),
      count: sessions.value.filter(
        (s) => s.date === d && s.status === "planned",
      ).length,
    };
  });
});
const week = computed(() => {
  const weekday = (new Date(date.value).getUTCDay() + 6) % 7;
  return Array.from({ length: 7 }, (_, i) => shift(date.value, i - weekday));
});
const names = ["จ", "อ", "พ", "พฤ", "ศ", "ส", "อา"];
const label = (s: string) =>
  ({ planned: "รอทำ", done: "เสร็จแล้ว", skipped: "ข้าม", deferred: "พักไว้" })[
    s
  ] ?? s;
function select(d: string) {
  editingSessionId.value = "";
  editError.value = "";
  highlightedSession.value = "";
  dragSourceId.value = "";
  dropTargetId.value = "";
  reorderMessage.value = "";
  date.value = d;
  month.value = d.slice(0, 7);
}
function changeMonth(delta: number) {
  const d = new Date(month.value + "-01");
  d.setUTCMonth(d.getUTCMonth() + delta);
  month.value = d.toISOString().slice(0, 7);
}
async function refresh() {
  const state = await api("/planner");
  sessions.value = state.sessions;
  scheduleRevision.value = state.revision;
  settings.value = state.settings;
  capacityOverrides.value = state.capacityOverrides ?? {};
}
let historyVersion = 0;
watch(
  () => companion.character?.id,
  async (id) => {
    const version = ++historyVersion;
    messages.value = [];
    proposal.value = undefined;
    if (!id) return;
    loading.value = true;
    try {
      const result = await api<Message[]>(
        `/planner/chat?characterId=${encodeURIComponent(id)}`,
      );
      if (version === historyVersion) messages.value = result;
    } catch (e) {
      error.value = String(e);
    } finally {
      if (version === historyVersion) loading.value = false;
    }
  },
  { immediate: true },
);
watch(
  () => messages.value.length,
  async () => {
    await nextTick();
    log.value?.scrollTo({ top: log.value.scrollHeight, behavior: "smooth" });
  },
);
function friendlyChatError(reason: unknown) {
  let detail = reason instanceof Error ? reason.message : String(reason);
  // Older API builds sometimes return a nested JSON error as a string.
  const open = detail.indexOf("{");
  if (open !== -1) {
    try {
      const structured = JSON.parse(detail.slice(open));
      if (typeof structured?.message === "string") detail = structured.message;
      else if (typeof structured?.message?.message === "string")
        detail = structured.message.message;
    } catch { /* Keep the readable plain-text error. */ }
  }
  const message = detail.replace(/^Error:\s*/u, "").trim();
  return "ยูนะยังจัดตารางให้ไม่ได้ค่ะ — " +
    (/AbortError|timeout|timed out|fetch failed/iu.test(message)
      ? "การเชื่อมต่อใช้เวลานานกว่าปกติ กรุณาลองอีกครั้งนะคะ"
      : message && !message.startsWith("{")
        ? message : "มีบางอย่างผิดพลาดระหว่างตรวจตาราง") +
    " (ยังไม่ได้ยืนยันว่าตารางเปลี่ยนค่ะ)";
}

async function send(text = input.value) {
  if (busy.value || !text.trim() || !companion.character) return;
  busy.value = true;
  error.value = "";
  const characterId = companion.character.id,
    requestId = generateRequestId();
  const pending: Message = {
    id: requestId,
    role: "user",
    content: text,
    createdAt: new Date().toISOString(),
  };
  messages.value.push(pending);
  input.value = "";
  const before = new Map(sessions.value.map((s) => [s.id, s]));
  let replyReceived = false;
  try {
    const result = await api<{ message: Message; proposal?: Proposal }>(
      "/planner/chat",
      "POST",
      {
        characterId,
        requestId,
        date: date.value,
        message: text,
        autoApply: autoApply.value,
      },
      135000,
    );
    replyReceived = true;
    if (companion.character?.id === characterId) {
      messages.value.push(result.message);
      proposal.value = result.proposal;
    }
    await refresh();
    if (companion.character?.id !== characterId) return;
    if (result.message.outcome?.startsWith("บันทึกตารางแล้ว")) {
      // The server receipt takes precedence. Fall back to comparing snapshots
      // for older backends so a stale deployed API cannot quietly claim success.
      const reported = result.message.appliedChanges;
      const actualChanges = sessions.value
        .filter((next) => {
          const old = before.get(next.id);
          return !old ||
            old.date !== next.date ||
            old.start !== next.start ||
            old.duration !== next.duration ||
            old.name !== next.name ||
            old.status !== next.status;
        })
        .map((x): AppliedChange => ({
          ...x,
          kind: before.has(x.id) ? "updated" : "created",
        }));
      const changed = reported ?? actualChanges;
      const confirmed = changed.filter((c) =>
        sessions.value.some((x) =>
          x.id === c.id &&
          x.date === c.date &&
          x.start === c.start &&
          x.duration === c.duration &&
          x.name === c.name &&
          x.status === c.status,
        ),
      );
      if (!changed.length || confirmed.length !== changed.length) {
        error.value =
          "แชตแจ้งว่าบันทึกแล้ว แต่ยังยืนยันรายการที่เปลี่ยนจากตารางไม่ได้ กรุณาตรวจสอบวันที่ในปฏิทินและอัปเดต API/Web ให้เป็นเวอร์ชันล่าสุด ก่อนส่งคำสั่งซ้ำ";
        result.message.outcome = "ยังยืนยันการแสดงผลในตารางไม่ได้";
      } else {
        // Select the actual saved date rather than the selected chat date:
        // "พรุ่งนี้" can point to a different calendar day.
        const focus = confirmed.find((c) => c.kind === "created") ?? confirmed[0];
        select(focus.date);
        highlightedSession.value = focus.id;
        if (!reported) result.message.appliedChanges = confirmed;
        await nextTick();
        document.getElementById(`planner-session-${focus.id}`)
          ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }
  } catch (e) {
    error.value = replyReceived
      ? `เซิร์ฟเวอร์ตอบกลับแล้ว แต่โหลด/ตรวจสอบตารางไม่สำเร็จ: ${String(e)} โปรดรีเฟรชก่อนส่งซ้ำ`
      : friendlyChatError(e);
    if (!replyReceived) {
      input.value = text;
      messages.value = messages.value.filter((m) => m.id !== requestId);
    }
  } finally {
    busy.value = false;
  }
}
function chooseFollowUp(option: PlannerFollowUp) {
  if (busy.value) return;
  if (option.openSettings) {
    advanced.value = true;
  } else if (option.prompt) {
    void send(option.prompt);
  }
}
function canReorder(session: Session) {
  return session.date === date.value &&
    session.status === "planned" && !session.fixed &&
    Date.parse(`${session.date}T00:00:00+07:00`) +
      session.start * 60000 > now.value;
}
// A missed task can remain planned after its scheduled start; allow
// moving it forward via the inline editor without changing its history.
function canEditTime(session: Session) {
  return session.date === date.value &&
    session.status === "planned" && !session.fixed;
}
function openTimeEditor(session: Session) {
  if (busy.value || !canEditTime(session)) return;
  if (editingSessionId.value === session.id) {
    editingSessionId.value = "";
    editError.value = "";
    return;
  }
  editingSessionId.value = session.id;
  editStart.value = clock(session.start);
  editDuration.value = session.duration;
  editError.value = "";
  reorderMessage.value = "";
}
function cancelTimeEditor() {
  editingSessionId.value = "";
  editError.value = "";
}
function parsedEditStart(): number | undefined {
  if (!/^\d{2}:\d{2}$/.test(editStart.value)) return undefined;
  const [hour, minute] = editStart.value.split(":").map(Number);
  return hour < 24 && minute < 60 ? hour * 60 + minute : undefined;
}
const editedEnd = computed(() => {
  const start = parsedEditStart();
  if (start === undefined || !Number.isInteger(editDuration.value) ||
      editDuration.value < 5 || editDuration.value > 240 ||
      start + editDuration.value > 1440) return "";
  return clock(start + editDuration.value);
});
async function saveTimeEdit(session: Session) {
  if (busy.value || editingSessionId.value !== session.id ||
      !canEditTime(session)) return;
  const start = parsedEditStart();
  const duration = editDuration.value;
  if (start === undefined || !Number.isInteger(duration) ||
      duration < 5 || duration > 240 || !editedEnd.value) {
    editError.value = "กรุณาเลือกเวลาเริ่มและระยะเวลา 5–240 นาทีให้ถูกต้อง";
    return;
  }
  if (start === session.start && duration === session.duration) {
    editError.value = "เวลาและระยะเวลายังเหมือนเดิม";
    return;
  }
  busy.value = true;
  editError.value = "";
  error.value = "";
  reorderMessage.value = "";
  try {
    const result = await api<{ session: Session }>(
      `/planner/sessions/${encodeURIComponent(session.id)}/schedule`,
      "PATCH",
      {
        date: session.date, start, duration,
        expectedRevision: scheduleRevision.value,
      },
    );
    proposal.value = undefined;
    await refresh();
    cancelTimeEditor();
    highlightedSession.value = session.id;
    reorderMessage.value =
      `แก้เวลา ${result.session.name} เป็น ${clock(result.session.start)}–${clock(result.session.start + result.session.duration)} (${result.session.duration} นาที) แล้ว`;
  } catch (e) {
    editError.value = String(e);
    try { await refresh(); } catch { /* Show the actual error. */ }
  } finally {
    busy.value = false;
  }
}

function eligibleNeighbor(session: Session, direction: -1 | 1) {
  const items = daySessions.value.filter(canReorder);
  const index = items.findIndex((item) => item.id === session.id);
  return index < 0 ? undefined : items[index + direction];
}
function dragStart(event: DragEvent, session: Session) {
  if (busy.value || !canReorder(session)) {
    event.preventDefault();
    return;
  }
  dragSourceId.value = session.id;
  dropTargetId.value = "";
  reorderMessage.value = "";
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", session.id);
  }
}
function dragOver(event: DragEvent, target: Session) {
  if (busy.value || !dragSourceId.value ||
      dragSourceId.value === target.id || !canReorder(target)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  dropTargetId.value = target.id;
}
function dragEnd() {
  dragSourceId.value = "";
  dropTargetId.value = "";
}
async function swapSessions(sourceId: string, targetId: string) {
  if (busy.value || sourceId === targetId) return;
  const source = daySessions.value.find((item) => item.id === sourceId);
  const target = daySessions.value.find((item) => item.id === targetId);
  if (!source || !target || !canReorder(source) || !canReorder(target)) return;
  busy.value = true;
  error.value = "";
  reorderMessage.value = "";
  try {
    const response = await api<{ changed: Session[] }>(
      "/planner/sessions/reorder", "POST",
      {
        date: date.value, sourceId, targetId,
        expectedRevision: scheduleRevision.value,
      },
    );
    proposal.value = undefined;
    await refresh();
    highlightedSession.value = sourceId;
    reorderMessage.value =
      `สลับลำดับ ${source.name} กับ ${target.name} แล้ว · ปรับเวลา ${response.changed.length} กิจกรรมตามเวลาพัก`;
  } catch (e) {
    error.value = String(e);
    try { await refresh(); } catch { /* Keep the actual error visible. */ }
  } finally {
    busy.value = false;
    dragEnd();
  }
}
function dropOn(event: DragEvent, target: Session) {
  event.preventDefault();
  const sourceId = dragSourceId.value;
  dragEnd();
  if (sourceId && sourceId !== target.id && canReorder(target))
    void swapSessions(sourceId, target.id);
}
function swapWithNeighbor(session: Session, direction: -1 | 1) {
  const neighbor = eligibleNeighbor(session, direction);
  if (neighbor) void swapSessions(session.id, neighbor.id);
}

async function removeSession(session: Session) {
  if (busy.value || deletingSession.value?.id !== session.id) return;
  busy.value = true;
  error.value = "";
  try {
    await api(`/planner/sessions/${encodeURIComponent(session.id)}`, "DELETE");
    // Don't accidentally confirm any proposal generated from an old schedule.
    proposal.value = undefined;
    highlightedSession.value = "";
    deletingSession.value = null;
    await refresh();
  } catch (e) {
    error.value = String(e);
  } finally {
    busy.value = false;
  }
}
async function loadHistoryRecommendations(days: 4 | 90) {
  if (habitLoading.value) return;
  habitLoading.value = true;
  habitDays.value = days;
  habitTip.value = "";
  habitSuggestions.value = [];
  try {
    const result = await api<{
      recommendations: HabitSuggestion[];
      activityCount: number;
      from: string;
      to: string;
    }>("/planner/habits?days=" + days);
    habitSuggestions.value = result.recommendations;
    historyFrom.value = result.from;
    historyTo.value = result.to;
    if (!result.recommendations.length)
      habitTip.value = result.activityCount
        ? days === 4
          ? "ใน 4 วันก่อนหน้ายังไม่มีงานยืดหยุ่นที่ทำสำเร็จให้ทดลองจัดใหม่"
          : "ยังมีข้อมูลทำสำเร็จซ้ำหลายสัปดาห์ไม่พอสำหรับสรุปนิสัยประจำ"
        : "ยังไม่มีประวัติกิจกรรมจริงในช่วงวันที่เลือกค่ะ";
  } catch (e) {
    habitTip.value = String(e);
  } finally {
    habitLoading.value = false;
  }
}
async function showHistoryRecommendations() {
  if (habitLoading.value) return;
  showHabitSuggestions.value = !showHabitSuggestions.value;
  if (showHabitSuggestions.value)
    await loadHistoryRecommendations(habitDays.value);
}
async function previewRecentPlan(target: string) {
  if (busy.value || habitLoading.value) return;
  busy.value = true;
  error.value = "";
  try {
    proposal.value = await api<Proposal>("/planner/recommendations/preview", "POST", {
      date: target, energy: "normal", days: habitDays.value,
    });
    date.value = target;
    month.value = target.slice(0, 7);
  } catch (e) {
    error.value = String(e);
  } finally {
    busy.value = false;
  }
}
function prepareHabitSuggestion(suggestion: HabitSuggestion) {
  // Never auto-save a historical recommendation; user must send and
  // confirm the resulting proposal. The task is not created yet.
  input.value = "พรุ่งนี้ เพิ่มงาน " + suggestion.name + " เวลา " +
    clock(suggestion.preferredStart) + " นาน " +
    suggestion.suggestedMinutes + " นาที";
  autoApply.value = false;
  showHabitSuggestions.value = false;
}
async function startActualSession(s: Session) {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    await api("/planner/sessions/" + encodeURIComponent(s.id) + "/start", "POST");
    await refresh();
    reorderMessage.value = "บันทึกเวลาเริ่มทำจริงของ " + s.name + " แล้ว";
  } catch (e) {
    error.value = String(e);
  } finally {
    busy.value = false;
  }
}

async function mark(s: Session, status: string) {
  if (busy.value) return;
  error.value = "";
  busy.value = true;
  try {
    await api(`/planner/sessions/${s.id}`, "PATCH", { status });
    proposal.value = undefined;
    await refresh();
  } catch (e) {
    error.value = String(e);
  } finally {
    busy.value = false;
  }
}
async function confirm() {
  if (!proposal.value || busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    await api(`/planner/proposals/${proposal.value.id}/confirm`, "POST");
    proposal.value = undefined;
    await refresh();
  } catch (e) {
    error.value = String(e);
  } finally {
    busy.value = false;
  }
}
let timer: ReturnType<typeof setInterval> | undefined;
let polling = false;
const notified = new Set<string>();
async function poll() {
  if (polling) return;
  polling = true;
  now.value = Date.now();
  try {
    reminders.value = await api("/planner/reminders");
    if ("Notification" in window && Notification.permission === "granted")
      for (const s of reminders.value) {
        if (!notified.has(s.id)) {
          new Notification("ถึงเวลากิจกรรม", {
            body: `${clock(s.start)} ${s.name}`,
          });
          notified.add(s.id);
        }
      }
    if (!busy.value) await refresh();
  } catch {
    /* Action errors remain visible. Retry when the API returns. */
  } finally {
    polling = false;
  }
}
async function notify() {
  if ("Notification" in window) await Notification.requestPermission();
  else error.value = "อุปกรณ์นี้ไม่รองรับการแจ้งเตือนเบราว์เซอร์";
}
onMounted(() => {
  void refresh().catch((e) => (error.value = String(e)));
  timer = setInterval(() => void poll(), 30000);
});
onBeforeUnmount(() => clearInterval(timer));
watch(advanced, (value) => {
  if (!value) void refresh().catch((e) => (error.value = String(e)));
});
</script>
<template>
  <div class="daily-home">
    <header class="planner-header">
      <div>
        <small>YOUR DAY, TOGETHER</small>
        <h2>วันนี้กับ{{ companion.character?.name || "ยูนะ" }}</h2>
        <p>บอกสิ่งที่อยากทำ แล้วมาจัดวันของคุณด้วยกัน</p>
      </div>
      <div class="planner-header-actions">
        <button class="quiet" @click="showHistoryRecommendations"
          :disabled="habitLoading">
          {{ showHabitSuggestions ? "ซ่อนคำแนะนำ" : "ทดลองแผนจากประวัติ" }}
        </button>
        <button class="quiet" @click="advanced = !advanced">
          {{ advanced ? "กลับตารางวันนี้" : "ตั้งค่าเพิ่มเติม" }}
        </button>
      </div>
    </header>
    <section v-if="showHabitSuggestions" class="habit-suggestions" aria-label="แนะนำจากประวัติจริง">
      <strong>ไอเดียจากกิจกรรมที่ผ่านมา ({{ habitDays }} วัน{{ habitDays === 4 ? " · ทดลอง" : "" }})</strong>
      <div class="habit-quick-actions">
        <button type="button" :disabled="habitLoading || busy"
          @click="loadHistoryRecommendations(4)">ลอง 4 วันก่อนหน้า</button>
        <button type="button" :disabled="habitLoading || busy"
          @click="loadHistoryRecommendations(90)">วิเคราะห์ 90 วัน</button>
      </div>
      <p v-if="historyFrom && historyTo" class="muted">
        ข้อมูลวันที่ {{ historyFrom }} ถึง {{ historyTo }}
        <template v-if="habitDays === 4">
          · ใช้เป็นตัวอย่างจากงานที่ทำสำเร็จ ไม่ถือเป็นนิสัยประจำ
        </template>
      </p>
      <div class="habit-quick-actions">
        <button type="button" :disabled="busy || habitLoading" @click="previewRecentPlan(today())">
          เสนอแผนวันนี้
        </button>
        <button type="button" :disabled="busy || habitLoading" @click="previewRecentPlan(shift(today(), 1))">
          เสนอแผนพรุ่งนี้
        </button>
      </div>
      <p v-if="habitLoading">กำลังตรวจประวัติกิจกรรมจริง…</p>
      <p v-if="habitTip">{{ habitTip }}</p>
      <div v-for="suggestion in habitSuggestions" :key="suggestion.activityKey"
        class="habit-suggestion-item">
        <div>
          <strong>{{ suggestion.name }}</strong>
          <p>ช่วงที่เคยทำสำเร็จ {{ clock(suggestion.preferredStart) }}
            · {{ suggestion.evidenceCount }} ครั้ง · เสนอ {{ suggestion.suggestedMinutes }} นาที</p>
        </div>
        <button type="button" @click="prepareHabitSuggestion(suggestion)">
          ใส่ในช่องคุย (ยังไม่บันทึก)
        </button>
      </div>
      <div v-if="proposal?.source === 'habits'" class="habit-trial-preview">
        <strong>ตัวอย่างตารางวันที่ {{ date }} · ยังไม่บันทึก</strong>
        <p v-if="proposal.mode === 'recent-trial'" class="muted">
          ทดลองจากข้อมูลน้อย ไม่ใช่การยืนยันว่าช่วงเวลานี้เป็นนิสัยประจำ
        </p>
        <div v-for="item in proposal.suggestions" :key="item.sessionId" class="habit-suggestion-item">
          <div>
            <strong>{{ clock(item.plannedStart) }} · {{ item.name }}</strong>
            <p>{{ item.reason }}</p>
          </div>
        </div>
        <p v-for="note in proposal.unscheduled" :key="note">{{ note }}</p>
        <button type="button" :disabled="busy || !(proposal.suggestions?.length)"
          @click="confirm">ยืนยันเพิ่มเฉพาะรายการที่เสนอ</button>
        <button type="button" :disabled="busy" @click="proposal = undefined">ยกเลิก</button>
      </div>
      <p class="muted">คำแนะนำไม่เปลี่ยนตารางเอง และไม่ตีความประวัติแชตว่าเป็นกิจกรรมที่ทำจริง</p>
    </section>
    <p v-if="error" role="alert" class="error">
      {{ error }} <button @click="error = ''">ปิด</button>
    </p>
    <p v-if="reorderMessage" class="reorder-success" role="status">
      {{ reorderMessage }}
      <button type="button" @click="reorderMessage = ''" aria-label="ปิดข้อความ">×</button>
    </p>
    <div v-if="reminders.length" class="reminder" role="status">
      🔔 {{ reminders[0].name }} · {{ clock(reminders[0].start) }}
      <button
        @click="
          api(`/planner/reminders/${reminders[0].id}/ack`, 'POST')
            .then(poll)
            .catch((e) => (error = String(e)))
        "
      >
        รับทราบ
      </button>
    </div>
    <PlannerAdvanced v-if="advanced" />
    <div v-else class="planner-grid">
      <section class="agenda" aria-label="ปฏิทินและตารางวันนี้">
        <div class="date-heading">
          <div>
            <span class="eyebrow">{{
              date === today() ? "TODAY" : "YOUR SCHEDULE"
            }}</span>
            <h3>{{ longDate(date) }}</h3>
          </div>
          <button @click="select(today())">วันนี้</button>
        </div>
        <div class="week-strip">
          <button
            v-for="(d, i) in week"
            :key="d"
            :class="{ selected: d === date }"
            @click="select(d)"
          >
            <small>{{ names[i] }}</small
            ><strong>{{ Number(d.slice(-2)) }}</strong
            ><i
              v-if="
                sessions.some((s) => s.date === d && s.status === 'planned')
              "
              >•</i
            >
          </button>
        </div>
        <DailyTimeAnalytics :date="date" :revision="scheduleRevision" />
        <details class="month-picker">
          <summary>เปิดปฏิทินรายเดือน</summary>
          <div class="month-nav">
            <button aria-label="เดือนก่อน" @click="changeMonth(-1)">‹</button
            ><strong>{{
              new Date(month + "-01").toLocaleDateString("th-TH", {
                month: "long",
                year: "numeric",
                timeZone: "Asia/Bangkok",
              })
            }}</strong
            ><button aria-label="เดือนถัดไป" @click="changeMonth(1)">›</button>
          </div>
          <div class="month-grid">
            <span v-for="n in names" :key="n">{{ n }}</span
            ><button
              v-for="d in calendar"
              :key="d.date"
              :class="{ selected: d.date === date, other: d.other }"
              :aria-label="`${d.date} ${d.count} กิจกรรม`"
              @click="select(d.date)"
            >
              {{ d.day }}<small>{{ d.count ? `${d.count} งาน` : " " }}</small>
            </button>
          </div>
        </details>
        <div class="day-stats">
          <span
            ><strong>{{ done }}/{{ daySessions.length }}</strong> สำเร็จ</span
          ><span
            ><strong>{{ totalMinutes }}</strong> นาทีในแผน</span
          ><span
            >พัก
            <strong>{{ Math.max(15, settings.breakMinutes) }}</strong>
            นาที*</span
          >
        </div>
        <div
          v-if="next && date === today() && next.date === date"
          class="up-next"
        >
          <small>กิจกรรมถัดไป / กำลังทำ</small
          ><strong>{{ clock(next.start) }} · {{ next.name }}</strong>
        </div>
        <div v-if="!daySessions.length" class="empty-day">
          <span>☀</span>
          <h3>วันนี้ยังว่างอยู่</h3>
          <p>
            พิมพ์หา{{
              companion.character?.name || "ยูนะ"
            }}
            เช่น<br />“วันนี้ฝึกอังกฤษ 30 นาที และ Coding 1 ชั่วโมง”
          </p>
          <button
            @click="
              input =
                'วันนี้ฝึกอังกฤษ 30 นาที และ Coding 1 ชั่วโมง ช่วยจัดให้หน่อย'
            "
          >
            ใช้ตัวอย่างนี้
          </button>
        </div>
        <p v-if="daySessions.some(canReorder)" class="reorder-hint">
          <span aria-hidden="true">⠿</span> จับที่ไอคอนเพื่อลากสลับลำดับกิจกรรม หรือใช้ปุ่ม ↑ ↓
          ระบบจะปรับเวลาและเว้นพักให้โดยอัตโนมัติ
        </p>
        <ol class="timeline">
          <li
            v-for="(s, i) in daySessions"
            :id="`planner-session-${s.id}`"
            :key="s.id"
            :class="[s.status, {
              'just-applied': highlightedSession === s.id,
              'reorder-dragging': dragSourceId === s.id,
              'reorder-target': dropTargetId === s.id,
            }]"
            @dragover="dragOver($event, s)"
            @drop="dropOn($event, s)"
          >
            <div class="time">
              <strong>{{ clock(s.start) }}</strong
              ><small>{{ clock(s.start + s.duration) }}</small>
            </div>
            <div class="task">
              <div class="task-title">
                <div class="task-name"><strong>{{ s.name }}</strong></div>
                <div class="task-heading-tools">
                  <template v-if="canReorder(s)">
                    <button
                      class="reorder-handle"
                      type="button"
                      draggable="true"
                      :disabled="busy"
                      :aria-label="`ลากสลับลำดับกิจกรรม ${s.name}`"
                      title="จับลากไปวางบนอีกกิจกรรมเพื่อสลับลำดับ"
                      @dragstart="dragStart($event, s)"
                      @dragend="dragEnd"
                    >⠿</button>
                    <button
                      class="reorder-arrow"
                      type="button"
                      :disabled="busy || !eligibleNeighbor(s, -1)"
                      :aria-label="`สลับ ${s.name} กับกิจกรรมก่อนหน้า`"
                      @click="swapWithNeighbor(s, -1)"
                    >↑</button>
                    <button
                      class="reorder-arrow"
                      type="button"
                      :disabled="busy || !eligibleNeighbor(s, 1)"
                      :aria-label="`สลับ ${s.name} กับกิจกรรมถัดไป`"
                      @click="swapWithNeighbor(s, 1)"
                    >↓</button>
                  </template>
                  <template v-if="canEditTime(s)">
                    <button
                      class="edit-time-trigger"
                      type="button"
                      :disabled="busy"
                      :aria-expanded="editingSessionId === s.id"
                      :aria-controls="`planner-edit-time-${s.id}`"
                      :aria-label="`แก้เวลาเริ่มและระยะเวลา ${s.name}`"
                      @click="openTimeEditor(s)"
                    >{{ editingSessionId === s.id ? "ปิด" : "แก้เวลา" }}</button>
                  </template>
                  <span class="status">{{ label(s.status) }}</span>
                </div>
              </div>
              <p>
                {{ s.duration }} นาที <span v-if="s.fixed">· นัดคงที่</span>
              </p>
              <p v-if="s.status === 'done' && actualFinishedClock(s)" class="actual-completion">
                <span>เสร็จจริง {{ actualFinishedClock(s) }}</span>
                <span v-if="earlyReleasedMinutes(s) > 0">
                  · เร็วกว่ากำหนด {{ earlyReleasedMinutes(s) }} นาที
                </span>
                <span class="planned-time-hint">(เวลาเดิม {{ clock(s.start) }}–{{ clock(s.start + s.duration) }})</span>
              </p>
              <form
                v-if="editingSessionId === s.id"
                :id="`planner-edit-time-${s.id}`"
                class="inline-time-edit"
                @submit.prevent="saveTimeEdit(s)"
              >
                <div class="time-edit-fields">
                  <label>
                    <span>เวลาเริ่ม</span>
                    <input
                      v-model="editStart"
                      type="time"
                      step="300"
                      required
                      :disabled="busy"
                    />
                  </label>
                  <label>
                    <span>ระยะเวลา (นาที)</span>
                    <input
                      v-model.number="editDuration"
                      type="number"
                      min="5"
                      max="240"
                      step="5"
                      required
                      :disabled="busy"
                    />
                  </label>
                </div>
                <p class="edit-time-preview" aria-live="polite">
                  เวลาเสร็จใหม่:
                  <strong>{{ editedEnd || "กรุณาตรวจเวลาและระยะเวลา" }}</strong>
                  · พักระหว่างงานอย่างน้อย {{ Math.max(15, settings.breakMinutes) }} นาที
                </p>
                <p v-if="editError" class="time-edit-error" role="alert">{{ editError }}</p>
                <div class="edit-time-buttons">
                  <button type="submit" :disabled="busy || !editedEnd">บันทึกเวลา</button>
                  <button type="button" :disabled="busy" @click="cancelTimeEditor">ยกเลิก</button>
                </div>
              </form>
              <div v-if="s.status === 'planned'" class="task-actions">
                <button v-if="s.date === today() && !s.actualStartedAt"
                  :disabled="busy" type="button" @click="startActualSession(s)">
                  ▶ เริ่ม (บันทึกเวลาจริง)
                </button>
                <span v-else-if="s.actualStartedAt" class="actual-start-notice">
                  เริ่มจริง {{ new Date(s.actualStartedAt).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false }) }}
                </span>
                <button :disabled="busy" @click="mark(s, 'done')">
                  ✓ เสร็จแล้ว</button
                ><button
                  :disabled="busy"
                  @click="input = `เลื่อน ${s.name} ไปเวลา `"
                >
                  เลื่อน</button
                ><button :disabled="busy" @click="mark(s, 'skipped')">
                  ข้าม
                </button>
              </div>
              <div v-if="s.status !== 'done'" class="session-delete-tools">
                <button
                  v-if="deletingSession?.id !== s.id"
                  class="delete-slot-trigger"
                  type="button"
                  :disabled="busy"
                  :aria-label="`ลบกิจกรรม ${s.name} วันที่ ${s.date} ${clock(s.start)}`"
                  @click="deletingSession = s"
                >ลบสล็อต</button>
                <div v-else class="delete-slot-confirm" role="group" :aria-label="`ยืนยันลบ ${s.name}`">
                  <span>ลบเฉพาะ {{ s.name }} · {{ s.date }} {{ clock(s.start) }} ใช่ไหม?</span>
                  <button type="button" :disabled="busy" class="delete-slot-danger" @click="removeSession(s)">
                    ยืนยันลบ
                  </button>
                  <button type="button" :disabled="busy" @click="deletingSession = null">ยกเลิก</button>
                </div>
              </div>
              <small v-if="s.status === 'deferred'"
                >ยังไม่จองเวลา · บอกยูนะว่าต้องการย้ายไปวันไหน</small
              >
            </div>
          </li>
        </ol>
        <p class="calendar-note">
          เวลาไทย · {{ clock(settings.wake) }}–{{ clock(settings.sleep) }} ·
          กิจกรรมยืดหยุ่นไม่เกิน
          {{ selectedDailyLimit }} นาที{{ capacityOverrides[date] !== undefined ? ' (อนุมัติเฉพาะวันนี้)' : '/วัน' }}<br />*การปรับแบบ Adaptive
          เว้นพักอย่างน้อย 15 นาที
        </p>
      </section>
      <section class="planner-conversation" aria-label="แชตวางแผนกับตัวละคร">
        <div class="conversation-heading">
          <div class="avatar">✦</div>
          <div>
            <strong>{{ companion.character?.name || "ยูนะ" }}</strong
            ><small>คุยเรื่องวันนี้ · จำบทสนทนาต่อเนื่อง</small>
          </div>
          <button class="quiet" @click="notify" title="แจ้งเตือนเมื่อเปิดแอป">
            ♧ แจ้งเตือน
          </button>
        </div>
        <div class="conversation-log" ref="log" aria-live="polite">
          <p v-if="loading">กำลังโหลดบทสนทนา…</p>
          <div v-if="!messages.length && !loading" class="chat-welcome">
            <h3>วันนี้อยากทำอะไรบ้าง?</h3>
            <p>
              บอกเป้าหมาย เวลาที่สะดวก หรือนัดสำคัญได้ในข้อความเดียว
              ตารางจะอัปเดตตรงข้าง ๆ
            </p>
            <p class="muted">ถ้าเหนื่อยหรือมีธุระเพิ่ม ก็บอกในแชตนี้ได้เลย</p>
          </div>
          <article
            v-for="m in messages"
            :key="m.id"
            :class="['planner-message', m.role]"
          >
            <small>{{
              m.role === "user" ? "คุณ" : companion.character?.name
            }}</small>
            <div class="planner-bubble">{{ m.content }}</div>
            <div v-if="m.outcome" class="action-receipt">{{ m.outcome }}</div>
            <div v-if="m.appliedChanges?.length" class="planner-saved-items">
              <p v-for="c in m.appliedChanges" :key="c.id">
                {{ c.kind === "created" ? "เพิ่ม" : "อัปเดต" }}
                {{ c.name }} · {{ c.date }} {{ clock(c.start) }}–{{ clock(c.start + c.duration) }}
                <span v-if="c.previousDuration !== undefined">
                  · {{ c.previousDuration }} → {{ c.duration }} นาที
                </span>
              </p>
            </div>
            <div v-if="m.followUps?.length" class="planner-followups">
              <button
                v-for="option in m.followUps"
                :key="option.label"
                type="button"
                :disabled="busy"
                @click="chooseFollowUp(option)"
              >
                {{ option.label }}
              </button>
            </div>
          </article>
          <div v-if="busy" class="thinking" role="status">
            {{ companion.character?.name || "ยูนะ" }}กำลังดูตารางให้…
          </div>
        </div>
        <div v-if="proposal" class="chat-preview">
          <strong>ตัวอย่างแผน · ยังไม่บันทึก</strong>
          <p v-if="proposal.capacityOverride" class="capacity-preview">
            เพิ่มเพดานภาระเฉพาะวันที่ {{ proposal.capacityOverride.date }}
            จาก {{ proposal.capacityOverride.previousLimit }} เป็น
            {{ proposal.capacityOverride.maxMinutes }} นาที
            (ไม่เปลี่ยนค่าเริ่มต้นวันอื่น)
          </p>
          <p
            v-for="s in proposal.sessions.filter(
              (s) =>
                !sessions.some(
                  (x) =>
                    x.id === s.id &&
                    x.date === s.date &&
                    x.start === s.start &&
                    x.duration === s.duration &&
                    x.status === s.status,
                ),
            )"
            :key="s.id"
          >
            {{ s.date }} {{ clock(s.start) }} {{ s.name }} ·
            {{ s.duration }} นาที · {{ label(s.status) }}
          </p>
          <p v-for="n in proposal.unscheduled" :key="n">{{ n }}</p>
          <button :disabled="busy" @click="confirm">{{
            proposal.capacityOverride ? "ยืนยันเพิ่มงานและเพดานเฉพาะวัน" : "ยืนยัน"
          }}</button
          ><button :disabled="busy" @click="proposal = undefined">ยกเลิก</button>
        </div>
        <div class="quick-prompts">
          <button
            :disabled="busy"
            @click="send('วันนี้เหนื่อย ช่วยลดภาระและจัดเวลาพักให้หน่อย')"
          >
            วันนี้เหนื่อย</button
          ><button
            :disabled="busy"
            @click="
              input =
                'วันนี้มีนัดเวลา 14:00 น. เป็นเวลา 1 ชั่วโมง ช่วยปรับตารางให้ด้วย'
            "
          >
            มีนัดเพิ่ม</button
          ><button
            :disabled="busy"
            @click="send('วันนี้เหลืออะไรต้องทำบ้าง ช่วยแนะนำสั้น ๆ หน่อย')"
          >
            เหลืออะไรบ้าง
          </button>
        </div>
        <form class="planner-composer" @submit.prevent="send()">
          <textarea
            v-model="input"
            aria-label="ข้อความถึงยูนะ"
            maxlength="4000"
            placeholder="เช่น วันนี้ฝึกอังกฤษ 30 นาที Coding 2 ชั่วโมง มีนัด 14:00…"
            :disabled="busy || !companion.character"
            @keydown.enter.exact.prevent="!$event.isComposing && send()"
          ></textarea>
          <div>
            <label
              ><input
                type="checkbox"
                v-model="autoApply"
                :disabled="busy"
              />จัดตารางทันทีเมื่อฉันสั่ง</label
            ><button
              class="primary"
              :disabled="busy || !input.trim() || !companion.character"
            >
              ส่ง ↗
            </button>
          </div>
          <small
            >Enter ส่ง · Shift+Enter ขึ้นบรรทัดใหม่ ·
            ปิดตัวเลือกเพื่อดูแผนก่อนยืนยัน</small
          >
        </form>
      </section>
    </div>
  </div>
</template>
<style scoped>
.daily-home {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 24px;
  gap: 16px;
  color: #303c37;
}
.planner-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0;
  background: none;
  border: 0;
  height: auto;
  flex-shrink: 0;
}
.planner-header small {
  font-size: 10px;
  letter-spacing: 2px;
  color: #7c8e74;
}
.planner-header h2 {
  margin: 5px 0;
  font-size: 25px;
}
.planner-header p {
  margin: 0;
  font-size: 13px;
  color: #7e877e;
}
.quiet {
  font-size: 12px;
  background: transparent;
  border: 1px solid #dde4d8;
}
.planner-grid {
  display: grid;
  grid-template-columns: minmax(300px, 1fr) minmax(320px, 1fr);
  gap: 22px;
  flex: 1;
  min-height: 0;
}
.agenda {
  overflow: auto;
  padding-right: 4px;
}
.date-heading,
.month-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.date-heading h3 {
  font-size: 18px;
  margin: 5px 0 16px;
}
.week-strip {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 4px;
}
.week-strip button {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-height: 64px;
  padding: 8px 3px;
  background: #eff2eb;
  border-radius: 12px;
}
.week-strip small {
  font-size: 11px;
}
.week-strip strong {
  font-size: 19px;
}
.selected {
  background: #748b66 !important;
  color: white !important;
}
.week-strip i {
  height: 5px;
  font-size: 12px;
  line-height: 6px;
}
.month-picker {
  margin: 14px 0;
  font-size: 12px;
}
.month-picker summary {
  cursor: pointer;
  color: #6d7d65;
}
.month-nav {
  margin: 10px 0;
}
.month-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 3px;
  text-align: center;
}
.month-grid button {
  padding: 6px;
  font-size: 13px;
}
.month-grid small {
  display: block;
  font-size: 9px;
  min-height: 12px;
}
.other {
  opacity: 0.4;
}
.day-stats {
  display: flex;
  gap: 14px;
  font-size: 11px;
  padding: 14px 0;
  border-bottom: 1px solid #e3e8de;
}
.day-stats strong {
  font-size: 16px;
}
.up-next {
  margin-top: 16px;
  background: #e8eedf;
  padding: 13px;
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.up-next small {
  font-size: 10px;
  color: #6f8063;
}
.empty-day {
  text-align: center;
  padding: 40px 10px;
  color: #798171;
}
.empty-day > span {
  font-size: 36px;
}
.empty-day h3 {
  font-size: 18px;
}
.empty-day p {
  font-size: 13px;
  line-height: 1.8;
}
.timeline {
  list-style: none;
  padding: 0;
  margin: 18px 0;
}
.timeline li {
  display: flex;
  gap: 14px;
  margin-bottom: 14px;
}
.time {
  width: 48px;
  flex-shrink: 0;
  text-align: right;
  padding-top: 12px;
  display: flex;
  flex-direction: column;
}
.time strong {
  font-size: 14px;
}
.time small {
  font-size: 11px;
  color: #8b9489;
  margin-top: 3px;
}
.task {
  flex: 1;
  min-width: 0;
  padding: 13px 14px;
  border: 1px solid #dce4d7;
  border-left: 3px solid #95a788;
  border-radius: 10px;
  background: white;
}
.just-applied .task {
  border-color: #6c8f56;
  border-left-color: #507c41;
  background: #f4f9ef;
}
.task-title {
  display: flex;
  gap: 8px;
  justify-content: space-between;
  align-items: flex-start;
}
.task-name {
  flex: 1;
  min-width: 0;
}
.task-heading-tools {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 4px;
}
.reorder-handle,
.reorder-arrow {
  min-width: 25px;
  min-height: 27px;
  border: 1px solid #d9e2d3;
  border-radius: 7px;
  padding: 3px;
  color: #63795c;
  background: #f4f7f1;
  font-size: 13px;
  line-height: 1;
}
.reorder-handle { cursor: grab; }
.reorder-handle:active { cursor: grabbing; }
.reorder-arrow:disabled { opacity: 0.3; cursor: not-allowed; }
.edit-time-trigger {
  min-height: 27px;
  border: 1px solid #cfdaca;
  border-radius: 7px;
  padding: 4px 7px;
  background: #edf3e7;
  color: #506b42;
  font-size: 11px;
  white-space: nowrap;
}
.inline-time-edit {
  display: flex;
  flex-direction: column;
  gap: 9px;
  margin: 10px 0 12px;
  padding: 12px;
  border: 1px solid #d9e3d3;
  border-radius: 10px;
  background: #f8faf5;
}
.time-edit-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.time-edit-fields label {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
  font-size: 11px;
  color: #53664d;
}
.time-edit-fields input {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  min-height: 34px;
  border: 1px solid #d7e1d3;
  border-radius: 7px;
  padding: 6px 8px;
  background: white;
  color: #26342a;
}
.edit-time-preview {
  font-size: 11px;
  line-height: 1.5;
  margin: 0;
}
.time-edit-error {
  margin: 0;
  color: #a6473d;
  font-size: 11px;
}
.edit-time-buttons {
  display: flex;
  gap: 8px;
}
.edit-time-buttons button {
  padding: 6px 10px;
  font-size: 11px;
}
.edit-time-buttons button:first-child {
  background: #7b8f6a;
  color: white;
}
@media (max-width: 620px) {
  .task-heading-tools { flex-wrap: wrap; justify-content: flex-end; }
  .time-edit-fields { grid-template-columns: 1fr; }
}
.reorder-target .task {
  border: 2px dashed #6f9367;
  background: #f0f7e9;
}
.reorder-dragging { opacity: 0.55; }
.planner-header-actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
.habit-suggestions { padding: 14px; border: 1px solid #d5dfd0; background: #f8faf6; border-radius: 12px; margin-bottom: 12px; }
.habit-quick-actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0; }
.habit-quick-actions button, .habit-trial-preview button { padding: 8px 12px; border: 1px solid #9bad93; border-radius: 8px; background: #edf3e8; }
.habit-trial-preview { border-top: 1px solid #d5dfd0; padding: 12px 0; margin-top: 12px; }
.habit-suggestion-item { display: flex; align-items: center; justify-content: space-between; gap: 10px; border-top: 1px solid #d5dfd0; padding: 9px 0; flex-wrap: wrap; }
.habit-suggestion-item p { color: #64735c; font-size: 11px; margin: 4px 0; }
.habit-suggestion-item button { border: 1px solid #9bad93; border-radius: 8px; padding: 8px; background: #edf3e8; }
.actual-start-notice { color: #587252; font-size: 11px; }
.actual-completion {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  color: #4b7750;
  font-size: 11px;
  line-height: 1.5;
}
.planned-time-hint { color: #82907c; }
.reorder-hint {
  color: #63755c;
  font-size: 11px;
  line-height: 1.7;
  margin: 12px 0 0;
}
.reorder-success {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 9px 14px;
  color: #425f37;
  background: #eef5e8;
  font-size: 12px;
  border-radius: 8px;
}
.reorder-success button { color: inherit; font-size: 15px; }
.task-title strong {
  font-size: 14px;
  overflow-wrap: anywhere;
}
.status {
  font-size: 10px;
  white-space: nowrap;
  color: #7a8973;
}
.task p {
  font-size: 11px;
  color: #8b9489;
  margin: 7px 0;
}
.task-actions {
  display: flex;
  gap: 5px;
  flex-wrap: wrap;
}
.task-actions button {
  font-size: 11px;
  padding: 6px 9px;
}
.session-delete-tools {
  margin-top: 6px;
  font-size: 11px;
}
.session-delete-tools button {
  font-size: 11px;
  padding: 6px 9px;
}
.delete-slot-trigger {
  color: #9a4b42;
  background: transparent;
  border: 1px solid #e6d6d1;
}
.delete-slot-confirm {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 7px;
  padding: 8px;
  border: 1px solid #e6d6d1;
  border-radius: 8px;
  color: #80534d;
  background: #fff8f6;
}
.delete-slot-danger {
  color: #fff;
  background: #a85146;
  border-color: #a85146;
}
.done .task {
  opacity: 0.65;
  background: #f0f4eb;
}
.skipped .task,
.deferred .task {
  border-left-color: #c5b38d;
}
.calendar-note {
  font-size: 10px;
  color: #8b9489;
  line-height: 1.8;
}
.planner-conversation {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border: 1px solid #e1e6dc;
  border-radius: 18px;
  background: #fff;
  overflow: hidden;
}
.conversation-heading {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px;
  border-bottom: 1px solid #edf0e9;
}
.conversation-heading > div:nth-child(2) {
  flex: 1;
}
.conversation-heading small {
  display: block;
  font-size: 10px;
  color: #8a9386;
  margin-top: 4px;
}
.avatar {
  border-radius: 50%;
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  background: #edf1e7;
  color: #758b68;
}
.conversation-log {
  flex: 1;
  min-height: 180px;
  overflow: auto;
  padding: 18px;
}
.chat-welcome {
  padding: 22px 6px;
  font-size: 13px;
  line-height: 1.8;
}
.chat-welcome h3 {
  font-size: 20px;
}
.planner-message {
  margin-bottom: 18px;
  max-width: 95%;
}
.planner-message > small {
  font-size: 10px;
  color: #8b9489;
}
.planner-bubble {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.8;
  font-size: 13px;
  padding: 12px 14px;
  border-radius: 14px;
  background: #f1f4ec;
  margin-top: 5px;
}
.planner-message.user {
  margin-left: auto;
}
.user .planner-bubble {
  background: #778b69;
  color: white;
}
.action-receipt {
  white-space: pre-wrap;
  font-size: 10px;
  color: #77836b;
  line-height: 1.6;
  margin-top: 6px;
}
.planner-saved-items {
  font-size: 11px;
  line-height: 1.65;
  color: #5b7450;
  margin-top: 6px;
}
.planner-saved-items p {
  margin: 4px 0;
}
.planner-followups {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}
.planner-followups button {
  font-size: 11px;
  border-radius: 16px;
  padding: 7px 10px;
  background: #f2f4ed;
  border: 1px solid #dce4d4;
  color: #5b7450;
}
.planner-followups button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.thinking {
  font-size: 12px;
  color: #7f8e73;
}
.quick-prompts {
  display: flex;
  gap: 5px;
  flex-wrap: wrap;
  padding: 8px 12px;
}
.quick-prompts button {
  font-size: 11px;
  padding: 7px 9px;
  border-radius: 16px;
}
.planner-composer {
  padding: 12px;
  border-top: 1px solid #edf0e9;
}
.planner-composer textarea {
  width: 100%;
  min-height: 78px;
  max-height: 160px;
  font-size: 13px;
  resize: vertical;
}
.planner-composer > div {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 6px 0;
}
.planner-composer label {
  font-size: 10px;
  display: flex;
  align-items: center;
  gap: 5px;
}
.planner-composer input {
  width: auto;
}
.planner-composer small {
  font-size: 9px;
  color: #8c9487;
}
.capacity-preview {
  font-size: 12px;
  line-height: 1.7;
  font-weight: 600;
  color: #677e57;
}
.chat-preview {
  max-height: 200px;
  overflow: auto;
  padding: 12px;
  background: #f7f1e2;
  font-size: 12px;
}
.reminder {
  background: #f5edcf;
  padding: 10px;
  border-radius: 10px;
  font-size: 13px;
}
@media (max-width: 1150px) {
  .planner-grid {
    grid-template-columns: 1fr;
    min-height: auto;
  }
  .agenda {
    overflow: visible;
  }
  .planner-conversation {
    min-height: 540px;
  }
  .conversation-log {
    max-height: 450px;
  }
  .daily-home {
    padding: 16px;
  }
  .planner-header h2 {
    font-size: 21px;
  }
}
@media (max-width: 500px) {
  .planner-header {
    align-items: flex-start;
  }
  .day-stats {
    gap: 9px;
  }
  .task-title {
    flex-wrap: wrap;
  }
  .conversation-heading .quiet {
    font-size: 10px;
    padding: 6px;
  }
  .planner-header p {
    font-size: 11px;
  }
}
</style>
