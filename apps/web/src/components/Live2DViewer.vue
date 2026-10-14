<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from "vue";
import { createViewer } from "../services/live2d-adapter";
const props = defineProps<{
  modelPath: string | null;
  mouthOpen?: number;
  emotion: string;
  expressionMap: Record<string, string> | null;
}>();
const host = ref<HTMLElement>(),
  canvas = ref<HTMLCanvasElement>(),
  error = ref(""),
  loading = ref(false);
let viewer: Awaited<ReturnType<typeof createViewer>> | undefined;
let generation = 0;
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
      await v.emotion(props.emotion, props.expressionMap ?? {});
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
  () => props.emotion,
  () => {
    viewer?.emotion(props.emotion, props.expressionMap ?? {}).catch(() => {
      error.value = "ไม่พบ Expression ที่กำหนด ตรวจชื่อใน model3.json";
    });
  },
);
watch(
  () => props.mouthOpen,
  (value) => viewer?.setMouthOpen(value ?? 0),
);
onBeforeUnmount(() => {
  generation++;
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
