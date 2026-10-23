<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import { api } from "../api";
type Session = {
  id: string;
  name: string;
  date: string;
  start: number;
  duration: number;
  status: string;
  fixed: boolean;
  note?: string;
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
type Proposal = { id: string; sessions: Session[]; unscheduled: string[] };
const data = ref<{
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
            (x) => x.id === s.id && x.date === s.date && x.start === s.start,
          ),
      )
      .sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start) ?? [],
);
async function load() {
  data.value = await api("/planner");
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
    <h2>Daily Life Planner</h2>
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
    <fieldset :disabled="busy">
      <label>วันที่ <input type="date" v-model="date" required /></label>
      <label
        >พลังงาน
        <select v-model="energy">
          <option value="normal">ปกติ</option>
          <option value="low">น้อย — กิจกรรมใหม่ไม่เกิน 20 นาที</option>
        </select></label
      >
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
      <p class="muted small">
        เติมกิจกรรมที่ยังไม่มี ไม่ย้ายตารางเดิม และไม่สะสมงานที่ข้ามไปวันถัดไป
      </p>
      <div v-if="proposal" class="planner-card">
        <h3>ตัวอย่างก่อนบันทึก</h3>
        <p v-if="!preview.length">ไม่มีกิจกรรมใหม่</p>
        <p v-for="s in preview" :key="s.id">
          {{ s.date }} {{ clock(s.start) }}–{{ clock(s.start + s.duration) }}
          {{ s.name }}
        </p>
        <p v-for="u in proposal.unscheduled" :key="u" class="muted">{{ u }}</p>
        <button
          class="primary"
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
          >{{ clock(s.start) }}–{{ clock(s.start + s.duration) }}
          {{ s.name }}</strong
        >
        <p>
          {{ s.fixed ? "🔒 นัด/เวลาคงที่" : "ยืดหยุ่น" }} ·
          {{
            s.status === "done"
              ? "สำเร็จ"
              : s.status === "skipped"
                ? "ข้าม"
                : "รอทำ"
          }}
        </p>
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
              await api('/planner/events', 'POST', {
                ...event,
                start: minutes(eventTime),
              });
              proposal = undefined;
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
          ><button>บันทึกนัด</button>
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
      <h3>คุยกับ AI เรื่องแผน</h3>
      <form
        @submit.prevent="
          run(async () => {
            advice = (await api('/planner/advice', 'POST', { message }, 135000))
              .text;
          })
        "
      >
        <textarea
          v-model="message"
          required
          maxlength="2000"
          placeholder="วันนี้เหนื่อย อยากปรับเป้าหมายอย่างไรดี"
        ></textarea
        ><button>ขอคำแนะนำ</button>
      </form>
      <p class="advice">{{ advice }}</p>
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
