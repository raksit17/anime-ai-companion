<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { api } from "../api";

type Category = "exercise" | "study" | "work" | "chores" | "wellbeing" | "other";
type TimeSegment = {
  start: number;
  end: number;
  minutes: number;
  kind: "activity" | "break" | "free" | "sleep";
  category: string;
  label: string;
  status?: "done" | "planned";
};
type DayMetrics = {
  date: string;
  timezone: string;
  wake: number;
  sleep: number;
  totalMinutes: number;
  awakeMinutes: number;
  sleepMinutes: number;
  reservedMinutes: number;
  completedBookedMinutes: number;
  plannedBookedMinutes: number;
  breakMinutes: number;
  freeMinutes: number;
  futureFreeMinutes: number;
  freePercentOfAwake: number;
  actualMeasuredMinutes: number;
  actualSampleCount: number;
  noActualStartCount: number;
  unknownTimeCount: number;
  unknownTimeReportedMinutes: number;
  ignoredSessions: number;
  overlappedMinutes: number;
  categories: Array<{
    category: string;
    minutes: number;
    completedMinutes: number;
    plannedMinutes: number;
    sessions: number;
    done: number;
  }>;
  timeline: TimeSegment[];
  freeWindows: Array<{ start: number; end: number; minutes: number }>;
  note: string;
};
const props = defineProps<{
  date: string;
  revision?: number;
}>();
const data = ref<DayMetrics>();
const busy = ref(false);
const error = ref("");
let requested = 0;
watch(() => [props.date, props.revision], async () => {
  const token = ++requested;
  data.value = undefined;
  error.value = "";
  busy.value = true;
  try {
    const response = await api<DayMetrics>("/planner/daily-analytics?date=" +
      encodeURIComponent(props.date));
    if (token === requested) data.value = response;
  } catch (e) {
    if (token === requested) error.value = String(e);
  } finally {
    if (token === requested) busy.value = false;
  }
}, { immediate: true });

const labels: Record<string, string> = {
  exercise: "ออกกำลังกาย", study: "เรียนรู้ / ภาษา",
  work: "งาน / โปรเจกต์", chores: "งานบ้าน",
  wellbeing: "พักผ่อน / ดูแลตัวเอง", other: "กิจกรรมอื่น",
  free: "ยังไม่ได้จัดกิจกรรม", break: "พักระหว่างงาน", sleep: "นอน / นอกเวลาตื่น",
};
const colors: Record<string, string> = {
  study: "#5E938B", work: "#7D83BB", exercise: "#D18D7A",
  chores: "#B09C62", wellbeing: "#70A7C3", other: "#8C92A0",
  free: "#E5EAE2", break: "#BBD2AB", sleep: "#6E786E",
};
const color = (key: string) => colors[key] ?? colors.other;
const clock = (n: number) =>
  String(Math.floor(n / 60)).padStart(2, "0") + ":" +
  String(n % 60).padStart(2, "0");
function formatted(minutes: number) {
  if (minutes < 60) return minutes + " นาที";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours + " ชม." + (rest ? " " + rest + " นาที" : "");
}
const chartParts = computed(() => {
  if (!data.value) return [];
  return [
    ...data.value.categories.map((x) => ({ key: x.category, minutes: x.minutes })),
    { key: "break", minutes: data.value.breakMinutes },
    { key: "free", minutes: data.value.freeMinutes },
    { key: "sleep", minutes: data.value.sleepMinutes },
  ].filter((x) => x.minutes > 0);
});
const donut = computed(() => {
  let pos = 0;
  const stops = chartParts.value.map((part) => {
    const begin = pos;
    pos += part.minutes / 1440 * 100;
    return color(part.key) + " " + begin + "% " + pos + "%";
  });
  return { background: "conic-gradient(" + (stops.length ? stops.join(", ") : "#E5EAE2 0% 100%") + ")" };
});
const awakeTimeline = computed(() =>
  data.value?.timeline.filter((x) => x.kind !== "sleep") ?? []);
const biggest = computed(() => data.value?.categories[0]);
const freeWindows = computed(() =>
  [...(data.value?.freeWindows ?? [])]
    .filter((x) => x.minutes >= 15)
    .sort((a, b) => b.minutes - a.minutes || a.start - b.start)
    .slice(0, 8));
</script>

