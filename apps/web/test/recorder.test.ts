import { expect, it, vi } from "vitest";
import { useVoiceRecorder } from "../src/composables/useVoiceRecorder";
it("cancel while permission prompt is open stops a late granted microphone", async () => {
  let grant!: (value: any) => void;
  const stop = vi.fn();
  vi.stubGlobal("navigator", {
    mediaDevices: { getUserMedia: () => new Promise((r) => (grant = r)) },
  });
  vi.stubGlobal("MediaRecorder", class {});
  const recorder = useVoiceRecorder();
  const pending = recorder.start();
  recorder.cancel();
  grant({ getTracks: () => [{ stop }] });
  await expect(pending).rejects.toHaveProperty("name", "AbortError");
  expect(stop).toHaveBeenCalledTimes(1);
  expect(recorder.isRecording.value).toBe(false);
  vi.unstubAllGlobals();
});
