import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";
import { useChat } from "./chat";
import { useAnimation } from "./animation";
import { useVoiceRecorder } from "../composables/useVoiceRecorder";
import { useVoicePlayback } from "../composables/useVoicePlayback";
import {
  transcribe,
  synthesize,
  voiceHealth,
  type VoiceHealth,
} from "../services/voice.api";
import { speechChunks } from "../services/speech-chunks";
import type { AnimationPlanV1, Emotion, Message } from "@companion/contracts";
import { parseAssistantSegments, type AssistantSegment } from "../services/speech-segments";
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
  const animation = useAnimation(),
    chat = useChat(),
    recorder = useVoiceRecorder(),
    playback = useVoicePlayback();
  const autoSpeak = ref(localStorage.getItem("companion-auto-speak") === "true");
  watch(autoSpeak, (value) => localStorage.setItem("companion-auto-speak", String(value)));
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
    generation = 0,
    actionHandler: (action: Extract<AssistantSegment, { type: "action" }>) => Promise<void> = async () => {};
  let lastAutoResponseId = "";
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
    animation.cancel();
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
  async function speak(
    content: string,
    signal: AbortSignal,
    token: number,
    reply?: {
      id?: string;
      animationPlan?: AnimationPlanV1;
      emotion?: string | null;
      content?: string;
    },
  ) {
    const plan = reply?.animationPlan;
    let completed = 0;

    async function speakText(
      text: string,
      total: number,
      segmentSignal?: AbortSignal,
    ) {
      const combined = segmentSignal
        ? AbortSignal.any([signal, segmentSignal])
        : signal;

      for (const chunk of speechChunks(text)) {
        combined.throwIfAborted();
        if (token !== generation) return;

        state.value = "synthesizing";
        progress.value = `${++completed} / ${total}`;

        const wav = await synthesize(
          chunk,
          ttsLanguage.value,
          combined,
        );

        combined.throwIfAborted();
        if (token !== generation) return;

        state.value = "speaking";
        await playback.play(wav, combined);
      }
    }

    if (plan?.version === 1 && plan.messageId === reply?.id) {
      const total = plan.segments.reduce(
        (sum, segment) =>
          sum +
          (segment.type === "speech"
            ? speechChunks(segment.text).length
            : 0),
        0,
      );

      await animation.play(plan, async (text, segmentSignal) => {
        await speakText(text, total, segmentSignal);
      });
    } else {
      const segments = parseAssistantSegments(
        content,
        reply?.emotion ?? null,
      );

      const total = segments.reduce(
        (sum, segment) =>
          sum +
          (segment.type === "speech"
            ? speechChunks(segment.text).length
            : 0),
        0,
      );

      for (const segment of segments) {
        signal.throwIfAborted();
        if (token !== generation) return;

        if (segment.type === "action") {
          await actionHandler(segment);
          continue;
        }

        if (segment.emotion) {
          chat.emotion = segment.emotion as typeof chat.emotion;
        }

        await speakText(segment.text, total);
      }
    }

    if (token === generation) {
      state.value = "idle";
      progress.value = "";
      controller = undefined;
    }
  }
  function setActionHandler(
    handler: (action: Extract<AssistantSegment, { type: "action" }>) => Promise<void>,
  ) {
    actionHandler = handler;
  }
  async function preparePlayback() {
    if (!autoSpeak.value) return;
    try {
      await playback.unlock();
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    }
  }
  async function setAutoSpeak(enabled: boolean) {
    if (enabled) {
      try {
        await playback.unlock();
        error.value = "";
        autoSpeak.value = true;
        if (typeof localStorage !== "undefined") localStorage.setItem("companion-auto-speak", "true");
      } catch (e) {
        autoSpeak.value = false;
        error.value = e instanceof Error ? e.message : String(e);
      }
    } else {
      autoSpeak.value = false;
      if (typeof localStorage !== "undefined") localStorage.setItem("companion-auto-speak", "false");
    }
  }
  async function autoPlay(message: { id: string; content: string; emotion?: string | null }) {
    if (!autoSpeak.value || state.value !== "idle" || chat.busy) return;
    const token = ++generation;
    controller = new AbortController();
    error.value = "";
    try {
      await playback.unlock();
      if (token !== generation) return;
      await speak(message.content, controller.signal, token, message);
    } catch (e) {
      fail(e, token);
    }
  }
  let awaitingTypedReply = false;
  let previousResponseId = "";

  watch(
    () => [
      chat.busy,
      chat.messages.filter(
        (m) => m.role === "assistant" && m.status === "complete",
      ).at(-1)?.id,
    ] as const,
    () => {
      const latest = [...chat.messages]
        .reverse()
        .find(
          (m) => m.role === "assistant" && m.status === "complete",
        );

      if (chat.busy) {
        if (state.value === "idle" && !awaitingTypedReply) {
          awaitingTypedReply = true;
          previousResponseId = latest?.id ?? "";
        }
        return;
      }

      if (!awaitingTypedReply || !latest) return;
      if (latest.id === previousResponseId) return;

      awaitingTypedReply = false;
      if (latest.id === lastAutoResponseId) return;
      lastAutoResponseId = latest.id;

      void autoPlay(latest);
    },
  );
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
      await speak(reply.content, signal, token, reply);
    } catch (e) {
      fail(e, token);
    }
  }
  async function replay(content?: string) {
    if (active.value || chat.busy) return;
    const reply = content
      ? { content }
      : [...chat.messages]
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
      await speak(reply.content, signal, token, reply);
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
    autoSpeak,
    error,
    transcript,
    seconds,
    sttLanguage,
    ttsLanguage,
    health,
    progress,
    active,
    mouthOpen: playback.mouthOpen,
    setActionHandler,
    setAutoSpeak,
    preparePlayback,
    start,
    finish,
    cancel,
    replay,
    checkHealth,
    dispose,
  };
});
