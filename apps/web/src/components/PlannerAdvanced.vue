<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import { api } from "../api";
import DailyTimeAnalytics from "./DailyTimeAnalytics.vue";
import PastActivityForm from "./PastActivityForm.vue";
type Session = {
  id: string;
  name: string;
  date: string;
  start: number;
  duration: number;
  status: string;
  fixed: boolean;
  note?: string;
  historicalTimeAccuracy?: "exact" | "estimated" | "unknown";
};
type Goal = {
  id?: string;
  name: string;
  duration: number;
  days: number[];
  preferred: number;
  priority: number;
  restDays: number;
  reminder: number;
  flexible: boolean;
};
type HabitActivity = {
  activityKey: string;
  category: string;
  name: string;
  total: number;
  done: number;
  skipped: number;
  missed: number;
  cancelled: number;
  completionRate: number | null;
  averageActualMinutes: number | null;
  actualSamples: number;
  evidenceCount: number;
  recurringPattern: boolean;
  preferredStart: number | null;
};
type Habits = {
  from: string;
  to: string;
  days: number;
  activityCount: number;
  completed: number;
  cancelled: number;
  missingActualStarts: number;
  activities: HabitActivity[];
  categories: Array<{ category: string; total: number; done: number }>;
  timeClusters?: Array<{ start: number; count: number }>;
  eventKinds: Array<{ kind: string; count: number }>;
  recommendations: Array<{
    activityKey: string; name: string; category: string;
    evidenceCount: number; preferredStart: number;
    reason: string;
  }>;
  note: string;
};
type Proposal = {
  id: string;
  sessions: Session[];
  unscheduled: string[];
  reasons?: string[];
  breakMinutes?: number;
  source?: "habits";
  mode?: "recent-trial" | "habit";
  analysisFrom?: string;
  analysisTo?: string;
  suggestions?: Array<{
    sessionId: string;
    name: string;
    evidenceCount: number;
    preferredStart: number;
    plannedStart: number;
    confidence: "high" | "medium" | "low";
    reason: string;
  }>;
};
type Weekly = {
  from: string;
  to: string;
  total: number;
  done: number;
  recommendations: string[];
  goals: {
    id: string;
    name: string;
    total: number;
    done: number;
    missed: number;
    skipped: number;
    deferred: number;
    rate: number;
  }[];
};
const habits = ref<Habits>();
const daysWindow = ref(90);
const data = ref<{
  revision: number;
  weekly: Weekly;
  weeklyReport?: { text: string; generatedAt: string };
  goals: Goal[];
  sessions: Session[];
  settings: {
    wake: number;
    sleep: number;
    breakMinutes: number;
    maxMinutes: number;
  };
  progress: { done: number; skipped: number; minutes: number };
}>();
const date = ref(new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10)),
  energy = ref("normal");
const error = ref(""),
  busy = ref(false),
  proposal = ref<Proposal>(),
  advice = ref(""),
  message = ref(""),
  reminders = ref<Session[]>([]);
const blank = (): Goal => ({
  name: "",
  duration: 45,
  days: [1, 2, 3, 4, 5],
  preferred: 780,
  priority: 2,
  restDays: 0,
  reminder: 10,
  flexible: true,
});
const goal = ref<Goal>(blank()),
  preferred = ref("13:00"),
  wake = ref("08:00"),
  sleep = ref("22:00");
const event = ref({ name: "", date: date.value, start: 840, duration: 60 }),
  eventTime = ref("14:00");
const moving = ref(""),
  moveDate = ref(date.value),
  moveTime = ref("10:00"),
  note = ref("");
