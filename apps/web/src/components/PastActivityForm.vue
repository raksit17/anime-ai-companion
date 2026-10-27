<script setup lang="ts">
import { ref, watch } from "vue";
import { api } from "../api";
import { generateRequestId } from "../services/request-id";

const props = defineProps<{ date: string }>();
const emit = defineEmits<{ saved: [record: { id: string; date: string }] }>();
const today = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
const minDate = () =>
  new Date(Date.parse(today()) - 365 * 86400000).toISOString().slice(0, 10);
const activity = ref("");
const date = ref(props.date <= today() ? props.date : today());
const duration = ref(30);
const timeKnown = ref(false);
const startTime = ref("09:00");
const accuracy = ref<"exact" | "estimated">("estimated");
const note = ref("");
const sending = ref(false);
const error = ref("");
const success = ref("");
const requestId = ref(generateRequestId());
watch(() => props.date, (value) => {
  if (!sending.value) date.value = value <= today() ? value : today();
});
function readMinutes(value: string): number | null {
  if (!/^\d{2}:\d{2}$/.test(value)) return null;
  const [hour, minute] = value.split(":").map(Number);
  return hour < 24 && minute < 60 ? hour * 60 + minute : null;
}
async function save() {
  if (sending.value) return;
  error.value = "";
  success.value = "";
  const start = timeKnown.value ? readMinutes(startTime.value) : undefined;
  if (start === null) { error.value = "เวลาเริ่มไม่ถูกต้อง"; return; }
  if (!activity.value.trim()) { error.value = "กรุณาระบุชื่อกิจกรรม"; return; }
  if (!Number.isInteger(duration.value) || duration.value < 5 || duration.value > 720) {
    error.value = "ระบุระยะเวลา 5–720 นาที"; return;
  }
  if (date.value > today() || date.value < minDate()) {
    error.value = "วันที่ต้องอยู่ภายใน 365 วันที่ผ่านมา"; return;
  }
  sending.value = true;
  try {
    const recorded = await api<{ id: string; date: string; name: string }>(
      "/planner/sessions/backfill", "POST", {
        name: activity.value.trim(), date: date.value, duration: duration.value,
        ...(start === undefined ? {} : { start, accuracy: accuracy.value }),
        ...(note.value.trim() ? { note: note.value.trim() } : {}),
        requestId: requestId.value,
      },
    );
    success.value = "บันทึก " + recorded.name + " เป็นกิจกรรมที่ทำเสร็จย้อนหลังแล้ว";
    activity.value = "";
    note.value = "";
    requestId.value = generateRequestId();
    emit("saved", { id: recorded.id, date: recorded.date });
  } catch (e) {
    error.value = String(e);
  } finally {
    sending.value = false;
  }
}
</script>
<template>
  <details class="past-activity">
    <summary><span aria-hidden="true">↶</span> เพิ่มกิจกรรมที่ทำเสร็จไปแล้ว (ย้อนหลัง)</summary>
    <form @submit.prevent="save">
      <p class="past-hint">
        ถ้าทำงานเสร็จแล้วแต่ลืมลงแผน ให้บันทึกไว้ย้อนหลังได้ ยูนะจะนำไปนับเป็น
        กิจกรรมที่ทำสำเร็จ โดยไม่สร้างงานใหม่ให้รอทำ
      </p>
      <div class="past-fields">
        <label class="full">กิจกรรมที่ทำเสร็จ
          <input v-model="activity" required maxlength="120"
            placeholder="เช่น ฝึก TOEIC / ออกกำลังกาย / ทำความสะอาด"/>
        </label>
        <label>วันที่ทำ
          <input v-model="date" type="date" :min="minDate()" :max="today()" required/>
        </label>
        <label>ใช้เวลากี่นาที
          <input v-model.number="duration" type="number" min="5" max="720" step="1" required/>
        </label>
        <label class="full check">
          <input v-model="timeKnown" type="checkbox"/>
          จำช่วงเวลาที่ทำได้
        </label>
        <template v-if="timeKnown">
          <label>เวลาเริ่ม
            <input v-model="startTime" type="time" required/>
          </label>
          <label>ความแม่นยำของเวลา
            <select v-model="accuracy">
              <option value="exact">จำได้ชัดเจน</option>
              <option value="estimated">เวลาโดยประมาณ</option>
            </select>
          </label>
        </template>
        <label class="full">หมายเหตุ (ไม่บังคับ)
          <textarea v-model="note" rows="2" maxlength="1000"
            placeholder="เช่น ฝึกเสร็จก่อนพักเที่ยง"></textarea>
        </label>
      </div>
      <p class="past-hint" v-if="!timeKnown">
        ไม่ทราบเวลาเริ่ม: ยังนับว่าทำเสร็จและนำไปสรุปจำนวนกิจกรรมได้
        แต่จะไม่ใส่ช่วงเวลาที่เดาเองลงกราฟ 24 ชั่วโมง
      </p>
      <p class="past-hint" v-else-if="accuracy === 'estimated'">
        เวลาประมาณจะใช้แสดงในกราฟ แต่ไม่ถือเป็นการจับเวลาจริงหรือใช้ยืนยันช่วงเวลาประจำ
      </p>
      <p v-if="error" class="past-error" role="alert">{{ error }}</p>
      <p v-if="success" class="past-success" role="status">{{ success }}</p>
      <button type="submit" :disabled="sending">
        {{ sending ? "กำลังบันทึก…" : "บันทึกกิจกรรมย้อนหลังที่เสร็จแล้ว" }}
      </button>
    </form>
  </details>
</template>
<style scoped>
.past-activity { margin: 16px 0; padding: 14px; border: 1px solid #d4dfcf;
  border-radius: 13px; background: #f9fbf7; color: #394c3b; }
.past-activity summary { font-size: 14px; font-weight: 650; cursor: pointer; }
.past-activity summary span { margin-right: 6px; }
.past-activity form { margin-top: 14px; }
.past-hint { font-size: 12px; line-height: 1.55; color: #657563; }
.past-fields { display: grid; grid-template-columns: repeat(2,minmax(0,1fr));
  gap: 11px; margin: 12px 0; }
.past-fields label { font-size: 12px; display: flex; flex-direction: column;
  gap: 5px; min-width: 0; }
.past-fields .full { grid-column: 1 / -1; }
.past-fields .check { flex-direction: row; align-items: center; }
.past-fields input:not([type="checkbox"]), .past-fields select,
.past-fields textarea { box-sizing: border-box; width: 100%; min-width: 0;
  padding: 9px; border: 1px solid #c8d4c6; background: white; color: #293b2e;
  border-radius: 8px; font-size: 14px; }
.past-fields input[type="checkbox"] { width: 17px; height: 17px; }
.past-activity button { padding: 9px 13px; background: #748b6f; color: white;
  border: 0; border-radius: 9px; cursor: pointer; }
.past-activity button:disabled { opacity: 0.6; cursor: wait; }
.past-error { color: #ae3838; font-size: 12px; }
.past-success { color: #367748; font-size: 12px; }
@media (max-width: 480px) { .past-fields { grid-template-columns: 1fr; } }
</style>
