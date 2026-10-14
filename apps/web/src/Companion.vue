<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  action,
  invoke,
  listen,
  type Envelope,
  type Snapshot,
} from "./desktop";
import Live2DViewer from "./components/Live2DViewer.vue";
const data = ref<Snapshot>({
  name: "Komorebi",
  modelPath: null,
  expressionMap: null,
  motionMap: null,
  interactionState: "idle",
  emotion: "neutral",
  mouthOpen: 0,
  voiceState: "idle",
  connected: false,
  busy: false,
});
const error = ref("");
const interactionLabels: Record<string, string> = {
  idle: "พร้อมอยู่เป็นเพื่อน",
  listening: "กำลังฟัง",
  thinking: "กำลังคิดคำตอบ",
  responding: "กำลังตอบคุณ",
  speaking: "กำลังพูด",
};
let revision = -1;
let off: (() => void) | undefined;
function apply(e: Envelope) {
  if (e.revision > revision) {
    revision = e.revision;
    data.value = e.snapshot;
  }
}
async function run(name: string) {
  try {
    await action(name);
  } catch (e) {
    error.value = String(e);
  }
}
onMounted(async () => {
  try {
    off = await listen<Envelope>("desktop:snapshot", (e) => apply(e.payload));
    apply(await invoke<Envelope>("get_snapshot"));
  } catch (e) {
    error.value = String(e);
  }
});
onBeforeUnmount(() => off?.());
</script>
<template>
  <main class="desktop-companion">
    <div
      class="companion-drag"
      @pointerdown="
        getCurrentWindow()
          .startDragging()
          .catch((e) => (error = String(e)))
      "
    >
      ✦ {{ data.name || "Komorebi" }} · ลากเพื่อย้าย
    </div>
    <Live2DViewer
      :model-path="data.modelPath"
      :expression-map="data.expressionMap"
      :motion-map="data.motionMap"
      :interaction-state="data.interactionState"
      :emotion="data.emotion || 'neutral'"
      :mouth-open="data.mouthOpen"
    />
    <footer class="companion-controls">
      <small>{{
        data.connected
          ? interactionLabels[data.interactionState] || data.voiceState
          : "เปิดแชตเพื่อตั้งค่าการเชื่อมต่อ"
      }}</small>
      <div>
        <button @click="run('chat')">เปิดแชต / เสียง</button
        ><button
          title="กด Ctrl+Alt+Y เพื่อกลับมาคลิกได้"
          @click="run('click-through')"
        >
          คลิกทะลุ</button
        ><button @click="run('hide')">ซ่อน</button>
      </div>
      <small>Ctrl+Alt+Y เรียกกลับ · Ctrl+Alt+M แชต</small>
      <p v-if="error" role="alert">{{ error }}</p>
    </footer>
  </main>
</template>