<template>
  <section class="daily-usage" aria-label="กราฟวิเคราะห์การใช้เวลาในหนึ่งวัน">
    <div class="usage-heading">
      <div>
        <span class="usage-eyebrow">DAILY TIME CLUSTERS</span>
        <h3>หนึ่งวันใช้เวลาไปกับอะไร?</h3>
        <p>ดูกิจกรรมที่จองไว้ เวลาพัก และช่วงว่างตามปฏิทินวันที่ {{ date }}</p>
      </div>
      <span class="timezone">Asia/Bangkok · 24 ชม.</span>
    </div>
    <p v-if="busy" class="usage-note" role="status">กำลังคำนวณกราฟการใช้เวลา…</p>
    <p v-else-if="error" class="usage-error" role="alert">{{ error }}</p>
    <template v-else-if="data">
      <div class="usage-highlights">
        <div><strong>{{ formatted(data.awakeMinutes) }}</strong><small>เวลาตื่นต่อวัน</small></div>
        <div><strong>{{ formatted(data.reservedMinutes) }}</strong><small>เวลาจองทำกิจกรรม</small></div>
        <div><strong>{{ formatted(data.freeMinutes) }}</strong><small>ยังไม่ได้จัดกิจกรรม</small></div>
        <div><strong>{{ data.freePercentOfAwake }}%</strong><small>ว่างจากเวลาตื่น</small></div>
      </div>

      <div class="usage-chart-row">
        <div class="donut-wrap">
          <div class="usage-donut" :style="donut" role="img"
            :aria-label="'การจัดสรร 24 ชั่วโมง ว่าง ' + formatted(data.freeMinutes) +
              ' กิจกรรม ' + formatted(data.reservedMinutes) +
              ' พักระหว่างงาน ' + formatted(data.breakMinutes) +
              ' และนอน ' + formatted(data.sleepMinutes)">
            <div class="donut-center">
              <strong>{{ data.freePercentOfAwake }}%</strong>
              <small>ว่างในเวลาตื่น</small>
            </div>
          </div>
        </div>
        <div class="usage-legend">
          <div v-for="part in chartParts" :key="part.key" class="legend-item">
            <span class="legend-color" :style="{ background: color(part.key) }"></span>
            <span class="legend-label">{{ labels[part.key] ?? part.key }}</span>
            <strong>{{ formatted(part.minutes) }}</strong>
          </div>
        </div>
      </div>

      <div class="usage-timeline" aria-label="แถบเวลาระหว่างตื่นและนอน">
        <div class="timeline-title">
          <strong>ไทม์ไลน์ช่วงตื่น</strong>
          <span>{{ clock(data.wake) }} – {{ clock(data.sleep) }}</span>
        </div>
        <div class="timeline-bar" role="img"
          :aria-label="'แผนตลอดเวลาตื่น ' + formatted(data.awakeMinutes)">
          <div v-for="(segment, index) in awakeTimeline" :key="index"
            class="timeline-segment"
            :style="{ width: (segment.minutes / data.awakeMinutes * 100) + '%',
              background: color(segment.category) }"
            :title="clock(segment.start) + '–' + clock(segment.end) +
              ' ' + segment.label + ' (' + formatted(segment.minutes) + ')'">
          </div>
        </div>
        <p class="usage-note">
          สีตามประเภทกิจกรรม · งานที่เสร็จแล้วและงานที่ยังวางแผนแยกในสถิติด้านล่าง
        </p>
      </div>

      <div class="usage-details">
        <div>
          <h4>แบ่งเวลาตามกลุ่มกิจกรรม</h4>
          <div v-if="!data.categories.length" class="usage-note">
            วันนี้ยังไม่มีงานที่จองในตาราง — เวลาตื่นจึงแสดงเป็นช่วงว่าง
          </div>
          <div v-for="category in data.categories" :key="category.category" class="cluster-row">
            <div class="cluster-head">
              <span>{{ labels[category.category] ?? category.category }}</span>
              <strong>{{ formatted(category.minutes) }}</strong>
            </div>
            <div class="cluster-track"><span
              :style="{ background: color(category.category),
                width: (category.minutes / data.awakeMinutes * 100) + '%' }"></span></div>
            <small>{{ category.sessions }} กิจกรรม · ทำเสร็จ {{ category.done }} ·
              จองไว้ {{ formatted(category.plannedMinutes) }}</small>
          </div>
          <p v-if="biggest" class="usage-note">
            กลุ่มที่จองเวลามากที่สุดคือ {{ labels[biggest.category] ?? biggest.category }}
            ({{ formatted(biggest.minutes) }})
          </p>
        </div>
        <div>
          <h4>ช่วงว่างที่ยาวที่สุด</h4>
          <div v-if="!freeWindows.length" class="usage-note">ไม่มีช่วงว่างตั้งแต่ 15 นาทีขึ้นไป</div>
          <div v-for="window in freeWindows" :key="window.start" class="free-window">
            <strong>{{ clock(window.start) }}–{{ clock(window.end) }}</strong>
            <span>{{ formatted(window.minutes) }}</span>
          </div>
          <p class="usage-note">
            เวลาพักระหว่างงาน {{ formatted(data.breakMinutes) }} ·
            นอน / นอกเวลาตื่น {{ formatted(data.sleepMinutes) }}
          </p>
        </div>
      </div>

      <div class="usage-footer">
        <span v-if="date === new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10)">
          ว่างที่ยังเหลือจากตอนนี้ {{ formatted(data.futureFreeMinutes) }}
        </span>
        <span>งานเสร็จตามเวลาจอง {{ formatted(data.completedBookedMinutes) }}</span>
        <span>งานที่ยังวางแผน {{ formatted(data.plannedBookedMinutes) }}</span>
        <span v-if="data.actualSampleCount">
          จับเวลาทำจริงได้ {{ formatted(data.actualMeasuredMinutes) }}
          ({{ data.actualSampleCount }} งาน)
        </span>
        <span v-if="data.unknownTimeCount">
          ทำเสร็จย้อนหลังไม่ทราบช่วงเวลา {{ data.unknownTimeCount }} งาน
          (รายงาน {{ formatted(data.unknownTimeReportedMinutes) }})
          · ไม่หักจากช่องว่างโดยเดาเวลา
        </span>
        <span v-if="data.noActualStartCount">
          ยังไม่ทราบเวลาทำจริง {{ data.noActualStartCount }} งาน
        </span>
        <span v-if="data.ignoredSessions">
          ไม่รวมงานข้าม/พักไว้ {{ data.ignoredSessions }} งาน
        </span>
        <span v-if="data.overlappedMinutes">พบเวลาจองซ้อน {{ formatted(data.overlappedMinutes) }}</span>
      </div>
      <p class="usage-note">{{ data.note }}</p>
    </template>
  </section>
