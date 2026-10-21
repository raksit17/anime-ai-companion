import { ref } from "vue";
import { mouthFromSamples } from "./useLipSync";
export function useVoicePlayback() {
  const mouthOpen = ref(0);
  let context: AudioContext | undefined,
    source: AudioBufferSourceNode | undefined,
    analyser: AnalyserNode | undefined,
    frame = 0;
  let rejectCurrent: ((e: unknown) => void) | undefined;
  const streamNodes = new Set<AudioBufferSourceNode>();
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
    for (const node of streamNodes) {
      node.onended = null;
      try { node.stop(); } catch {}
      node.disconnect();
    }
    streamNodes.clear();
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
  /**
   * SGLang/MOSS native stream: signed little-endian 16-bit mono PCM at 48kHz.
   * Schedule short AudioBuffers on one AudioContext while bytes are still arriving.
   */
  async function playPcmStream(stream: ReadableStream<Uint8Array>, signal: AbortSignal, sampleRate = 48000) {
    signal.throwIfAborted();
    if (![24000, 48000].includes(sampleRate)) throw new Error("Unsupported PCM sample rate");
    await unlock();
    stop();
    signal.throwIfAborted();

    const ctx = context!;
    const meter = ctx.createAnalyser();
    meter.fftSize = 2048;
    analyser = meter;
    meter.connect(ctx.destination);
    const samples = new Float32Array(meter.fftSize);
    const reader = stream.getReader();
    let nextStart = ctx.currentTime + 0.1;
    let pending = new Uint8Array(0);
    let ended = false;
    let settled = false;
    let doneResolve!: () => void;
    let doneReject!: (error: unknown) => void;
    const finished = new Promise<void>((resolve, reject) => {
      doneResolve = resolve;
      doneReject = reject;
    });
    // Awaited below in all paths, including failures.
    void finished.catch(() => {});
    function finishIfReady() {
      if (ended && streamNodes.size === 0 && !settled) {
        settled = true;
        doneResolve();
      }
    }
    const abort = () => {
      void reader.cancel().catch(() => undefined);
      stop();
      if (!settled) {
        settled = true;
        doneReject(signal.reason ?? new DOMException("Cancelled", "AbortError"));
      }
    };
    rejectCurrent = (error) => {
      if (!settled) {
        settled = true;
        doneReject(error);
      }
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();

    const tick = () => {
      if (analyser !== meter) return;
      meter.getFloatTimeDomainData(samples);
      mouthOpen.value = mouthFromSamples(samples, mouthOpen.value);
      frame = requestAnimationFrame(tick);
    };
    tick();

    function schedule(bytes: Uint8Array) {
      if (bytes.byteLength % 2) throw new Error("Incomplete PCM sample");
      const samplesCount = bytes.byteLength / 2;
      if (!samplesCount) return;
      const audio = ctx.createBuffer(1, samplesCount, sampleRate);
      const channel = audio.getChannelData(0);
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      for (let i = 0; i < samplesCount; i++) channel[i] = view.getInt16(i * 2, true) / 32768;
      const node = ctx.createBufferSource();
      node.buffer = audio;
      streamNodes.add(node);
      node.connect(meter);
      node.onended = () => {
        streamNodes.delete(node);
        node.disconnect();
        finishIfReady();
      };
      nextStart = Math.max(nextStart, ctx.currentTime + 0.06);
      node.start(nextStart);
      nextStart += audio.duration;
    }

    try {
      // 4096 samples ~= 85ms of audio, enough to avoid per-packet scheduling.
      const blockBytes = 8192;
      while (true) {
        signal.throwIfAborted();
        const { value, done } = await reader.read();
        if (done) break;
        if (!value?.byteLength) continue;
        if (value.byteLength > 8 * 1024 * 1024) {
          throw new Error("MOSS PCM packet too large");
        }
        const joined = new Uint8Array(pending.byteLength + value.byteLength);
        joined.set(pending);
        joined.set(value, pending.byteLength);
        const usable = Math.floor(joined.byteLength / blockBytes) * blockBytes;
        for (let offset = 0; offset < usable; offset += blockBytes) {
          schedule(joined.subarray(offset, offset + blockBytes));
        }
        pending = joined.slice(usable);
      }
      if (pending.byteLength % 2) throw new Error("MOSS returned a truncated PCM sample");
      if (pending.byteLength) schedule(pending);
      ended = true;
      finishIfReady();
      await finished;
    } catch (error) {
      if (!settled) {
        settled = true;
        doneReject(error);
      }
      stop();
      throw error;
    } finally {
      signal.removeEventListener("abort", abort);
      void reader.cancel().catch(() => undefined);
      if (analyser === meter) {
        cancelAnimationFrame(frame);
        meter.disconnect();
        analyser = undefined;
        mouthOpen.value = 0;
        rejectCurrent = undefined;
      }
    }
  }

  async function dispose() {
    stop();
    await context?.close();
    context = undefined;
  }
  return { mouthOpen, unlock, play, playPcmStream, stop, dispose };
}
