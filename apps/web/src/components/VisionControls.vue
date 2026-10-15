<script setup lang="ts">
import { ref, onBeforeUnmount } from "vue";
import { base } from "../api";
import { authHeaders } from "../services/auth";
import { useChat } from "../stores/chat";
import { useVoice } from "../stores/voice";

const chat = useChat();
const voice = useVoice();
const question = ref("ในภาพนี้มีอะไรบ้าง?");
const file = ref<File | null>(null);
const status = ref("");
const error = ref("");
const busy = ref(false);
let controller: AbortController | undefined;

function selectFile(event: Event) {
  file.value = (event.target as HTMLInputElement).files?.[0] ?? null;
  error.value = "";
}
async function sendImage(image: File) {
  if (busy.value || voice.active || chat.busy || !chat.connected || !chat.character) return;
  if (!["image/jpeg", "image/png", "image/webp"].includes(image.type) || image.size > 4 * 1024 * 1024) {
    error.value = "รองรับเฉพาะ JPEG, PNG, WebP ที่ไม่เกิน 4 MB";
    return;
  }
  busy.value = true;
  error.value = "";
  status.value = "กำลังดูภาพ…";
  controller = new AbortController();
  try {
    const form = new FormData();
    form.append("file", image);
    form.append("question", question.value.trim().slice(0, 500));
    const response = await fetch(base + "/v1/vision/analyze", {
      method: "POST",
      headers: authHeaders(),
      body: form,
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(90000)]),
    });
    const result = await response.json() as { description?: string; message?: string | { message?: string } };
    if (!response.ok) throw new Error(typeof result.message === "string" ? result.message : result.message?.message ?? "วิเคราะห์ภาพไม่สำเร็จ");
    if (!result.description) throw new Error("Vision model ไม่ส่งผลลัพธ์");
    // Raw image is not saved. Chat saves only the generated observation as text.
    const message = `ฉันส่งรูปมาให้ดู คำถาม: ${question.value.trim().slice(0, 500) || "มีอะไรในภาพ"}\nผลวิเคราะห์ภาพจาก AI (อาจไม่ถูกต้อง): ${result.description.slice(0, 2800)}\nช่วยตอบกลับในบุคลิกของเธอโดยอิงสิ่งที่เห็น ห้ามสมมติสิ่งที่ไม่ปรากฏในภาพ`;
    status.value = "กำลังส่งสิ่งที่เห็นให้ตัวละคร…";
    await chat.send(message.slice(0, 4000));
    file.value = null;
    status.value = "";
  } catch (e) {
    if (!controller.signal.aborted)
      error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
    controller = undefined;
  }
}
async function capture() {
  if (busy.value || chat.busy || voice.active || !chat.connected) return;
  busy.value = true;
  error.value = "";
  status.value = "กำลังขอสิทธิ์กล้อง…";
  let stream: MediaStream | undefined;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("เปิดกล้องไม่ได้"));
    });
    await video.play();
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("ไม่สามารถอ่านภาพจากกล้อง");
    context.drawImage(video, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(value => value ? resolve(value) : reject(new Error("แปลงภาพไม่ได้")), "image/jpeg", 0.78));
    const snapshot = new File([blob], "camera.jpg", { type: "image/jpeg" });
    busy.value = false;
    // Stop video tracks immediately after one explicit snapshot.
    stream?.getTracks().forEach(track => track.stop());
    stream = undefined;
    await sendImage(snapshot);
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    stream?.getTracks().forEach(track => track.stop());
    busy.value = false;
    status.value = "";
  }
}
onBeforeUnmount(() => controller?.abort());
</script>

<template>
  <section class="vision-controls" aria-label="มองเห็นภาพ">
    <div class="vision-heading"><strong>◉ Vision / มองเห็น</strong><small>ส่งภาพด้วยตัวเองเท่านั้น</small></div>
    <div class="vision-row">
      <input aria-label="เลือกภาพ" type="file" accept="image/jpeg,image/png,image/webp" :disabled="busy || chat.busy || voice.active" @change="selectFile" />
      <button type="button" :disabled="busy || chat.busy || voice.active || !chat.connected" @click="capture">📷 ถ่าย 1 ภาพ</button>
    </div>
    <div class="vision-row">
      <input v-model="question" aria-label="ถามเกี่ยวกับภาพ" maxlength="500" placeholder="อยากให้ตัวละครดูอะไร?" :disabled="busy" />
      <button type="button" :disabled="busy || chat.busy || voice.active || !chat.connected || !file" @click="file && sendImage(file)">👁 ดูภาพและตอบ</button>
      <button v-if="busy && controller" type="button" @click="controller?.abort()">หยุด</button>
    </div>
    <small v-if="status" aria-live="polite">{{ status }}</small>
    <small v-if="error" class="error" role="alert">{{ error }}</small>
  </section>
</template>

<style scoped>
.vision-controls { padding: 9px 13px; border-top: 1px solid rgba(128,128,128,.2); }
.vision-heading, .vision-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: space-between; }
.vision-heading { margin-bottom: 5px; }
.vision-heading small { opacity: .68; }
.vision-row { margin-top: 5px; }
.vision-row input[type="file"] { max-width: 220px; font-size: 12px; }
.vision-row input:not([type="file"]) { flex: 1; min-width: 130px; }
.vision-row button { white-space: nowrap; }
</style>