</template>

<style scoped>
.daily-usage { margin: 18px 0 22px; padding: 18px; border-radius: 16px;
  border: 1px solid #d8dfd2; background: #fafcf9; color: #3d4c3c; }
.usage-heading { display: flex; justify-content: space-between; align-items: start;
  gap: 14px; flex-wrap: wrap; }
.usage-heading h3 { font-size: 20px; font-weight: 650; margin: 3px 0 6px; }
.usage-heading p, .usage-note { color: #6c7969; font-size: 12px; line-height: 1.6; margin: 4px 0; }
.usage-eyebrow { font-size: 10px; letter-spacing: .16em; color: #788a74; }
.timezone { font-size: 11px; color: #788a74; }
.usage-highlights { display: grid; grid-template-columns: repeat(4, minmax(0,1fr));
  gap: 8px; margin: 15px 0; }
.usage-highlights > div { padding: 10px; border: 1px solid #dde3da; border-radius: 9px; background: #fff; }
.usage-highlights strong { display: block; font-size: 19px; margin-bottom: 3px; }
.usage-highlights small { color: #72806c; font-size: 11px; }
.usage-chart-row { display: flex; gap: 25px; align-items: center; flex-wrap: wrap; margin: 10px 0 20px; }
.donut-wrap { width: 175px; height: 175px; flex-shrink: 0; }
.usage-donut { width: 100%; height: 100%; border-radius: 50%; display: grid; place-items: center; }
.donut-center { background: #fafcf9; width: 66%; height: 66%; border-radius: 50%;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  text-align: center; box-shadow: 0 0 0 2px #fafcf9; }
.donut-center strong { font-size: 30px; line-height: 1.2; }
.donut-center small { font-size: 10px; color: #70806b; }
.usage-legend { flex: 1; min-width: 200px; display: grid; gap: 8px; }
.legend-item { display: flex; align-items: center; gap: 9px; font-size: 12px; }
.legend-item strong { margin-left: auto; white-space: nowrap; }
.legend-color { display: inline-block; width: 12px; height: 12px; border-radius: 3px; flex-shrink: 0; }
.legend-label { flex: 1; }
.timeline-title, .cluster-head { display: flex; justify-content: space-between;
  flex-wrap: wrap; gap: 9px; margin-bottom: 8px; font-size: 12px; }
.timeline-title span { color: #738271; }
.timeline-bar { display: flex; height: 27px; border-radius: 7px; overflow: hidden; background: #e5eae2; }
.timeline-segment { height: 100%; min-width: 0; }
.timeline-segment + .timeline-segment { border-left: 1px solid #ffffff70; }
.usage-details { display: grid; grid-template-columns: repeat(2,minmax(0,1fr));
  gap: 22px; margin-top: 20px; }
.usage-details h4 { font-size: 14px; margin: 0 0 13px; }
.cluster-row { margin-bottom: 12px; }
.cluster-head { margin-bottom: 4px; }
.cluster-track { width: 100%; height: 7px; background: #edf1eb;
  border-radius: 5px; overflow: hidden; }
.cluster-track span { display: block; height: 100%; border-radius: 5px; }
.cluster-row small { color: #82907c; font-size: 11px; }
.free-window { display: flex; justify-content: space-between; gap: 9px; padding: 7px 0;
  border-bottom: 1px solid #e3e9e0; font-size: 12px; }
.free-window span { color: #788674; }
.usage-footer { display: flex; flex-wrap: wrap; gap: 7px 15px; margin: 16px 0 6px;
  color: #5d6d59; font-size: 11px; }
.usage-error { color: #a44343; }
@media (max-width: 650px) {
  .daily-usage { padding: 13px; }
  .usage-highlights { grid-template-columns: repeat(2,minmax(0,1fr)); }
  .usage-details { grid-template-columns: 1fr; }
  .usage-chart-row { justify-content: center; }
}
</style>
