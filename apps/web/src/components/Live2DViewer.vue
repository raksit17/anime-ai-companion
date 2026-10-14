<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from "vue";
import type { MotionMap } from "@companion/contracts";
import { createViewer } from "../services/live2d-adapter";
const props = defineProps<{
  modelPath: string | null;
  mouthOpen?: number;
  emotion: string;
  expressionMap: Record<string, string> | null;
  motionMap: MotionMap | null;
  interactionState: string;
}>();
const host = ref<HTMLElement>(),
  canvas = ref<HTMLCanvasElement>(),
  error = ref(""),
  loading = ref(false);
let viewer: Awaited<ReturnType<typeof createViewer>> | undefined;
let generation = 0;
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
  () => [props.modelPath, canvas.value],
  async () => {
    const token = ++generation;
    viewer?.destroy();
    viewer = undefined;
    error.value = "";
    loading.value = false;
    if (!props.modelPath || !canvas.value || !host.value) return;
    loading.value = true;
    try {
      const v = await createViewer(canvas.value, host.value, props.modelPath);
      if (token !== generation) {
        v.destroy();
        return;
      }
      viewer = v;
      await applyEmotion();
      syncInteractionState();
    } catch (e) {
      if (token === generation)
        error.value = e instanceof Error ? e.message : "โหลดโมเดลไม่ได้";
    } finally {
      if (token === generation) loading.value = false;
    }
  },
  { flush: "post" },
);
watch(
  () => [props.emotion, props.expressionMap, props.motionMap],
  () => void applyEmotion(),
);
watch(
  () => props.interactionState,
  () => syncInteractionState(),
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
  cancelAnimationFrame(textMouthFrame);
  viewer?.destroy();
});
</script>
<template>
  <div ref="host" class="live-stage">
    <canvas ref="canvas" :class="{ 'canvas-hidden': !modelPath || error }" />
    <div v-if="!modelPath || error || loading" class="placeholder">
      <div class="orb">✦</div>
      <h2>
        {{
          loading
            ? "กำลังโหลดโมเดล…"
            : error
              ? "โหลด Live2D ไม่สำเร็จ"
              : "พื้นที่ตัวละครของคุณ"
        }}
      </h2>
      <p>
        {{
          error ||
          "เพิ่มโมเดล Live2D ในการตั้งค่าตัวละคร — คุณเริ่มแชตได้ทันทีเมื่อ Ollama พร้อม"
        }}
      </p>
      <span class="pill">{{
        loading ? "LOADING" : "LIVE2D · ASSET REQUIRED"
      }}</span>
    </div>
  </div>
</template>
