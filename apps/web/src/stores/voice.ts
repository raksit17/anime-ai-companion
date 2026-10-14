import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";
import { useChat } from "./chat";
import { useVoiceRecorder } from "../composables/useVoiceRecorder";
import { useVoicePlayback } from "../composables/useVoicePlayback";
import {
  transcribe,
  synthesize,
  voiceHealth,
  type VoiceHealth,
} from "../services/voice.api";
import { speechChunks } from "../services/speech-chunks";
export type VoiceState =
  | "idle"
  | "requesting"
  | "listening"
  | "transcribing"
  | "thinking"
  | "synthesizing"
  | "speaking"
  | "cancelled"
  | "error";
export const useVoice = defineStore("voice", () => {
  const chat = useChat(),
    recorder = useVoiceRecorder(),
    playback = useVoicePlayback();
  const state = ref<VoiceState>("idle"),
    error = ref(""),
    transcript = ref(""),
    seconds = ref(0),
    sttLanguage = ref("auto"),
    ttsLanguage = ref("th"),
    health = ref<VoiceHealth | null>(null),
    progress = ref("");
  const active = computed(
    () => !["idle", "error", "cancelled"].includes(state.value),
  );
  let controller: AbortController | undefined,
    timer: ReturnType<typeof setInterval> | undefined,
    generation = 0;
  function clearTimer() {
    if (timer) clearInterval(timer);
    timer = undefined;
  }
  function cancel() {
    generation++;
    controller?.abort();
    controller = undefined;
    clearTimer();
    recorder.cancel();
    playback.stop();
    state.value = "cancelled";
    progress.value = "";
  }
  async function checkHealth() {
    try {
      error.value = "";
      health.value = await voiceHealth(AbortSignal.timeout(6000));
      if (!health.value.tts_languages.includes(ttsLanguage.value))
        ttsLanguage.value = health.value.tts_languages[0] ?? "th";
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    }
  }
  function fail(e: unknown, token: number) {
    if (token !== generation) return;
    clearTimer();
    recorder.cancel();
    playback.stop();
    state.value = "error";
    error.value = e instanceof Error ? e.message : String(e);
    controller = undefined;
  }
  async function speak(text: string, signal: AbortSignal, token: number) {
    const chunks = speechChunks(text);
    for (let i = 0; i < chunks.length; i++) {
      signal.throwIfAborted();
      if (token !== generation) return;
      state.value = "synthesizing";
      progress.value = `${i + 1} / ${chunks.length}`;
      const wav = await synthesize(chunks[i]!, ttsLanguage.value, signal);
      signal.throwIfAborted();
      if (token !== generation) return;
      state.value = "speaking";
      await playback.play(wav, signal);
    }
    if (token === generation) {
      state.value = "idle";
      progress.value = "";
      controller = undefined;
    }
  }
  async function start() {
    if (active.value || chat.busy || !chat.connected || !chat.character) return;
    const token = ++generation;
    controller = new AbortController();
    error.value = "";
    transcript.value = "";
    seconds.value = 0;
    state.value = "requesting";
    try {
      await playback.unlock();
      if (token !== generation) return;
      await recorder.start();
      if (token !== generation) return;
      state.value = "listening";
      timer = setInterval(() => {
        seconds.value++;
        if (seconds.value >= 60) void finish();
      }, 1000);
    } catch (e) {
      fail(e, token);
    }
  }
  async function finish() {
    if (state.value !== "listening" || !controller) return;
    const token = generation,
      signal = controller.signal;
    clearTimer();
    state.value = "transcribing";
    try {
      const audio = await recorder.stop();
      signal.throwIfAborted();
      const result = await transcribe(audio, sttLanguage.value, signal);
      signal.throwIfAborted();
      if (token !== generation) return;
      transcript.value = result.text.trim();
      if (!transcript.value)
        throw new Error("ไม่พบคำพูด ลองพูดใกล้ไมโครโฟนอีกครั้ง");
      state.value = "thinking";
      const reply = await chat.sendAndWait(transcript.value, signal);
      signal.throwIfAborted();
      await speak(reply.content, signal, token);
    } catch (e) {
      fail(e, token);
    }
  }
  async function replay() {
    if (active.value || chat.busy) return;
    const reply = [...chat.messages]
      .reverse()
      .find((m) => m.role === "assistant" && m.status === "complete");
    if (!reply) return;
    const token = ++generation;
    controller = new AbortController();
    const signal = controller.signal;
    error.value = "";
    state.value = "synthesizing";
    try {
      await playback.unlock();
      signal.throwIfAborted();
      await speak(reply.content, signal, token);
    } catch (e) {
      fail(e, token);
    }
  }
  watch(
    () => [chat.character?.id, chat.conversation],
    () => {
      if (active.value && state.value !== "thinking") cancel();
    },
  );
  watch(
    () => chat.connected,
    (value) => {
      if (!value && active.value) cancel();
    },
  );
  async function dispose() {
    cancel();
    await playback.dispose();
  }
  return {
    state,
    error,
    transcript,
    seconds,
    sttLanguage,
    ttsLanguage,
    health,
    progress,
    active,
    mouthOpen: playback.mouthOpen,
    start,
    finish,
    cancel,
    replay,
    checkHealth,
    dispose,
  };
});
