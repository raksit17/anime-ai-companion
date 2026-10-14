<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from "vue";
import { api } from "../api";
import { desktop, invoke, action } from "../desktop";
import { useChat } from "../stores/chat";
import { useVoice } from "../stores/voice";
const chat = useChat(),
  voice = useVoice();
const open = ref(!localStorage.getItem("companion-api-token"));
const token = ref(localStorage.getItem("companion-api-token") ?? "");
const error = ref(""),
  runtime = ref<Record<string, any>>({}),
  native = ref<any>({}),
  loading = ref(false);
async function refresh() {
  if (loading.value) return;
  loading.value = true;
  error.value = "";
  try {
    runtime.value = await api("/runtime/health");
  } catch (e) {
    runtime.value = {};
    error.value = String(e);
  }
  if (desktop) {
    try {
      native.value = await invoke("desktop_status");
    } catch (e) {
      error.value = String(e);
    }
  }
  loading.value = false;
}
async function pair() {
  voice.cancel();
  chat.stop();
  localStorage.setItem("companion-api-token", token.value.trim());
  await chat.init();
  await voice.checkHealth();
  await refresh();
}
async function auto(event: Event) {
  try {
    await invoke("set_autostart", {
      enabled: (event.target as HTMLInputElement).checked,
    });
    await refresh();
  } catch (e) {
    error.value = String(e);
  }
}
async function run(name: string) {
  try {
    await action(name);
    await refresh();
  } catch (e) {
    error.value = String(e);
  }
}
let timer: ReturnType<typeof setInterval>;
onMounted(() => {
  void refresh();
  timer = setInterval(() => {
    if (open.value) void refresh();
  }, 10000);
});
onBeforeUnmount(() => clearInterval(timer));
</script>
<template>
  <button class="ghost" @click="open = !open">⚙ การเชื่อมต่อ / Desktop</button>
  <div v-if="open" class="modal-backdrop" @click.self="open = false">
    <section
      class="modal"
      role="dialog"
      aria-modal="true"
      aria-label="การเชื่อมต่อและ Desktop"
    >
      <div class="modal-title">
        <h2>การเชื่อมต่อและ Desktop</h2>
        <button @click="open = false">×</button>
      </div>
      <p>คัดลอก LOCAL_API_TOKEN จาก apps/api/.env หลังรัน npm run setup</p>
      <form @submit.prevent="pair">
        <label
          >Local API token<input
            v-model="token"
            type="password"
            autocomplete="off"
            spellcheck="false" /></label
        ><button class="primary" :disabled="chat.busy || voice.active">
          บันทึกและเชื่อมต่อ
        </button>
      </form>
      <h3>บริการบนเครื่อง</h3>
      <p v-for="name in ['backend', 'database', 'ollama', 'voice']" :key="name">
        {{ name }}: <strong>{{ runtime[name]?.status ?? "unknown" }}</strong>
      </p>
      <p class="muted small">
        เปิด NestJS, PostgreSQL, Ollama และ FastAPI แยกกัน
        แอปไม่เปิดบริการให้อัตโนมัติ
      </p>
      <button @click="refresh" :disabled="loading">ตรวจใหม่</button>
      <template v-if="desktop"
        ><h3>หน้าต่างตัวละคร</h3>
        <button @click="run('show')">แสดง / คลิกได้</button>
        <button @click="run('reset')">คืนตำแหน่งกลางจอ</button>
        <p>โหมด: {{ native.clickThrough ? "คลิกทะลุ" : "โต้ตอบได้" }}</p>
        <label
          ><input type="checkbox" :checked="native.autostart" @change="auto" />
          เปิดแอปเมื่อเข้าสู่ระบบ (ไม่เปิดไมโครโฟน)</label
        >
        <p class="small">Ctrl+Alt+Y แสดง · Ctrl+Alt+M แชต · Ctrl+Alt+H ซ่อน</p>
        <p v-for="warning in native.warnings" class="error">
          {{ warning }}
        </p></template
      >
      <p v-if="error" role="alert" class="error">{{ error }}</p>
    </section>
  </div>
</template>
