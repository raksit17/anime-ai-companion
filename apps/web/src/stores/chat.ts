import { defineStore } from "pinia";
import { useAnimation } from "./animation";
import { ref } from "vue";
import { io } from "socket.io-client";
import { api, base } from "../api";
import type {
  Character,
  Conversation,
  Message,
  Memory,
  Emotion,
  ChatEvent,
} from "@companion/contracts";
export const useChat = defineStore("chat", () => {
  const animation = useAnimation();
  const characters = ref<Character[]>([]),
    character = ref<Character | null>(null),
    conversations = ref<Conversation[]>([]),
    conversation = ref(""),
    messages = ref<Message[]>([]),
    memories = ref<Memory[]>([]);
  const connected = ref(false),
    busy = ref(false),
    partial = ref(""),
    error = ref(""),
    emotion = ref<Emotion>("neutral"),
    health = ref<any>(null);
  let pending:
    | {
        id: string;
        resolve: (m: Message) => void;
        reject: (e: Error) => void;
        cleanup: () => void;
      }
    | undefined;
  function settle(message?: Message, error?: Error) {
    const task = pending;
    pending = undefined;
    if (!task) return;
    task.cleanup();
    if (error) task.reject(error);
    else if (message) task.resolve(message);
  }
  let sending = false;
  let requestId = "",
    socket: ReturnType<typeof io> | undefined;
  async function guard(fn: () => Promise<unknown>) {
    try {
      error.value = "";
      await fn();
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    }
  }
  async function loadMessages() {
    if (conversation.value)
      messages.value = await api(
        `/conversations/${conversation.value}/messages`,
      );
  }
  async function refreshLists() {
    if (!character.value) return;
    conversations.value = await api(
      `/conversations?characterId=${character.value.id}`,
    );
    memories.value = await api(`/characters/${character.value.id}/memories`);
  }
  async function selectCharacter(c: Character) {
    if (busy.value) return;
    animation.cancel();
    character.value = c;
    localStorage.setItem("characterId", c.id);
    await refreshLists();
    const saved = localStorage.getItem("conversation:" + c.id);
    await selectConversation(
      conversations.value.find((v) => v.id === saved)?.id ??
        conversations.value[0]?.id ??
        "",
    );
  }
  async function selectConversation(id: string) {
    if (busy.value) return;
    animation.cancel();
    conversation.value = id;
    partial.value = "";
    messages.value = [];
    emotion.value = "neutral";
    if (character.value)
      localStorage.setItem("conversation:" + character.value.id, id);
    await loadMessages();
    const last = messages.value.at(-1);
    if (last?.emotion) emotion.value = last.emotion;
  }
  async function newConversation() {
    if (!character.value || busy.value) return;
    const c = await api<Conversation>("/conversations", "POST", {
      characterId: character.value.id,
    });
    await refreshLists();
    await selectConversation(c.id);
  }
  function matches(e: ChatEvent) {
    return e.requestId === requestId && e.conversationId === conversation.value;
  }
  async function init() {
    if (busy.value) return;
    socket?.removeAllListeners();
    socket?.disconnect();
    connected.value = false;
    await guard(async () => {
      characters.value = await api("/characters");
      if (characters.value.length)
        await selectCharacter(
          characters.value.find(
            (c) => c.id === localStorage.getItem("characterId"),
          ) ?? characters.value[0]!,
        );
      health.value = await api("/health");
    });
    socket = io(base + "/chat", {
      autoConnect: false,
      auth: { token: localStorage.getItem("companion-api-token") ?? "" },
    });
    socket.on("connect", () => {
      connected.value = true;
      void guard(loadMessages);
    });
    socket.on("disconnect", () => {
      connected.value = false;
      animation.cancel();
      settle(undefined, new Error("การเชื่อมต่อแชตหลุด"));
      if (busy.value) {
        busy.value = false;
        partial.value = "";
        error.value =
          "การเชื่อมต่อหลุด คำตอบถูกหยุด กรุณาโหลดประวัติหลังเชื่อมต่อใหม่";
      }
    });
    socket.on("connect_error", () => {
      error.value =
        "เชื่อมต่อ Backend ไม่ได้ ตรวจพอร์ต 3001 และ Local API token";
    });
    socket.on("chat:delta", (e: ChatEvent) => {
      if (matches(e)) partial.value += e.delta ?? "";
    });
    socket.on("chat:emotion", (e: ChatEvent) => {
      if (matches(e) && e.emotion) emotion.value = e.emotion;
    });
    socket.on("chat:complete", (e: ChatEvent) => {
      if (!matches(e)) return;
      if (e.message) {
        if (e.message.animationPlan) void animation.play(e.message.animationPlan).catch(() => {});
        settle(e.message);
      }
      else settle(undefined, new Error("ไม่พบคำตอบจากแชต"));
      busy.value = false;
      partial.value = "";
      void guard(async () => {
        await loadMessages();
        await refreshLists();
      });
    });
    socket.on("chat:error", (e: ChatEvent) => {
      if (!matches(e)) return;
      busy.value = false;
      partial.value = "";
      error.value = e.error ?? "เกิดข้อผิดพลาด";
      settle(undefined, new Error(error.value));
      void loadMessages().catch(() => {});
    });
    socket.connect();
  }
  async function submit(
    content: string,
    waitSignal?: AbortSignal,
  ): Promise<Message | undefined> {
    if (!connected.value || busy.value || sending || !content.trim())
      throw new Error("แชตยังไม่พร้อมส่ง");
    sending = true;
    try {
      if (!conversation.value) await newConversation();
      if (!conversation.value) throw new Error("กรุณาเลือกตัวละครก่อน");
      waitSignal?.throwIfAborted();
      requestId = crypto.randomUUID();
      busy.value = true;
      partial.value = "";
      error.value = "";
      let completion: Promise<Message> | undefined;
      if (waitSignal) {
        const id = requestId;
        completion = new Promise<Message>((resolve, reject) => {
          const abort = () => {
            socket?.emit("chat:stop", { requestId: id });
            settle(undefined, new Error("ยกเลิกแล้ว"));
          };
          const timer = setTimeout(() => {
            socket?.emit("chat:stop", { requestId: id });
            settle(undefined, new Error("แชตตอบช้าเกินกำหนด"));
          }, 320000);
          pending = {
            id,
            resolve,
            reject,
            cleanup: () => {
              clearTimeout(timer);
              waitSignal.removeEventListener("abort", abort);
            },
          };
          waitSignal.addEventListener("abort", abort, { once: true });
        });
      }
      messages.value.push({
        id: requestId,
        role: "user",
        content,
        emotion: null,
        status: "complete",
        createdAt: new Date().toISOString(),
      });
      socket!.emit("chat:send", {
        requestId,
        conversationId: conversation.value,
        content,
      });
      sending = false;
      return completion ? await completion : undefined;
    } finally {
      sending = false;
    }
  }
  async function send(content: string) {
    await guard(() => submit(content));
  }
  async function sendAndWait(content: string, signal: AbortSignal) {
    const message = await submit(content, signal);
    if (!message) throw new Error("ไม่ได้รับคำตอบ");
    return message;
  }
  function stop() {
    animation.cancel();
    socket?.emit("chat:stop", { requestId });
  }
  return {
    characters,
    character,
    conversations,
    conversation,
    messages,
    memories,
    connected,
    busy,
    partial,
    error,
    emotion,
    health,
    guard,
    init,
    selectCharacter,
    selectConversation,
    newConversation,
    send,
    sendAndWait,
    stop,
    refreshLists,
  };
});
