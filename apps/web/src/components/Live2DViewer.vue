<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from "vue";
<<<<<<< HEAD
import { createViewer, type Live2DViewerHandle } from "../services/live2d-adapter";

=======
import type { MotionMap } from "@companion/contracts";
import { createViewer } from "../services/live2d-adapter";
>>>>>>> origin/feature/emotional-live2d-chat
const props = defineProps<{
  modelPath: string | null;
  mouthOpen?: number;
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
<<<<<<< HEAD

function stopViewer() {
  controller?.abort();
  controller = undefined;
  viewer?.destroy();
  viewer = undefined;
=======
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
>>>>>>> origin/feature/emotional-live2d-chat
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
<<<<<<< HEAD
      viewer = next;
      await next.emotion(props.emotion, props.expressionMap ?? {});
      next.setMouthOpen(props.mouthOpen ?? 0);
      if (!error.value) status.value = "ready";
    } catch (cause) {
      if (token === generation && !active.signal.aborted) {
        error.value = cause instanceof Error ? cause.message : String(cause);
        status.value = "error";
        console.error("[Live2D] Load failed", cause);
      }
=======
      viewer = v;
      await applyEmotion();
      syncInteractionState();
    } catch (e) {
      if (token === generation)
        error.value = e instanceof Error ? e.message : "โหลดโมเดลไม่ได้";
    } finally {
      if (token === generation) loading.value = false;
>>>>>>> origin/feature/emotional-live2d-chat
    }
  },
  { immediate: true, flush: "post" },
);
watch(
<<<<<<< HEAD
  () => [props.emotion, props.expressionMap],
  () => {
    void viewer?.emotion(props.emotion, props.expressionMap ?? {}).catch((cause) => {
      error.value = cause instanceof Error ? cause.message : String(cause);
      status.value = "error";
    });
  },
=======
  () => [props.emotion, props.expressionMap, props.motionMap],
  () => void applyEmotion(),
);
watch(
  () => props.interactionState,
  () => syncInteractionState(),
>>>>>>> origin/feature/emotional-live2d-chat
);
watch(
  () => props.mouthOpen,
  (value) => {
    if (props.interactionState !== "responding")
      viewer?.setMouthOpen(value ?? 0);
  },
);
onBeforeUnmount(() => {
  generation++;
<<<<<<< HEAD
  stopViewer();
=======
  cancelAnimationFrame(textMouthFrame);
  viewer?.destroy();
>>>>>>> origin/feature/emotional-live2d-chat
});
</script>

<template>
  <div ref="host" class="live-stage" :data-live2d-status="status">
    <canvas ref="canvas" :class="{ 'canvas-hidden': status !== 'ready' }" />
    <div v-if="status !== 'ready'" class="placeholder" role="status">
      <div class="orb">✦</div>
      <h2>{{ status === "loading" ? "กำลังโหลด Live2D…" : status === "error" ? "โหลด Live2D ไม่สำเร็จ" : "พื้นที่ตัวละครของคุณ" }}</h2>
      <p>{{ error || (status === "loading" ? "กำลังเตรียม Core, Shader และโมเดล…" : "ตั้งค่า Live2D model path ให้ตัวละครก่อน") }}</p>
      <span class="pill">{{ status === "loading" ? "LOADING" : status === "error" ? "LIVE2D · ERROR" : "LIVE2D · ASSET REQUIRED" }}</span>
    </div>
  </div>
</template>
