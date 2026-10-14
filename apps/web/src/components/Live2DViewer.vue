<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from "vue";
import { createViewer, type Live2DViewerHandle } from "../services/live2d-adapter";

const props = defineProps<{
  modelPath: string | null;
  mouthOpen?: number;
  emotion: string;
  expressionMap: Record<string, string> | null;
}>();

const host = ref<HTMLElement>();
const canvas = ref<HTMLCanvasElement>();
const error = ref("");
const status = ref<"empty" | "loading" | "ready" | "error">("empty");
let viewer: Live2DViewerHandle | undefined;
let controller: AbortController | undefined;
let generation = 0;

function stopViewer() {
  controller?.abort();
  controller = undefined;
  viewer?.destroy();
  viewer = undefined;
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
);
watch(
  () => props.mouthOpen,
  (value) => viewer?.setMouthOpen(value ?? 0),
);
onBeforeUnmount(() => {
  generation++;
  stopViewer();
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
