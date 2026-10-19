<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from "vue";
import { createViewer, type Live2DViewerHandle } from "../services/live2d-adapter";

const props = defineProps<{
  modelPath: string | null;
  mouthOpen?: number;
  motion?: { group:string;index:number;revision:number } | null;
  emotion: string;
  expressionMap: Record<string, string> | null;
  motionMap: MotionMap | null;
  interactionState: string;
}>();

const host = ref<HTMLElement>();
const canvas = ref<HTMLCanvasElement>();
const error = ref("");
const status = ref<"empty" | "loading" | "ready" | "error">("empty");
let viewer: Live2DViewerHandle | undefined;
let controller: AbortController | undefined;
let generation = 0;
let mouthTestTimer: ReturnType<typeof setTimeout> | undefined;
const availableMotions = ref<Record<string, number>>({});
const selectedMotion = ref("TapBody");
const selectedIndex = ref(0);
const testingMouth = ref(false);
function testMouth() {
  if (!viewer) return;
  if (mouthTestTimer) clearTimeout(mouthTestTimer);
  testingMouth.value = true;
  viewer.setMouthOpen(1);
  mouthTestTimer = setTimeout(() => {
    testingMouth.value = false;
    viewer?.setMouthOpen(props.mouthOpen ?? 0);
  }, 1500);
}
async function previewMotion() {
  try { await viewer?.playMotion(selectedMotion.value, selectedIndex.value); }
  catch (cause) { error.value = String(cause); }
}

async function applyAction(action: { expression?: string; motion?: string }) {
  if (viewer) await viewer.action(action.expression, action.motion);
}
defineExpose({ applyAction });

function stopViewer() {
  if (mouthTestTimer) clearTimeout(mouthTestTimer);
  testingMouth.value = false;
  availableMotions.value = {};
  controller?.abort();
  controller = undefined;
  viewer?.destroy();
  viewer = undefined;

let textMouthFrame = 0;
function animateTextMouth(time: number) {
  if (props.interactionState !== "responding") return;
  // Text replies have no audio waveform, so use a restrained speaking animation.
  viewer?.setMouthOpen(0.12 + 0.34 * (0.5 + 0.5 * Math.sin(time / 105)));
  textMouthFrame = requestAnimationFrame(animateTextMouth);
}
function syncInteractionState() {
  cancelAnimationFrame(textMouthFrame);
  if (props.interactionState === "responding") {
    textMouthFrame = requestAnimationFrame(animateTextMouth);
    return;
  }
  viewer?.setMouthOpen(props.mouthOpen ?? 0);
  const motion = props.motionMap?.[props.interactionState];
  if (motion) void viewer?.playMotion(motion).catch(() => {});
}
async function applyEmotion() {
  try {
    await viewer?.setEmotion(
      props.emotion,
      props.expressionMap ?? {},
      props.motionMap ?? {},
    );
  } catch (e) {
    error.value =
      e instanceof Error ? e.message : "ใช้ Expression ที่กำหนดไม่ได้";
  }

}
watch(
  () => [props.modelPath, canvas.value, host.value],
  async () => {
    const token = ++generation;
    stopViewer();
    error.value = "";
    status.value = "empty";
    if (!props.modelPath || !canvas.value || !host.value) return;

    status.value = "loading";
    const active = new AbortController();
    controller = active;
    try {
      const next = await createViewer(
        canvas.value,
        host.value,
        props.modelPath,
        active.signal,
        (cause) => {
          if (token === generation) {
            error.value = cause.message;
            status.value = "error";
          }
        },
      );
      if (token !== generation || active.signal.aborted) {
        next.destroy();
        return;
      }
      viewer = next;
      availableMotions.value = next.inspectMotions();
      await next.emotion(props.emotion, props.expressionMap ?? {});
      next.setMouthOpen(props.mouthOpen ?? 0);
      if (!error.value) status.value = "ready";
    } catch (cause) {
      if (token === generation && !active.signal.aborted) {
        error.value = cause instanceof Error ? cause.message : String(cause);
        status.value = "error";
        console.error("[Live2D] Load failed", cause);
      }
    }
  },
  { immediate: true, flush: "post" },
);
watch(

  () => [props.emotion, props.expressionMap],
  () => {
    void viewer?.emotion(props.emotion, props.expressionMap ?? {}).catch((cause) => {
      error.value = cause instanceof Error ? cause.message : String(cause);
      status.value = "error";
    });
  },

  () => [props.emotion, props.expressionMap, props.motionMap],
  () => void applyEmotion(),
);
watch(
  () => props.motion,
  value => { if (value) void viewer?.playMotion(value.group,value.index).catch(cause => { error.value = String(cause); }); },
);
watch(
  () => props.mouthOpen,
  (value) => { if (!testingMouth.value) viewer?.setMouthOpen(value ?? 0); },
);
onBeforeUnmount(() => {
  generation++;
  stopViewer();
});
</script>

<template>
  <div ref="host" class="live-stage" :data-live2d-status="status">
    <canvas ref="canvas" :class="{ 'canvas-hidden': status !== 'ready' }" />
    <div v-if="status === 'ready'" class="live2d-debug" style="position:absolute;bottom:8px;left:8px;z-index:10;display:flex;gap:4px;align-items:center;flex-wrap:wrap;background:#ffffffd9;padding:4px;border-radius:6px">
      <button type="button" @click="testMouth">ทดสอบปาก 1.5s</button>
      <select v-model="selectedMotion" aria-label="Motion group">
        <option v-for="(_, key) in availableMotions" :key="key" :value="key">{{ key }}</option>
      </select>
      <input v-model.number="selectedIndex" type="number" min="0" :max="Math.max(0,(availableMotions[selectedMotion] ?? 1)-1)" style="width:46px" aria-label="Motion index" />
      <button type="button" @click="previewMotion">ทดสอบ Motion</button>
      <small>เสียงจริงเท่านั้นจึงทำ Lip Sync อัตโนมัติ</small>
    </div>
    <div v-if="status !== 'ready'" class="placeholder" role="status">
      <div class="orb">✦</div>
      <h2>{{ status === "loading" ? "กำลังโหลด Live2D…" : status === "error" ? "โหลด Live2D ไม่สำเร็จ" : "พื้นที่ตัวละครของคุณ" }}</h2>
      <p>{{ error || (status === "loading" ? "กำลังเตรียม Core, Shader และโมเดล…" : "ตั้งค่า Live2D model path ให้ตัวละครก่อน") }}</p>
      <span class="pill">{{ status === "loading" ? "LOADING" : status === "error" ? "LIVE2D · ERROR" : "LIVE2D · ASSET REQUIRED" }}</span>
    </div>
  </div>
</template>
