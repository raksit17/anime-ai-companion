import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";
import { useChat } from "./chat";
import { useAnimation } from "./animation";
import { useVoiceRecorder } from "../composables/useVoiceRecorder";
import { useVoicePlayback } from "../composables/useVoicePlayback";
import {
  transcribe,
  synthesize,
  synthesizePcmStream,
  voiceHealth,
  type VoiceHealth,
} from "../services/voice.api";
import { speechChunks } from "../services/speech-chunks";
import { StreamingSpeechChunker, type ReadySpeech } from "../services/streaming-speech";
import type { ChatStreamEvent } from "./chat";
import type { AnimationPlanV1, Emotion, Message } from "@companion/contracts";
import { parseAssistantSegments, selectBilingualSpeech, removeNarratedActions, type AssistantSegment } from "../services/speech-segments";
// Match the TTS language to the actual spoken text rather than the UI default.
// Keep explicitly selected non-Thai/English languages (e.g. Japanese) unchanged.
function languageForSpeech(text: string, preferred: string): string {
  if (preferred !== "th" && preferred !== "en") return preferred;
  if (/[\u0E00-\u0E7F]/.test(text)) return "th";
  if (/[A-Za-z]/.test(text)) return "en";
  return preferred;
}

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
  const autoSpeak = ref(typeof localStorage !== "undefined" && localStorage.getItem("companion-auto-speak") === "true");
  watch(autoSpeak, (value) => {
    if (typeof localStorage !== "undefined") localStorage.setItem("companion-auto-speak", String(value));
  });
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
  function clearTimer() {
    if (timer) clearInterval(timer);
    timer = undefined;
  }
  function cancel() {
    generation++;
    controller?.abort();
    streamSession?.controller.abort();
    streamSession = undefined;
    streamPlayback = undefined;
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
      if (
        health.value.tts_engine === "moss" &&
        health.value.tts_languages.includes("en")
      ) {
        ttsLanguage.value = "en";
        return;
      }
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
    const bilingual = selectBilingualSpeech(content, ttsLanguage.value);
    const speechContent = bilingual?.text ?? content;
    let completed = 0;

    async function speakText(
      text: string,
      total: number,
      segmentSignal?: AbortSignal,
    ) {
      const combined = segmentSignal
        ? AbortSignal.any([signal, segmentSignal])
        : signal;

      for (const chunk of speechChunks(removeNarratedActions(text))) {
        combined.throwIfAborted();
        if (token !== generation) return;

        state.value = "synthesizing";
        progress.value = `${++completed} / ${total}`;

        const wav = await synthesize(
          chunk,
          bilingual?.language ?? languageForSpeech(chunk, ttsLanguage.value),
          combined,
        );

        combined.throwIfAborted();
        if (token !== generation) return;

        state.value = "speaking";
        await playback.play(wav, combined);
      }
    }

    if (plan?.version === 1 && plan.messageId === reply?.id && !bilingual) {
      const total = plan.segments.reduce(
        (sum, segment) =>
          sum +
          (segment.type === "speech"
            ? speechChunks(removeNarratedActions(segment.text)).length
            : 0),
        0,
      );

      await animation.play(plan, async (text, segmentSignal) => {
        await speakText(text, total, segmentSignal);
      });
    } else {
      const segments = parseAssistantSegments(
        speechContent,
        reply?.emotion ?? null,
      );

      const total = segments.reduce(
        (sum, segment) =>
          sum +
          (segment.type === "speech"
            ? speechChunks(removeNarratedActions(segment.text)).length
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
  type StreamSession = {
    id: string;
    token: number;
    controller: AbortController;
    chunker: StreamingSpeechChunker;
    chain: Promise<void>;
  };
  let streamSession: StreamSession | undefined;
  let streamPlayback: Promise<void> | undefined;

  function enqueueSpeech(session: StreamSession, chunks: ReadySpeech[]) {
    // One outstanding MOSS job at a time: prevents flooding its GPU queue.
    for (const chunk of chunks) {
      session.chain = session.chain.then(async () => {
        session.controller.signal.throwIfAborted();
        if (session.token !== generation) return;
        state.value = "synthesizing";
        progress.value = "กำลังสร้างเสียงขณะ AI ตอบ";
        // SGLang PCM streaming is a distinct engine; never replace
        // Chatterbox-Turbo English with a different voice.
        const native = health.value?.streaming_ready === true &&
          health.value.streaming_languages?.includes(chunk.language) === true;
        if (native) {
          let pcm: { stream: ReadableStream<Uint8Array>; sampleRate: number } | undefined;
          try {
            pcm = await synthesizePcmStream(chunk.text, chunk.language, session.controller.signal);
          } catch (error) {
            if (session.controller.signal.aborted) throw error;
            // SGLang may have stopped since the health probe.
            // Fall back only if streaming never started (no duplicated audio).
            console.warn("MOSS PCM stream unavailable, falling back to WAV", error);
          }
          if (pcm) {
            session.controller.signal.throwIfAborted();
            if (session.token !== generation) return;
            state.value = "speaking";
            await playback.playPcmStream(pcm.stream, session.controller.signal, pcm.sampleRate);
            return;
          }
        }
        const wav = await synthesize(chunk.text, chunk.language, session.controller.signal, true);
        session.controller.signal.throwIfAborted();
        if (session.token !== generation) return;
        state.value = "speaking";
        await playback.play(wav, session.controller.signal);
      }).catch((reason: unknown) => {
        if (session.controller.signal.aborted || session.token !== generation) return;
        session.controller.abort();
        fail(reason, session.token);
      });
    }
  }

  function onChatStream(event: ChatStreamEvent) {
    if (event.type === "start") {
      if (!autoSpeak.value || (state.value !== "idle" && state.value !== "thinking")) return;
      streamSession?.controller.abort();
      const token = state.value === "thinking" ? generation : ++generation;
      streamSession = {
        id: event.requestId,
        token,
        controller: new AbortController(),
        chunker: new StreamingSpeechChunker(ttsLanguage.value),
        chain: Promise.resolve(),
      };
      streamPlayback = undefined;
      return;
    }
    const session = streamSession;
    if (!session || session.id !== event.requestId) return;
    if (event.type === "delta") {
      enqueueSpeech(session, session.chunker.append(event.delta));
    } else if (event.type === "complete") {
      enqueueSpeech(session, session.chunker.finish());
      streamPlayback = session.chain.then(() => {
        if (streamSession !== session) return;
        streamSession = undefined;
        if (session.token === generation && !session.controller.signal.aborted) {
          state.value = "idle";
          progress.value = "";
          controller = undefined;
        }
      });
    } else if (event.type === "error") {
      session.controller.abort();
      streamSession = undefined;
      if (state.value === "synthesizing" || state.value === "speaking") {
        playback.stop();
        state.value = "idle";
        progress.value = "";
      }
    }
  }
  chat.onStream(onChatStream);

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
      if (autoSpeak.value && streamPlayback) {
        await streamPlayback;
      } else {
        await speak(reply.content, signal, token, reply);
      }
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
