import { ref } from "vue";
export function useVoiceRecorder() {
  const isRecording = ref(false);
  let recorder: MediaRecorder | null = null,
    stream: MediaStream | null = null,
    chunks: Blob[] = [];
  let generation = 0;
  let rejectStop: ((e: unknown) => void) | undefined;
  function cleanup() {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    isRecording.value = false;
  }
  function cancel() {
    generation++;
    rejectStop?.(new DOMException("Cancelled", "AbortError"));
    rejectStop = undefined;
    if (recorder) {
      recorder.onstop = null;
      recorder.ondataavailable = null;
      if (recorder.state !== "inactive") recorder.stop();
      recorder = null;
    }
    chunks = [];
    cleanup();
  }
  async function start() {
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    )
      throw new Error(
        "ไมโครโฟนต้องใช้ localhost หรือ HTTPS และ browser ที่รองรับ MediaRecorder",
      );
    cancel();
    const token = generation;
    try {
      const device = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      if (token !== generation) {
        device.getTracks().forEach((t) => t.stop());
        throw new DOMException("Cancelled", "AbortError");
      }
      stream = device;
      const mimeType = [
        "audio/webm;codecs=opus",
        "audio/ogg;codecs=opus",
        "audio/mp4",
      ].find((t) => MediaRecorder.isTypeSupported(t));
      recorder = new MediaRecorder(device, mimeType ? { mimeType } : undefined);
      chunks = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      recorder.onerror = () => {
        rejectStop?.(new Error("บันทึกเสียงไม่สำเร็จ"));
        cleanup();
      };
      recorder.start(250);
      isRecording.value = true;
    } catch (e) {
      if (token === generation) cleanup();
      throw e;
    }
  }
  function stop(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      if (!recorder || recorder.state === "inactive") {
        cleanup();
        reject(new Error("ไม่มีการบันทึกเสียง"));
        return;
      }
      const current = recorder;
      rejectStop = reject;
      current.onstop = () => {
        const blob = new Blob(chunks, { type: current.mimeType });
        chunks = [];
        recorder = null;
        rejectStop = undefined;
        cleanup();
        if (!blob.size) reject(new Error("ไม่ได้รับเสียงจากไมค์"));
        else if (blob.size > 10 * 1024 * 1024)
          reject(new Error("เสียงเกิน 10 MB"));
        else resolve(blob);
      };
      current.stop();
    });
  }
  return { isRecording, start, stop, cancel };
}
