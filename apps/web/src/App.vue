<script setup lang="ts">
import DesktopSettings from "./components/DesktopSettings.vue";
import { desktop, invoke, listen } from "./desktop";
import VoiceControls from "./components/voice/VoiceControls.vue";
import { useVoice } from "./stores/voice";
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from "vue";
import { useChat } from "./stores/chat";
import { api } from "./api";
import Live2DViewer from "./components/Live2DViewer.vue";
import type { Character } from "@companion/contracts";
const voice = useVoice();
const chat = useChat(),
  text = ref(""),
  tab = ref("chat"),
  memory = ref(""),
  importance = ref(3),
  editingMemory = ref(""),
  log = ref<HTMLElement>(),
  settings = ref(false),
  creating = ref(false);
const form = ref({
  name: "",
  personality: "",
  systemPrompt: "",
  modelPath: "",
  expressionMap: "{}",
  motionMap: "{}",
});
const interactionState = computed(() => {
  if (voice.state === "listening") return "listening";
  if (voice.state === "speaking") return "speaking";
  if (chat.busy) return chat.partial ? "responding" : "thinking";
  if (["requesting", "transcribing", "thinking", "synthesizing"].includes(voice.state))
    return "thinking";
  return "idle";
});
const interactionLabel: Record<string, string> = {
  idle: "พร้อมรับฟังเรื่องราวของคุณ",
  listening: "กำลังฟังคุณ…",
  thinking: "กำลังคิดคำตอบ…",
  responding: "กำลังตอบคุณ…",
  speaking: "กำลังพูด",
};
const emoji: Record<string, string> = {
  neutral: "◌",
  happy: "☺",
  angry: "♨",
  shy: "♡",
  sad: "☂",
  surprised: "✧",
};
let mirrorTimer: ReturnType<typeof setInterval> | undefined;
let stopListener: (() => void) | undefined;
onMounted(async () => {
  if (desktop) {
    stopListener = await listen("desktop:stop", () => {
      voice.cancel();
      chat.stop();
    });
    let last = "",
      publishing = false;
    mirrorTimer = setInterval(async () => {
      if (publishing) return;
      const snapshot = {
        name: chat.character?.name ?? "Komorebi",
        modelPath: chat.character?.modelPath ?? null,
        expressionMap: chat.character?.expressionMap ?? null,
        motionMap: chat.character?.motionMap ?? null,
        interactionState: interactionState.value,
        emotion: chat.emotion,
        mouthOpen: voice.mouthOpen,
        voiceState: voice.state,
        connected: chat.connected,
        busy: chat.busy,
      };
      const json = JSON.stringify(snapshot);
      if (json === last) return;
      publishing = true;
      try {
        await invoke("publish_snapshot", { snapshot });
        last = json;
      } catch (e) {
        chat.error = String(e);
      } finally {
        publishing = false;
      }
    }, 50);
  }
  await chat.init();
});
onBeforeUnmount(() => {
  clearInterval(mirrorTimer);
  stopListener?.();
  voice.cancel();
  chat.stop();
});
watch(
  () => [chat.messages.length, chat.partial],
  async () => {
    await nextTick();
    log.value?.scrollTo({ top: log.value.scrollHeight, behavior: "smooth" });
  },
);
function openSettings(fresh = false) {
  creating.value = fresh;
  const c = fresh ? null : chat.character;
  form.value = {
    name: c?.name ?? "",
    personality: c?.personality ?? "",
    systemPrompt: c?.systemPrompt ?? "",
    modelPath: c?.modelPath ?? "",
    expressionMap: JSON.stringify(c?.expressionMap ?? {}, null, 2),
    motionMap: JSON.stringify(c?.motionMap ?? {}, null, 2),
  };
  settings.value = true;
}
async function save() {
  await chat.guard(async () => {
    const mapping = JSON.parse(form.value.expressionMap);
    if (
      !mapping ||
      Array.isArray(mapping) ||
      typeof mapping !== "object" ||
      Object.values(mapping).some((v) => typeof v !== "string")
    )
      throw new Error(
        "Expression map ต้องเป็น JSON object ที่มีค่าเป็นชื่อ expression",
      );
    const motionMapping = JSON.parse(form.value.motionMap);
    if (
      !motionMapping ||
      Array.isArray(motionMapping) ||
      typeof motionMapping !== "object" ||
      Object.values(motionMapping).some(
        (value: any) =>
          !value ||
          typeof value.group !== "string" ||
          !value.group.trim() ||
          (value.index !== undefined &&
            (!Number.isInteger(value.index) || value.index < 0)),
      )
    )
      throw new Error("Motion map ต้องเป็น JSON object ที่มี group และ index ที่ถูกต้อง");
    const body = {
      ...form.value,
      modelPath: form.value.modelPath.trim() || undefined,
      expressionMap: mapping,
      motionMap: motionMapping,
    };
    const c = await api<Character>(
      creating.value ? "/characters" : `/characters/${chat.character!.id}`,
      creating.value ? "POST" : "PATCH",
      body,
    );
    chat.characters = await api("/characters");
    await chat.selectCharacter(c);
    settings.value = false;
  });
}
async function send() {
  if (voice.active) return;
  const value = text.value.trim();
  if (!value) return;
  text.value = "";
  await chat.guard(async () => {
    const reply = await chat.sendAndWait(value, AbortSignal.timeout(320000));
    if (voice.autoSpeak) await voice.replay(reply.content);
  });
}
async function saveMemory() {
  await chat.guard(async () => {
    await api(
      editingMemory.value
        ? `/memories/${editingMemory.value}`
        : `/characters/${chat.character!.id}/memories`,
      editingMemory.value ? "PATCH" : "POST",
      { content: memory.value, importance: importance.value },
    );
    memory.value = "";
    editingMemory.value = "";
    await chat.refreshLists();
  });
}
async function deleteCharacter() {
  if (!chat.character || !confirm("ลบตัวละคร รวมทั้งประวัติและความจำทั้งหมด?"))
    return;
  await chat.guard(async () => {
    await api(`/characters/${chat.character!.id}`, "DELETE");
    chat.characters = await api("/characters");
    chat.character = null;
    chat.conversation = "";
    chat.messages = [];
    chat.memories = [];
    chat.conversations = [];
    if (chat.characters[0]) await chat.selectCharacter(chat.characters[0]);
    settings.value = false;
  });
}
</script>
<template>
  <div class="app-shell">
    <header>
      <div class="brand">
        <span class="brand-icon">✦</span>
        <div>komorebi<span>ANIME AI COMPANION · PHASE 03</span></div>
      </div>
      <DesktopSettings />
      <div class="connection">
        <i :class="{ online: chat.connected }" />{{
          chat.connected ? "Backend connected" : "Connecting…"
        }}<span class="local">LOCAL FIRST</span>
      </div>
    </header>
    <div class="workspace">
      <aside class="sidebar">
        <p class="eyebrow">YOUR COMPANION</p>
        <select
          aria-label="เลือกตัวละคร"
          :value="chat.character?.id"
          :disabled="voice.active || chat.busy"
          @change="
            chat.guard(() =>
              chat.selectCharacter(
                chat.characters.find(
                  (c) => c.id === ($event.target as HTMLSelectElement).value,
                )!,
              ),
            )
          "
        >
          <option v-if="!chat.characters.length" value="">
            ยังไม่มีตัวละคร
          </option>
          <option v-for="c in chat.characters" :value="c.id">
            {{ c.name }}
          </option></select
        ><button
          class="ghost"
          :disabled="voice.active || chat.busy"
          @click="openSettings(true)"
        >
          ＋ เพิ่มตัวละคร</button
        ><button
          class="ghost"
          :disabled="voice.active || chat.busy || !chat.character"
          @click="openSettings()"
        >
          ตั้งค่าตัวละคร
        </button>
        <div class="sidebar-heading">
          <p class="eyebrow">CONVERSATIONS</p>
          <button
            title="แชตใหม่"
            :disabled="voice.active || chat.busy || !chat.character"
            @click="chat.guard(chat.newConversation)"
          >
            ＋
          </button>
        </div>
        <div class="conversations">
          <button
            v-for="c in chat.conversations"
            :class="{ selected: c.id === chat.conversation }"
            :disabled="voice.active || chat.busy"
            @click="chat.guard(() => chat.selectConversation(c.id))"
          >
            ◌ <span>{{ c.title || "บทสนทนาใหม่" }}</span>
          </button>
          <p v-if="!chat.conversations.length" class="muted small">
            เรื่องราวเริ่มต้นได้จากคำทักทาย
          </p>
        </div>
        <div class="system-card">
          <span class="eyebrow">ON YOUR MACHINE</span>
          <p>
            Ollama <strong>{{ chat.health?.ollama ?? "unknown" }}</strong>
          </p>
          <p>
            PostgreSQL <strong>{{ chat.health?.database ?? "unknown" }}</strong>
          </p>
          <small>{{ chat.health?.model ?? "กำลังตรวจบริการ…" }}</small
          ><button
            class="ghost"
            @click="
              chat.guard(async () => {
                chat.health = await api('/health');
              })
            "
          >
            ตรวจสถานะอีกครั้ง
          </button>
        </div>
      </aside>
      <main class="character-stage">
        <div class="stage-heading">
          <span class="pill">{{ emoji[chat.emotion] }} {{ chat.emotion }}</span
          ><button
            class="glass"
            :disabled="voice.active || chat.busy || !chat.character"
            @click="openSettings()"
          >
            ⚙ ตั้งค่าตัวละคร
          </button>
        </div>
        <Live2DViewer
          :mouth-open="voice.mouthOpen"
          :key="chat.character?.id"
          :model-path="chat.character?.modelPath ?? null"
          :emotion="chat.emotion"
          :expression-map="chat.character?.expressionMap ?? null"
          :motion-map="chat.character?.motionMap ?? null"
          :interaction-state="interactionState"
        />
        <div class="character-caption">
          <p class="eyebrow">A LITTLE COMPANY, EVERY DAY</p>
          <h1>{{ chat.character?.name ?? "Your companion" }}<span>✦</span></h1>
          <p>
            {{
              chat.character?.personality ||
              "สร้างตัวละคร แล้วเริ่มบทสนทนาแรกของคุณ"
            }}
          </p>
        </div>
        <div class="stage-footer">
          <span
            >●
            {{
              interactionLabel[interactionState]
            }}</span
          ><span>{{ chat.character?.modelPath ? "LIVE2D MODE" : "TEXT MODE" }}</span>
        </div>
      </main>
      <section class="chat-panel">
        <nav>
          <button :class="{ active: tab === 'chat' }" @click="tab = 'chat'">
            บทสนทนา</button
          ><button
            :class="{ active: tab === 'memory' }"
            @click="tab = 'memory'"
          >
            ความทรงจำ <b>{{ chat.memories.length }}</b>
          </button>
        </nav>
        <div v-if="chat.error" role="alert" class="error">
          {{ chat.error }}<button @click="chat.error = ''">×</button>
        </div>
        <template v-if="tab === 'chat'"
          ><div ref="log" class="chat-log" aria-live="polite">
            <div v-if="!chat.messages.length" class="welcome">
              <div>✧</div>
              <h2>วันนี้เป็นยังไงบ้าง?</h2>
              <p>
                พื้นที่เล็ก ๆ สำหรับคุย พักใจ<br />และแบ่งปันเรื่องราวของคุณ
              </p>
            </div>
            <article
              v-for="m in chat.messages"
              :key="m.id"
              :class="['message', m.role]"
            >
              <div class="message-meta">
                {{ m.role === "user" ? "คุณ" : chat.character?.name }}
                <small>{{
                  new Date(m.createdAt).toLocaleTimeString("th-TH", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                }}</small>
              </div>
              <div class="bubble">{{ m.content }}</div>
              <button
                v-if="m.role === 'assistant' && m.status === 'complete'"
                class="message-read"
                type="button"
                :disabled="voice.active || chat.busy"
                @click="voice.replay(m.content)"
              >
                ▶ อ่านคำตอบนี้
              </button>
              <small v-if="m.status === 'interrupted'" class="muted"
                >คำตอบนี้ถูกหยุดก่อนจบ</small
              >
            </article>
            <article v-if="chat.busy" class="message assistant">
              <div class="message-meta">{{ chat.character?.name }}</div>
              <div class="bubble">
                {{ chat.partial || "กำลังคิด…" }}<span class="cursor">▍</span>
              </div>
            </article>
          </div>
          <VoiceControls />
          <form class="composer" @submit.prevent="send">
            <textarea
              v-model="text"
              maxlength="4000"
              placeholder="พิมพ์ข้อความถึงเพื่อนของคุณ…"
              aria-label="ข้อความ"
              :disabled="voice.active || chat.busy || !chat.character"
              @keydown.enter.exact.prevent="!$event.isComposing && send()"
            />
            <div>
              <small>Enter ส่ง · Shift + Enter ขึ้นบรรทัดใหม่</small
              ><button
                v-if="chat.busy"
                type="button"
                class="primary"
                @click="chat.stop"
              >
                ■ หยุด</button
              ><button
                v-else
                class="primary"
                :disabled="
                  voice.active ||
                  !chat.connected ||
                  !chat.character ||
                  !text.trim()
                "
              >
                ส่ง ↗
              </button>
            </div>
          </form>
          <p class="privacy-note">
            ประวัติและความจำเก็บในฐานข้อมูลบนเครื่องคุณ
          </p></template
        >
        <div v-else class="memory-panel">
          <p class="eyebrow">THINGS TO REMEMBER</p>
          <h2>ให้ฉันจำเรื่องของคุณ</h2>
          <p class="muted">
            เลือกเองว่าอยากให้ตัวละครจำอะไร ความจำใช้ร่วมกันทุกห้องของตัวละครนี้
          </p>
          <form @submit.prevent="saveMemory">
            <textarea
              v-model="memory"
              required
              maxlength="1000"
              placeholder="เช่น ฉันกำลังเรียน NestJS"
              aria-label="ความทรงจำ"
            /><label
              >ความสำคัญ
              <select v-model.number="importance">
                <option v-for="n in 5" :value="n">{{ n }}</option>
              </select></label
            ><button class="primary" :disabled="!chat.character">
              {{
                editingMemory ? "บันทึกการแก้ไข" : "＋ เพิ่มความทรงจำ"
              }}</button
            ><button
              v-if="editingMemory"
              type="button"
              @click="
                editingMemory = '';
                memory = '';
              "
            >
              ยกเลิก
            </button>
          </form>
          <article v-for="m in chat.memories" class="memory-card">
            <span class="eyebrow">IMPORTANCE {{ m.importance }} / 5</span>
            <p>{{ m.content }}</p>
            <button
              @click="
                editingMemory = m.id;
                memory = m.content;
                importance = m.importance;
              "
            >
              แก้ไข</button
            ><button
              @click="
                chat.guard(async () => {
                  await api('/memories/' + m.id, 'DELETE');
                  await chat.refreshLists();
                })
              "
            >
              ลบ
            </button>
          </article>
        </div>
      </section>
    </div>
    <div v-if="settings" class="modal-backdrop" @click.self="settings = false">
      <section
        class="modal"
        role="dialog"
        aria-modal="true"
        aria-label="ตั้งค่าตัวละคร"
      >
        <div class="modal-title">
          <h2>{{ creating ? "สร้างตัวละคร" : "ตั้งค่าตัวละคร" }}</h2>
          <button @click="settings = false">×</button>
        </div>
        <form @submit.prevent="save">
          <label
            >ชื่อ<input v-model="form.name" required maxlength="80" /></label
          ><label
            >บุคลิก<textarea
              v-model="form.personality"
              maxlength="4000"
            /></label
          ><label
            >System prompt<textarea
              v-model="form.systemPrompt"
              maxlength="8000"
            /></label
          ><label
            >Live2D model path<input
              v-model="form.modelPath"
              placeholder="/live2d/models/yuna/yuna.model3.json" /></label
          ><label
            >Emotion → Expression (JSON)<textarea
              v-model="form.expressionMap"
              placeholder='{"happy":"smile","shy":"blush"}'
            />
          </label>
          <label
            >Emotion / state → Motion (JSON)<textarea
              v-model="form.motionMap"
              placeholder='{"happy":{"group":"TapBody","index":0},"listening":{"group":"Idle","index":0}}'
            />
          </label>
          <p class="muted small">
            ชื่อ Expression และ motion group ต้องตรงกับโมเดลจริง ดูวิธีติดตั้ง Cubism Core
            และโมเดลใน README
          </p>
          <p v-if="chat.error" class="error">{{ chat.error }}</p>
          <button class="primary">บันทึกตัวละคร</button
          ><button
            v-if="!creating"
            type="button"
            class="danger"
            @click="deleteCharacter"
          >
            ลบตัวละคร
          </button>
        </form>
      </section>
    </div>
  </div>
</template>