const days = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
const clock = (n: number) =>
  `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
const minutes = (s: string) =>
  Number(s.split(":")[0]) * 60 + Number(s.split(":")[1]);
const sessions = computed(
  () =>
    data.value?.sessions
      .filter((s) => s.date === date.value)
      .sort((a, b) => a.start - b.start) ?? [],
);
const preview = computed(
  () =>
    proposal.value?.sessions
      .filter(
        (s) =>
          !data.value?.sessions.some(
            (x) =>
              x.id === s.id &&
              x.date === s.date &&
              x.start === s.start &&
              x.duration === s.duration &&
              x.status === s.status,
          ),
      )
      .sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start) ?? [],
);
async function load() {
  data.value = await api("/planner");
  habits.value = await api<Habits>("/planner/habits?days=" + daysWindow.value);
  wake.value = clock(data.value!.settings.wake);
  sleep.value = clock(data.value!.settings.sleep);
}
async function run(fn: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    await fn();
  } catch (e) {
    error.value = String(e);
  } finally {
    busy.value = false;
  }
}
const bangkokDate = (offsetDays = 0) =>
  new Date(Date.now() + (7 + offsetDays * 24) * 3600000)
    .toISOString().slice(0, 10);
async function suggestHabitPlan(targetDate: string) {
  await run(async () => {
    date.value = targetDate;
    proposal.value = await api<Proposal>("/planner/recommendations/preview", "POST", {
      date: targetDate, energy: energy.value, days: daysWindow.value,
    });
  });
}
async function saveGoal() {
  await run(async () => {
    const { id, ...body } = goal.value;
    await api(
      id ? `/planner/goals/${id}` : "/planner/goals",
      id ? "PATCH" : "POST",
      { ...body, preferred: minutes(preferred.value) },
    );
    goal.value = blank();
    proposal.value = undefined;
    await load();
  });
}
function edit(g: Goal) {
  goal.value = { ...g, days: [...g.days] };
  preferred.value = clock(g.preferred);
}
async function poll() {
  try {
    reminders.value = await api("/planner/reminders");
    if (data.value && !data.value.weeklyReport) {
      const latest = await api("/planner");
      data.value.weeklyReport = latest.weeklyReport;
    }
  } catch {
    /* Main load/actions display connection errors; retry reminders next tick. */
  }
}
let timer: ReturnType<typeof setInterval>;
onMounted(() => {
  void run(load);
  void poll();
  timer = setInterval(() => void checkNotifications(), 30000);
});
onBeforeUnmount(() => clearInterval(timer));
async function mark(s: Session, status: string) {
  await run(async () => {
    await api(`/planner/sessions/${s.id}`, "PATCH", {
      status,
      note: note.value,
    });
    proposal.value = undefined;
    note.value = "";
    await load();
    await poll();
  });
}
async function notify() {
  if (!("Notification" in window)) {
    error.value = "อุปกรณ์นี้ไม่รองรับการแจ้งเตือนเบราว์เซอร์";
    return;
  }
  const permission = await Notification.requestPermission();
  if (permission === "granted")
    new Notification("Daily Planner", {
      body: "เปิดการแจ้งเตือนแล้ว กรุณาเปิดแอปค้างไว้",
    });
}
const seen = new Set<string>();
async function checkNotifications() {
  await poll();
  if ("Notification" in window && Notification.permission === "granted")
    for (const s of reminders.value)
      if (!seen.has(s.id)) {
        new Notification("ถึงเวลากิจกรรม", {
          body: `${s.name} · ${clock(s.start)}`,
        });
        seen.add(s.id);
      }
}
</script>
<template>
  <section class="planner">
    <h2>Adaptive Life Planner</h2>
    <p class="muted">
      เวลาไทย (Asia/Bangkok) · เป้าหมายร่วมของผู้ใช้ทุกตัวละคร
    </p>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <div v-for="r in reminders" :key="r.id" class="planner-card" role="status">
      🔔 {{ r.name }} {{ clock(r.start) }}
      <button
        :disabled="busy"
        @click="
          run(async () => {
            await api(`/planner/reminders/${r.id}/ack`, 'POST');
            proposal = undefined;
            await poll();
          })
        "
      >
        รับทราบ
      </button>
    </div>
    <button @click="notify">เปิดแจ้งเตือน</button>
    <p class="muted small">
      แจ้งเตือนเมื่อ API และหน้าต่างแอปเปิดอยู่ ตรวจทุก 30 วินาที
    </p>
    <PastActivityForm :date="date" @saved="load" />
    <fieldset :disabled="busy">
      <details open class="habit-dashboard">
        <summary>วิเคราะห์นิสัยและประวัติกิจกรรมระยะยาว</summary>
        <div class="habit-range">
          <label>ช่วงย้อนหลัง
            <select v-model.number="daysWindow"
              @change="run(async () => {
                habits = await api('/planner/habits?days=' + daysWindow);
              })">
              <option :value="4">4 วัน (ทดลอง)</option>
              <option :value="7">7 วัน</option>
              <option :value="30">30 วัน</option>
              <option :value="90">90 วัน</option>
              <option :value="180">180 วัน</option>
              <option :value="365">365 วัน</option>
            </select>
          </label>
        </div>
        <template v-if="habits">
          <p class="muted small" v-if="daysWindow === 4">ทดลองจาก 4 วันก่อนหน้า · ข้อมูลน้อยยังไม่ใช่นิสัยประจำ</p>
          <div class="habit-stats">
            <p><strong>{{ habits.activityCount }}</strong><small>กิจกรรมในประวัติ</small></p>
            <p><strong>{{ habits.completed }}</strong><small>ทำเสร็จ</small></p>
            <p><strong>{{ habits.cancelled }}</strong><small>ยกเลิก/ลบสล็อต</small></p>
          </div>
          <p class="muted small" v-if="habits.missingActualStarts">
            {{ habits.missingActualStarts }} งานที่เสร็จแล้วยังไม่มีเวลาเริ่มจริง จึงไม่คำนวณเวลาทำจริงจากกำหนดการ
          </p>
          <h3>ช่วงเวลาที่ทำสำเร็จบ่อย (Time Clusters)</h3>
          <div v-if="habits.timeClusters?.length" class="habit-time-clusters">
            <div v-for="slot in habits.timeClusters.slice(0, 8)"
              :key="slot.start" class="habit-time-bin">
              <strong>{{ clock(slot.start) }}–{{ clock(slot.start + 30) }}</strong>
              <small>สำเร็จ {{ slot.count }} ครั้ง</small>
            </div>
          </div>
          <p v-else class="muted small">ยังไม่มีข้อมูลกิจกรรมที่ยืนยันว่าทำสำเร็จ</p>
          <h3>กลุ่มกิจกรรม (Habit Clusters)</h3>
          <div v-if="!habits.activities.length" class="muted small">
            ยังไม่มีประวัติกิจกรรมในช่วงนี้ ระบบจะไม่เดานิสัยจากข้อความแชต
          </div>
          <article v-for="h in habits.activities" :key="h.activityKey" class="habit-cluster">
            <div class="habit-cluster-head">
              <strong>{{ h.name }}</strong>
              <small>{{ h.category }} · {{ h.total }} ครั้ง</small>
            </div>
            <div class="habit-track">
              <span :style="{ width: ((h.done / Math.max(h.total, 1)) * 100) + '%' }"></span>
            </div>
            <p class="muted small">
              สำเร็จ {{ h.done }} · ข้าม {{ h.skipped }} · เลยกำหนด {{ h.missed }} · ยกเลิก {{ h.cancelled }}
              <template v-if="h.actualSamples">
                · เวลาทำจริงเฉลี่ย {{ h.averageActualMinutes }} นาที ({{ h.actualSamples }} ครั้งที่วัดได้)
              </template>
            </p>
            <p class="muted small" v-if="!h.recurringPattern">
              ยังไม่พบการทำสำเร็จซ้ำหลายสัปดาห์ จึงยังไม่สรุปว่าเป็นนิสัยประจำ
            </p>
          </article>
          <h3>ข้อเสนอจากประวัติ</h3>
          <p v-if="!habits.recommendations.length" class="muted small">
            ยังมีข้อมูลซ้ำที่น่าเชื่อถือไม่พอสำหรับเสนอเวลาอัตโนมัติ
          </p>
          <article v-for="suggestion in habits.recommendations"
            :key="suggestion.activityKey" class="habit-cluster">
            <strong>{{ suggestion.name }}</strong>
            <p>{{ clock(suggestion.preferredStart) }} ·
              พบทำสำเร็จ {{ suggestion.evidenceCount }} ครั้ง</p>
            <p class="muted small">{{ suggestion.reason }}</p>
          </article>
          <p class="muted small">{{ habits.note }}</p>
        </template>
      </details>
      <details open v-if="data?.weekly" class="weekly">
        <summary>
          ทบทวนสัปดาห์ก่อน {{ data.weekly.from }} – {{ data.weekly.to }}
        </summary>
        <p v-if="!data.weekly.total">
          ยังไม่มีข้อมูลสัปดาห์ก่อน ระบบจะเริ่มวิเคราะห์เมื่อมีประวัติ
        </p>
        <template v-else>
          <p>สำเร็จ {{ data.weekly.done }} / {{ data.weekly.total }} กิจกรรม</p>
          <p v-for="g in data.weekly.goals" :key="g.id">
            {{ g.name }}: {{ Math.round(g.rate * 100) }}% · ข้าม
            {{ g.skipped }} · ยังไม่บันทึกผล {{ g.missed }} · พักไว้
            {{ g.deferred }}
          </p>
          <p v-for="r in data.weekly.recommendations" :key="r">{{ r }}</p>
          <button
            @click="
              run(async () => {
                await api('/planner/weekly-review', 'POST', {}, 135000);
                await load();
              })
            "
          >
            อ่านผลวิเคราะห์ AI รายสัปดาห์
          </button>
          <p class="advice" v-if="data.weeklyReport">
            {{ data.weeklyReport.text }}
          </p>
          <small v-if="data.weeklyReport"
            >วิเคราะห์เมื่อ
            {{
              new Date(data.weeklyReport.generatedAt).toLocaleString("th-TH", {
                timeZone: "Asia/Bangkok",
              })
            }}</small
          >
          <p class="muted small">
            API วิเคราะห์อัตโนมัติสัปดาห์ละครั้งเมื่อเปิดอยู่ รายงานเป็นภาพรวม ณ
            เวลาวิเคราะห์ ไม่มีการเปลี่ยนตารางจนกดยืนยัน
          </p>
        </template>
      </details>
      <label>วันที่ <input type="date" v-model="date" required /></label>
      <DailyTimeAnalytics :date="date" :revision="data?.revision ?? 0" />
      <label
        >พลังงาน
        <select v-model="energy">
          <option value="normal">ปกติ</option>
          <option value="low">น้อย — กิจกรรมใหม่ไม่เกิน 20 นาที</option>
        </select></label
      >
      <div class="habit-suggestion-actions">
        <button type="button" class="primary" @click="suggestHabitPlan(bangkokDate())">
          ✨ แนะนำแผนวันนี้จากประวัติ
        </button>
        <button type="button" @click="suggestHabitPlan(bangkokDate(1))">
          ✨ แนะนำแผนพรุ่งนี้จากประวัติ
        </button>
        <button type="button" @click="suggestHabitPlan(date)">
          แนะนำแผนวันที่เลือก
        </button>
      </div>
      <p class="muted small">
        เรียนรู้จากกิจกรรมที่ทำสำเร็จซ้ำในหลายสัปดาห์เท่านั้น
        แผนเป็นตัวอย่าง ไม่บันทึกหรือย้ายงานอื่นจนกดยืนยัน
      </p>
      <button
        class="primary"
        @click="
          run(async () => {
            proposal = await api('/planner/proposals', 'POST', {
              date,
              energy,
            });
          })
        "
      >
        เสนอแผน 7 วัน
      </button>
      <button
        @click="
          run(async () => {
            proposal = await api('/planner/adaptive', 'POST', { date, energy });
          })
        "
      >
        ปรับตารางเดิมตามความคืบหน้า
      </button>
      <p class="muted small">
        ปรับกิจกรรมยืดหยุ่นใน 7 วันที่เลือก รักษานัดคงที่และวันพัก
        ไม่สะสมงานเก่าที่พลาด
      </p>
      <p class="muted small">
        เติมกิจกรรมที่ยังไม่มี ไม่ย้ายตารางเดิม และไม่สะสมงานที่ข้ามไปวันถัดไป
      </p>
      <div v-if="proposal" class="planner-card">
        <h3>ตัวอย่างก่อนบันทึก</h3>
        <template v-if="proposal.source === 'habits'">
          <p v-if="proposal.mode === 'recent-trial'" class="muted small">โหมดทดลอง 4 วัน: เป็นแผนตัวอย่าง ไม่ใช่นิสัยที่พิสูจน์แล้ว</p>
          <p class="muted small">
            ระบบตรวจประวัติการทำจริง เวลาที่เคยสำเร็จ และข้อจำกัดตาราง
            ก่อนเสนอสล็อตใหม่ ไม่มีการเปลี่ยนแผนอัตโนมัติ
          </p>
          <article v-for="suggestion in proposal.suggestions"
            :key="suggestion.sessionId" class="habit-cluster">
            <strong>{{ suggestion.name }}</strong>
            <p class="muted small">
              พบทำสำเร็จ {{ suggestion.evidenceCount }} ครั้ง ·
              ความมั่นใจ {{ suggestion.confidence === 'high' ? 'สูง' : 'ปานกลาง' }}
            </p>
            <p class="muted small">{{ suggestion.reason }}</p>
          </article>
        </template>
        <p v-if="proposal.breakMinutes">
          เว้นพักอย่างน้อย {{ proposal.breakMinutes }} นาที
        </p>
        <p v-for="reason in proposal.reasons" :key="reason">{{ reason }}</p>
        <p v-if="!preview.length">ไม่มีกิจกรรมใหม่</p>
        <div v-for="s in preview" :key="s.id" class="planner-card">
          <small v-if="data?.sessions.find((x) => x.id === s.id)"
            >เดิม: {{ data.sessions.find((x) => x.id === s.id)!.date }}
            {{ clock(data.sessions.find((x) => x.id === s.id)!.start) }} ·
            {{ data.sessions.find((x) => x.id === s.id)!.duration }} นาที</small
          >
          <p>
            {{ s.name }} →
            {{
              s.status === "deferred"
                ? "พักไว้ (ยังไม่ได้จัดเวลา)"
                : `${s.date} ${clock(s.start)}–${clock(s.start + s.duration)}`
            }}
          </p>
        </div>
        <p v-for="u in proposal.unscheduled" :key="u" class="muted">{{ u }}</p>
        <button
          class="primary"
          :disabled="!preview.length"
          @click="
            run(async () => {
              await api(`/planner/proposals/${proposal!.id}/confirm`, 'POST');
              proposal = undefined;
              await load();
            })
          "
        >
          ยืนยันแผน</button
        ><button @click="proposal = undefined">ยกเลิก</button>
      </div>
      <h3>ตารางวันที่ {{ date }}</h3>
      <p v-if="!sessions.length">ยังไม่มีกิจกรรม ลองเพิ่มเป้าหมายแล้วเสนอแผน</p>
      <label
        >บันทึกผล เช่น เซต/ครั้ง/น้ำหนัก หรือหัวข้อที่ฝึก
        <input v-model="note" maxlength="1000"
      /></label>
      <article v-for="s in sessions" :key="s.id" class="planner-card">
        <strong
          >{{ s.historicalTimeAccuracy === "unknown" ? "ไม่ทราบช่วงเวลา" :
            clock(s.start) + "–" + clock(s.start + s.duration) }}
          {{ s.name }}</strong
        >
        <p>
          {{ s.fixed ? "🔒 นัด/เวลาคงที่" : "ยืดหยุ่น" }} ·
          {{
            s.status === "done"
              ? "สำเร็จ"
              : s.status === "skipped"
                ? "ข้าม"
                : s.status === "deferred"
                  ? "พักไว้"
                  : "รอทำ"
          }}
        </p>
        <p v-if="s.historicalTimeAccuracy">↶ บันทึกย้อนหลัง · {{ s.historicalTimeAccuracy === "unknown" ? "ไม่ทราบเวลา" : s.historicalTimeAccuracy === "estimated" ? "เวลาประมาณ" : "เวลาที่ระบุ" }}</p>
        <p v-if="s.note">{{ s.note }}</p>
        <template v-if="s.status === 'planned'"
          ><button @click="mark(s, 'done')">✓ สำเร็จ</button
          ><button @click="mark(s, 'skipped')">ข้าม</button
          ><button
            v-if="!s.fixed"
            @click="
              moving = s.id;
              moveDate = s.date;
              moveTime = clock(s.start);
            "
          >
            ย้ายเวลา
          </button></template
        >
      </article>
      <form
        v-if="moving"
        @submit.prevent="
          run(async () => {
            proposal = await api(`/planner/sessions/${moving}/move`, 'POST', {
              date: moveDate,
              start: minutes(moveTime),
            });
            moving = '';
          })
        "
      >
        <label
          >ย้ายไปวันที่<input v-model="moveDate" type="date" required /></label
        ><label>เวลา<input v-model="moveTime" type="time" required /></label
        ><button>ตรวจและเสนอการย้าย</button
        ><button type="button" @click="moving = ''">ยกเลิก</button>
      </form>
      <p v-if="data">
        สะสม: สำเร็จ {{ data.progress.done }} · ข้าม
        {{ data.progress.skipped }} · ฝึก {{ data.progress.minutes }} นาที
      </p>
      <details>
        <summary>เป้าหมายและกิจกรรมซ้ำ</summary>
        <article v-for="g in data?.goals" :key="g.id" class="planner-card">
          {{ g.name }} · {{ g.days.length }} วัน/สัปดาห์ · {{ g.duration }} นาที
          <button @click="edit(g)">แก้ไข</button
          ><button
            @click="
              run(async () => {
                await api(`/planner/goals/${g.id}`, 'DELETE');
                proposal = undefined;
                await load();
              })
            "
          >
            ลบเป้าหมาย
          </button>
        </article>
        <form @submit.prevent="saveGoal">
          <label
            >ชื่อเป้าหมาย<input
              v-model="goal.name"
              required
              maxlength="120"
              placeholder="อังกฤษ / Coding / ออกกำลังกาย"
          /></label>
          <label
            >นาที<input
              v-model.number="goal.duration"
              type="number"
              min="10"
              max="240"
              required /></label
          ><label
            >เวลาที่ชอบ<input v-model="preferred" type="time" required
          /></label>
          <div class="days">
            <label v-for="(d, i) in days" :key="i"
              ><input type="checkbox" v-model="goal.days" :value="i" />{{
                d
              }}</label
            >
          </div>
          <label
            >ความสำคัญ<select v-model.number="goal.priority">
              <option :value="1">ต่ำ</option>
              <option :value="2">กลาง</option>
              <option :value="3">สูง</option>
            </select></label
          >
          <label
            >วันพักระหว่างครั้ง<input
              v-model.number="goal.restDays"
              type="number"
              min="0"
              max="6"
              required /></label
          ><label
            >เตือนก่อน (นาที)<input
              v-model.number="goal.reminder"
              type="number"
              min="0"
              max="120"
              required
          /></label>
          <label
            ><input type="checkbox" v-model="goal.flexible" />ย้ายเวลาได้</label
          ><button class="primary">
            {{ goal.id ? "บันทึก" : "เพิ่มเป้าหมาย" }}</button
          ><button type="button" @click="goal = blank()">ล้าง</button>
        </form>
      </details>
      <details>
        <summary>เพิ่มนัดสำคัญ / เวลาพักกลางวัน</summary>
        <form
          @submit.prevent="
            run(async () => {
              proposal = await api('/planner/events/proposal', 'POST', {
                ...event,
                start: minutes(eventTime),
              });

              event.name = '';
              await load();
            })
          "
        >
          <label
            >ชื่อนัด<input
              v-model="event.name"
              required
              maxlength="120" /></label
          ><label
            >วันที่<input v-model="event.date" type="date" required /></label
          ><label>เวลา<input v-model="eventTime" type="time" required /></label
          ><label
            >ระยะเวลา (นาที)<input
              v-model.number="event.duration"
              type="number"
              min="5"
              max="720"
              required /></label
          ><button>เสนอแผนพร้อมนัดใหม่</button>
        </form>
      </details>
      <details v-if="data">
        <summary>เวลาว่างและขีดจำกัด</summary>
        <form
          @submit.prevent="
            run(async () => {
              await api('/planner/settings', 'PATCH', {
                ...data!.settings,
                wake: minutes(wake),
                sleep: minutes(sleep),
              });
              proposal = undefined;
              await load();
            })
          "
        >
          <label>เริ่มวัน<input type="time" v-model="wake" required /></label
          ><label>เข้านอน<input type="time" v-model="sleep" required /></label
          ><label
            >พักระหว่างกิจกรรม (นาที)<input
              type="number"
              v-model.number="data.settings.breakMinutes"
              min="0"
              max="120"
              required /></label
          ><label
            >ภาระกิจกรรมยืดหยุ่นสูงสุด/วัน (นาที)<input
              type="number"
              v-model.number="data.settings.maxMinutes"
              min="10"
              max="720"
              required /></label
          ><button>บันทึก</button>
        </form>
      </details>
    </fieldset>
    <p v-if="busy" role="status">กำลังดำเนินการ…</p>
  </section>
</template>
<style scoped>
.planner {
  padding: 20px;
  overflow: auto;
  min-height: 0;
}
.planner h2 {
  margin: 0 0 8px;
}
.planner h3 {
  margin-top: 22px;
}
.planner fieldset {
  border: 0;
  padding: 0;
  min-width: 0;
}
.planner label {
  display: block;
  margin: 10px 0;
}
.planner input:not([type="checkbox"]),
.planner select,
.planner textarea {
  width: 100%;
}
.habit-time-clusters { display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0; }
.habit-time-bin { display: flex; flex-direction: column; gap: 4px; min-width: 140px; padding: 8px 10px; border: 1px solid #738b8555; border-radius: 8px; }
.habit-suggestion-actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0; }
.habit-range select { max-width: 160px; }
.habit-stats { display: flex; gap: 10px; flex-wrap: wrap; }
.habit-stats p { min-width: 105px; padding: 10px; border: 1px solid #738b8555; border-radius: 8px; }
.habit-stats strong { display: block; font-size: 22px; }
.habit-stats small { display: block; color: #738b85; }
.habit-cluster { margin: 10px 0; padding: 11px; border: 1px solid #738b8555; border-radius: 10px; }
.habit-cluster-head { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px; }
.habit-track { margin: 10px 0 5px; height: 6px; border-radius: 6px; background: #dddfe0; overflow: hidden; }
.habit-track span { display: block; height: 100%; border-radius: inherit; background: #7b916d; }
.planner-card {
  padding: 12px;
  border: 1px solid #738b8555;
  border-radius: 12px;
  margin: 10px 0;
}
.planner button {
  margin: 4px;
}
.planner details {
  border-top: 1px solid #738b8555;
  padding: 14px 0;
}
.days {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.advice {
  white-space: pre-wrap;
}
.planner summary {
  cursor: pointer;
}
</style>
