import { defineStore } from "pinia";
import { ref } from "vue";
import type { AnimationPlanV1, AnimationSegment, Emotion } from "@companion/contracts";
import { AnimationTimelineRunner, type TimelineEvent } from "../animation/timeline-runner";

export const useAnimation = defineStore("animation", () => {
  const timeline = ref<TimelineEvent>({messageId:"",segmentId:null,index:-1,phase:"idle",revision:0});
  const emotion = ref<Emotion>("neutral");
  const motion = ref<{group:string;index:number;revision:number}|null>(null);
  const runner = new AnimationTimelineRunner();
  function cancel() {
    runner.cancel(v => timeline.value = v);
    motion.value = null;
  }
  async function play(plan: AnimationPlanV1, speak?: (text:string,signal:AbortSignal)=>Promise<void>) {
    await runner.run(plan, async (segment: AnimationSegment, signal) => {
      if (segment.emotion) emotion.value = segment.emotion;
      if (segment.type === "speech") {
        if (speak) await speak(segment.text, signal);
      } else {
        // Unverified semantic actions never select an unrelated motion.
        motion.value = null;
        if (!speak) await new Promise<void>(resolve => {
          const timer = setTimeout(resolve, Math.min(1500, Math.max(0, segment.durationMs ?? 350)));
          signal.addEventListener("abort", () => {clearTimeout(timer);resolve();}, {once:true});
        });
      }
    }, event => timeline.value = event);
  }
  return {timeline,emotion,motion,play,cancel};
});
