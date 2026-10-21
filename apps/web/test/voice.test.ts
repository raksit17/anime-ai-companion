import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useVoice } from "../src/stores/voice";
import { speechChunks } from "../src/services/speech-chunks";
import { assistantDisplayText, parseAssistantSegments, selectBilingualSpeech } from "../src/services/speech-segments";
import { mouthFromSamples } from "../src/composables/useLipSync";
const f = vi.hoisted(() => ({
  chat: {
    busy: false,
    connected: true,
    character: { id: "yuna" },
    conversation: "c",
    messages: [{ role: "assistant", status: "complete", content: "สวัสดี" }],
    sendAndWait: vi.fn(),
    onStream: vi.fn(),
  },
  start: vi.fn(),
  stop: vi.fn(),
  cancel: vi.fn(),
  unlock: vi.fn(),
  play: vi.fn(),
  stopPlayback: vi.fn(),
  transcribe: vi.fn(),
  synthesize: vi.fn(),
  synthesizePcmStream: vi.fn(),
  playPcmStream: vi.fn(),
}));
vi.mock("../src/stores/chat", () => ({ useChat: () => f.chat }));
vi.mock("../src/composables/useVoiceRecorder", () => ({
  useVoiceRecorder: () => ({ start: f.start, stop: f.stop, cancel: f.cancel }),
}));
vi.mock("../src/composables/useVoicePlayback", () => ({
  useVoicePlayback: () => ({
    unlock: f.unlock,
    play: f.play,
    playPcmStream: f.playPcmStream,
    stop: f.stopPlayback,
    dispose: vi.fn(),
    mouthOpen: 0,
  }),
}));
vi.mock("../src/services/voice.api", () => ({
  transcribe: f.transcribe,
  synthesize: f.synthesize,
  synthesizePcmStream: f.synthesizePcmStream,
  voiceHealth: vi.fn(),
}));
let streamListener: ((e: { type: string; requestId: string; delta?: string; content?: string }) => void) | undefined;
beforeEach(() => {
  setActivePinia(createPinia());
  vi.resetAllMocks();
  f.chat.busy = false;
  streamListener = undefined;
  f.chat.onStream.mockImplementation((callback) => { streamListener = callback; return () => {}; });
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
  f.synthesizePcmStream.mockResolvedValue(new ReadableStream());
  f.playPcmStream.mockResolvedValue(undefined);
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
it("sends English TTS language for English-only replies even if Thai is selected", async () => {
  const voice = useVoice();
  voice.ttsLanguage = "th";
  await voice.replay("Okay, Yun is ready. *Pokes your cheek playfully*");
  expect(f.synthesize).toHaveBeenCalledWith(
    expect.stringContaining("Okay, Yun is ready"),
    "en",
    expect.any(AbortSignal),
  );
});
it("sends Thai TTS language for Thai replies even if English is selected", async () => {
  const voice = useVoice();
  voice.ttsLanguage = "en";
  await voice.replay("สวัสดีค่ะ วันนี้เป็นอย่างไรบ้าง");
  expect(f.synthesize).toHaveBeenCalledWith(
    expect.stringContaining("สวัสดีค่ะ"),
    "th",
    expect.any(AbortSignal),
  );
});
it("preserves other explicit TTS languages", async () => {
  const voice = useVoice();
  voice.ttsLanguage = "ja";
  await voice.replay("Hello world");
  expect(f.synthesize).toHaveBeenCalledWith(
    expect.any(String),
    "ja",
    expect.any(AbortSignal),
  );
});
it("long Thai text keeps combining characters and is never truncated", () => {
  const text = "สวัสดีครับ วันนี้เรามาคุยกันเรื่องโปรเจกต์ ".repeat(30);
  const chunks = speechChunks(text);
  expect(chunks.join("")).toBe(text);
  expect(chunks.every((c) => c.length <= 350)).toBe(true);
  expect(chunks.length).toBeGreaterThan(1);
});
it("parses ordered speech and action segments and leaves action text out of display", () => {
  const content = JSON.stringify({
    segments: [
      { type: "speech", text: "กลับมาแล้วเหรอคะ", emotion: "happy" },
      { type: "action", expression: "smile", motion: "wave" },
      { type: "speech", text: "ดีใจจังเลย" },
    ],
  });
  expect(parseAssistantSegments(content, "neutral")).toEqual([
    { type: "speech", text: "กลับมาแล้วเหรอคะ", emotion: "happy" },
    { type: "action", expression: "smile", motion: "wave" },
    { type: "speech", text: "ดีใจจังเลย", emotion: "neutral" },
  ]);
  expect(assistantDisplayText(content)).toBe("กลับมาแล้วเหรอคะ\nดีใจจังเลย");
});
it("RMS mouth output is bounded, silent audio closes the mouth", () => {
  expect(mouthFromSamples(new Float32Array(20))).toBe(0);
  const result = mouthFromSamples(new Float32Array(20).fill(1));
  expect(result).toBeGreaterThan(0);
  expect(result).toBeLessThanOrEqual(1);
});

it("extracts English for Chatterbox when AI uses Thai: rather than Thai translation:", async () => {
  const voice = useVoice();
  voice.ttsLanguage = "en";
  await voice.replay("English:\n*Grins brightly.*\nWelcome back, Yuna!\n\nThai:\n*ยิ้ม*\nกลับมาแล้วนะ");
  expect(f.synthesize).toHaveBeenCalledWith(
    "Welcome back, Yuna!",
    "en",
    expect.any(AbortSignal),
  );
  expect(f.synthesize).toHaveBeenCalledTimes(1);
});
it("selects Thai translation explicitly when the Thai voice is selected", async () => {
  const voice = useVoice();
  voice.ttsLanguage = "th";
  await voice.replay("English:\nHello there!\n\nThai translation:\nสวัสดีนะ");
  expect(f.synthesize).toHaveBeenCalledWith(
    "สวัสดีนะ", "th", expect.any(AbortSignal),
  );
  expect(selectBilingualSpeech("English:\nHi\nThai:\nหวัดดี", "en")?.text).toBe("Hi");
});

it("begins voice synthesis on the first complete AI sentence before chat completion", async () => {
  const voice = useVoice();
  voice.autoSpeak = true;
  voice.ttsLanguage = "en";
  streamListener!({ type: "start", requestId: "request-1" });
  streamListener!({ type: "delta", requestId: "request-1", delta: "English:\n*Smiles.*\nHello there!" });
  await vi.waitFor(() => expect(f.synthesize).toHaveBeenCalledWith(
    "Hello there!", "en", expect.any(AbortSignal), true,
  ));
  expect(f.play).toHaveBeenCalledTimes(1);
  streamListener!({ type: "delta", requestId: "request-1", delta: "\nNext sentence." });
  streamListener!({ type: "complete", requestId: "request-1", content: "" });
  await vi.waitFor(() => expect(f.play).toHaveBeenCalledTimes(2));
  expect(f.synthesize).toHaveBeenCalledTimes(2);
});
it("does not generate streamed voice if Auto Speak is disabled", async () => {
  const voice = useVoice();
  voice.autoSpeak = false;
  streamListener!({ type: "start", requestId: "request-2" });
  streamListener!({ type: "delta", requestId: "request-2", delta: "English:\nHello there!" });
  streamListener!({ type: "complete", requestId: "request-2", content: "" });
  await Promise.resolve();
  expect(f.synthesize).not.toHaveBeenCalled();
});
it("aborts stream speech playback on cancellation", async () => {
  const voice = useVoice();
  voice.autoSpeak = true;
  voice.ttsLanguage = "en";
  streamListener!({ type: "start", requestId: "request-3" });
  streamListener!({ type: "delta", requestId: "request-3", delta: "English:\nHello there!" });
  await vi.waitFor(() => expect(f.synthesize).toHaveBeenCalled());
  streamListener!({ type: "error", requestId: "request-3" });
  expect(voice.state).toBe("idle");
});

it("uses native 48k PCM streaming for Thai if SGLang is ready", async () => {
  const voice = useVoice();
  voice.autoSpeak = true;
  voice.ttsLanguage = "th";
  voice.health = {
    status: "ok", tts_engine: "moss", model_state: "ready",
    tts_languages: ["th", "en"],
    streaming_ready: true, streaming_languages: ["th"],
  };
  streamListener!({ type: "start", requestId: "pcm-1" });
  streamListener!({ type: "delta", requestId: "pcm-1", delta: "English:\nHello!\n\nThai:\nสวัสดีค่ะ!" });
  await vi.waitFor(() => expect(f.synthesizePcmStream).toHaveBeenCalledWith(
    "สวัสดีค่ะ!", "th", expect.any(AbortSignal),
  ));
  await vi.waitFor(() => expect(f.playPcmStream).toHaveBeenCalledTimes(1));
  streamListener!({ type: "complete", requestId: "pcm-1", content: "" });
  await vi.waitFor(() => expect(voice.state).toBe("idle"));
  expect(f.synthesize).not.toHaveBeenCalled();
});
it("retains the original Chatterbox English WAV engine even if Thai PCM streaming is ready", async () => {
  const voice = useVoice();
  voice.autoSpeak = true;
  voice.ttsLanguage = "en";
  voice.health = {
    status: "ok", tts_engine: "moss", model_state: "ready",
    tts_languages: ["th", "en"],
    streaming_ready: true, streaming_languages: ["th"],
  };
  streamListener!({ type: "start", requestId: "wav-en" });
  streamListener!({ type: "delta", requestId: "wav-en", delta: "English:\nWelcome back!" });
  await vi.waitFor(() => expect(f.synthesize).toHaveBeenCalledWith(
    "Welcome back!", "en", expect.any(AbortSignal), true,
  ));
  expect(f.synthesizePcmStream).not.toHaveBeenCalled();
  streamListener!({ type: "complete", requestId: "wav-en", content: "" });
});
it("falls back to MOSS WAV when PCM cannot open before playback", async () => {
  const voice = useVoice();
  voice.autoSpeak = true;
  voice.ttsLanguage = "th";
  voice.health = {
    status: "ok", tts_engine: "moss", model_state: "ready",
    tts_languages: ["th", "en"],
    streaming_ready: true, streaming_languages: ["th"],
  };
  f.synthesizePcmStream.mockRejectedValueOnce(new Error("stream unavailable"));
  streamListener!({ type: "start", requestId: "pcm-fallback" });
  streamListener!({ type: "delta", requestId: "pcm-fallback", delta: "Thai:\nสวัสดีค่ะ!" });
  await vi.waitFor(() => expect(f.synthesize).toHaveBeenCalledWith(
    "สวัสดีค่ะ!", "th", expect.any(AbortSignal), true,
  ));
  await vi.waitFor(() => expect(f.play).toHaveBeenCalledTimes(1));
  expect(f.playPcmStream).not.toHaveBeenCalled();
  streamListener!({ type: "complete", requestId: "pcm-fallback", content: "" });
});
