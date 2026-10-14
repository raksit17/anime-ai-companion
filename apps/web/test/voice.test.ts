import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useVoice } from "../src/stores/voice";
import { speechChunks } from "../src/services/speech-chunks";
import { mouthFromSamples } from "../src/composables/useLipSync";
const f = vi.hoisted(() => ({
  chat: {
    busy: false,
    connected: true,
    character: { id: "yuna" },
    conversation: "c",
    messages: [{ role: "assistant", status: "complete", content: "สวัสดี" }],
    sendAndWait: vi.fn(),
  },
  start: vi.fn(),
  stop: vi.fn(),
  cancel: vi.fn(),
  unlock: vi.fn(),
  play: vi.fn(),
  stopPlayback: vi.fn(),
  transcribe: vi.fn(),
  synthesize: vi.fn(),
}));
vi.mock("../src/stores/chat", () => ({ useChat: () => f.chat }));
vi.mock("../src/composables/useVoiceRecorder", () => ({
  useVoiceRecorder: () => ({ start: f.start, stop: f.stop, cancel: f.cancel }),
}));
vi.mock("../src/composables/useVoicePlayback", () => ({
  useVoicePlayback: () => ({
    unlock: f.unlock,
    play: f.play,
    stop: f.stopPlayback,
    dispose: vi.fn(),
    mouthOpen: 0,
  }),
}));
vi.mock("../src/services/voice.api", () => ({
  transcribe: f.transcribe,
  synthesize: f.synthesize,
  voiceHealth: vi.fn(),
}));
beforeEach(() => {
  setActivePinia(createPinia());
  vi.resetAllMocks();
  f.chat.busy = false;
  f.start.mockResolvedValue(undefined);
  f.stop.mockResolvedValue(new Blob(["voice"]));
  f.unlock.mockResolvedValue(undefined);
  f.transcribe.mockResolvedValue({
    text: "เหนื่อยจัง",
    language: "th",
    duration: 1,
  });
  f.chat.sendAndWait.mockResolvedValue({ content: "พักสักหน่อยนะ" });
  f.synthesize.mockResolvedValue(new Blob(["wav"]));
  f.play.mockResolvedValue(undefined);
});
it("voice pipeline transcribes, uses the existing chat, then plays once", async () => {
  const voice = useVoice();
  await voice.start();
  expect(voice.state).toBe("listening");
  await voice.finish();
  expect(voice.state).toBe("idle");
  expect(f.chat.sendAndWait).toHaveBeenCalledWith(
    "เหนื่อยจัง",
    expect.any(AbortSignal),
  );
  expect(f.play).toHaveBeenCalledTimes(1);
});
it("late STT after cancellation never sends a chat or plays audio", async () => {
  let resolve!: (value: any) => void;
  f.transcribe.mockImplementation(() => new Promise((r) => (resolve = r)));
  const voice = useVoice();
  await voice.start();
  const finish = voice.finish();
  await vi.waitFor(() => expect(f.transcribe).toHaveBeenCalled());
  voice.cancel();
  resolve({ text: "late" });
  await finish;
  expect(voice.state).toBe("cancelled");
  expect(f.chat.sendAndWait).not.toHaveBeenCalled();
  expect(f.play).not.toHaveBeenCalled();
});
it("late chat answer after Stop never reaches TTS", async () => {
  let resolve!: (value: any) => void;
  f.chat.sendAndWait.mockImplementation(
    () => new Promise((r) => (resolve = r)),
  );
  const voice = useVoice();
  await voice.start();
  const finish = voice.finish();
  await vi.waitFor(() => expect(f.chat.sendAndWait).toHaveBeenCalled());
  voice.cancel();
  resolve({ content: "late answer" });
  await finish;
  expect(f.synthesize).not.toHaveBeenCalled();
  expect(voice.state).toBe("cancelled");
});
it("empty transcript fails without sending an empty message", async () => {
  f.transcribe.mockResolvedValue({ text: " " });
  const voice = useVoice();
  await voice.start();
  await voice.finish();
  expect(voice.state).toBe("error");
  expect(f.chat.sendAndWait).not.toHaveBeenCalled();
});
it("double click does not start two recorders", async () => {
  const voice = useVoice();
  await Promise.all([voice.start(), voice.start()]);
  expect(f.start).toHaveBeenCalledTimes(1);
  voice.cancel();
});
it("long Thai text keeps combining characters and is never truncated", () => {
  const text = "สวัสดีครับ วันนี้เรามาคุยกันเรื่องโปรเจกต์ ".repeat(30);
  const chunks = speechChunks(text);
  expect(chunks.join("")).toBe(text);
  expect(chunks.every((c) => c.length <= 350)).toBe(true);
  expect(chunks.length).toBeGreaterThan(1);
});
it("RMS mouth output is bounded, silent audio closes the mouth", () => {
  expect(mouthFromSamples(new Float32Array(20))).toBe(0);
  const result = mouthFromSamples(new Float32Array(20).fill(1));
  expect(result).toBeGreaterThan(0);
  expect(result).toBeLessThanOrEqual(1);
});
