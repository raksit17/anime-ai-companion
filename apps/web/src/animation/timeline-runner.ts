import type { AnimationPlanV1, AnimationSegment } from "@companion/contracts";
export type AnimationPhase = "speech" | "action" | "idle";
export interface TimelineEvent {
  messageId: string; segmentId: string | null; index: number;
  phase: AnimationPhase; revision: number;
}
/** Each new run aborts the preceding run. Audio callbacks must honour the signal. */
export class AnimationTimelineRunner {
  private controller?: AbortController;
  private revision = 0;
  cancel(onUpdate?: (event: TimelineEvent) => void) {
    this.controller?.abort();
    this.controller = undefined;
    ++this.revision;
    onUpdate?.({messageId: "",segmentId:null,index:-1,phase:"idle",revision:this.revision});
  }
  async run(
    plan: AnimationPlanV1,
    handle: (segment: AnimationSegment, signal: AbortSignal) => Promise<void>,
    onUpdate: (event: TimelineEvent) => void,
  ): Promise<void> {
    this.cancel();
    const controller = new AbortController();
    this.controller = controller;
    const revision = this.revision;
    try {
      for (const [index, segment] of plan.segments.entries()) {
        controller.signal.throwIfAborted();
        onUpdate({messageId:plan.messageId,segmentId:segment.id,index,phase:segment.type,revision});
        await handle(segment, controller.signal);
      }
    } finally {
      if (this.controller === controller) {
        this.controller = undefined;
        onUpdate({messageId:plan.messageId,segmentId:null,index:-1,phase:"idle",revision});
      }
    }
  }
}
