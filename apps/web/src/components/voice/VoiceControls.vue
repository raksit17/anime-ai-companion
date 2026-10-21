<script setup lang="ts">
import { onMounted, onBeforeUnmount } from "vue";
import { useVoice } from "../../stores/voice";
import { useChat } from "../../stores/chat";
const voice = useVoice(),
  chat = useChat();
const labels: Record<string, string> = {
  idle: "พร้อมคุยด้วยเสียง",
  requesting: "กำลังขอสิทธิ์ไมโครโฟน",
  listening: "กำลังฟัง",
  transcribing: "กำลังถอดเสียง",
  thinking: "กำลังคิดคำตอบ",
  synthesizing: "กำลังสร้างเสียง",
  speaking: "กำลังพูด",
  cancelled: "หยุดแล้ว",
  error: "เสียงมีปัญหา",
};
onMounted(() => voice.checkHealth());
onBeforeUnmount(() => void voice.dispose());
</script>
<template>
  <section class="voice-controls" aria-label="สนทนาด้วยเสียง">
    <div class="voice-heading">
      <strong aria-live="polite"
        >◉ {{ labels[voice.state] }}
        <span v-if="voice.state === 'listening'">{{ voice.seconds }} / 60s</span
        ><span v-else>{{ voice.progress }}</span></strong
      ><button
        class="ghost"
        :disabled="voice.active"
        @click="voice.checkHealth"
      >
        {{ voice.health?.tts_engine ?? "ตรวจบริการเสียง" }}
      </button>
    </div>
    <label class="auto-speech-toggle">
      <input type="checkbox" :checked="voice.autoSpeak" :disabled="voice.active" @change="voice.setAutoSpeak(($event.target as HTMLInputElement).checked)" />
      พูดคำตอบอัตโนมัติทันที
    </label>
    <div class="voice-settings">
      <label
        >ภาษาที่พูด<select v-model="voice.sttLanguage" :disabled="voice.active">
          <option value="auto">Auto</option>
          <option value="th">ไทย</option>
          <option value="en">English</option>
          <option value="ja">日本語</option>
        </select></label
      ><label
        >ภาษาเสียงตอบ<select
          v-model="voice.ttsLanguage"
          :disabled="voice.active"
        >
          <option
            v-for="lang in voice.health?.tts_languages ?? ['th']"
            :value="lang"
          >
            {{ lang }}
          </option>
        </select></label
      >
    </div>
    <div class="voice-actions">
      <button
        v-if="voice.state === 'listening'"
        class="primary"
        @click="voice.finish"
      >
        ■ ส่งเสียงที่พูด</button
      ><button
        v-else
        class="primary"
        :disabled="
          voice.active || chat.busy || !chat.connected || !chat.character
        "
        @click="voice.start"
      >
        🎙 เริ่มพูด</button
      ><button v-if="voice.active" @click="voice.cancel">หยุด / ยกเลิก</button
      ><button
        v-else
        :disabled="
          chat.busy ||
          !chat.messages.some(
            (m) => m.role === 'assistant' && m.status === 'complete',
          )
        "
        @click="voice.replay()"
      >
        ▶ อ่านคำตอบล่าสุด
      </button>
    </div>
    <meter
      min="0"
      max="1"
      :value="voice.mouthOpen"
      aria-label="ระดับการอ้าปาก"
    />
    <p v-if="voice.transcript" class="voice-transcript">
      ได้ยินว่า: {{ voice.transcript }}
    </p>
    <p v-if="voice.error" class="error" role="alert">{{ voice.error }}</p>
    <small
      >กดเริ่มพูด แล้วกดส่งเสียง · เปิดพูดอัตโนมัติเพื่อฟังคำตอบทันที</small
    >
  </section>
</template>
