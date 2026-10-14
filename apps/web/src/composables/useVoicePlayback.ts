import { ref } from "vue";
import { mouthFromSamples } from "./useLipSync";
export function useVoicePlayback() {
  const mouthOpen = ref(0);
  let context: AudioContext | undefined,
    source: AudioBufferSourceNode | undefined,
    analyser: AnalyserNode | undefined,
    frame = 0;
  let rejectCurrent: ((e: unknown) => void) | undefined;
  // Call from a click before waiting for network to satisfy browser activation policy.
  async function unlock() {
    context ??= new AudioContext();
    await context.resume();
    if (context.state !== "running")
      throw new Error("Browser ปิดเสียงอัตโนมัติ กดอ่านคำตอบอีกครั้ง");
  }
  function stop() {
    cancelAnimationFrame(frame);
    mouthOpen.value = 0;
    const old = source;
    source = undefined;
    if (old) {
      old.onended = null;
      try {
        old.stop();
      } catch {}
      old.disconnect();
    }
    analyser?.disconnect();
    analyser = undefined;
    rejectCurrent?.(new DOMException("Cancelled", "AbortError"));
    rejectCurrent = undefined;
  }
  async function play(blob: Blob, signal: AbortSignal) {
    signal.throwIfAborted();
    await unlock();
    signal.throwIfAborted();
    const data = await blob.arrayBuffer();
    const buffer = await context!.decodeAudioData(data);
    signal.throwIfAborted();
    stop();
    await new Promise<void>((resolve, reject) => {
      const node = context!.createBufferSource();
      source = node;
      node.buffer = buffer;
      const meter = context!.createAnalyser();
      analyser = meter;
      meter.fftSize = 2048;
      const samples = new Float32Array(meter.fftSize);
      node.connect(meter);
      meter.connect(context!.destination);
      const clean = () => {
        signal.removeEventListener("abort", abort);
        cancelAnimationFrame(frame);
        mouthOpen.value = 0;
        node.disconnect();
        meter.disconnect();
        if (source === node) source = undefined;
        analyser = undefined;
        rejectCurrent = undefined;
      };
      const abort = () => {
        node.onended = null;
        try {
          node.stop();
        } catch {}
        clean();
        reject(signal.reason ?? new DOMException("Cancelled", "AbortError"));
      };
      rejectCurrent = (e) => {
        clean();
        reject(e);
      };
      node.onended = () => {
        clean();
        resolve();
      };
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) {
        abort();
        return;
      }
      const tick = () => {
        meter.getFloatTimeDomainData(samples);
        mouthOpen.value = mouthFromSamples(samples, mouthOpen.value);
        frame = requestAnimationFrame(tick);
      };
      try {
        node.start();
        tick();
      } catch (e) {
        clean();
        reject(e);
      }
    });
  }
  async function dispose() {
    stop();
    await context?.close();
    context = undefined;
  }
  return { mouthOpen, unlock, play, stop, dispose };
}
