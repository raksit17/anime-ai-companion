<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from "vue";
import { api, base } from "../api";
import { normalizeLocalApiToken } from "../services/auth";
import { desktop, invoke, action } from "../desktop";
import { useChat } from "../stores/chat";
import { useVoice } from "../stores/voice";

const chat = useChat(), voice = useVoice();
const open = ref(!localStorage.getItem("companion-api-token"));
const token = ref(localStorage.getItem("companion-api-token") ?? "");
const error = ref("");
const runtime = ref<Record<string, any>>({});
const native = ref<any>({});
const loading = ref(false);
const verified = ref(false);

async function refresh() {
  // Pairing and background health checks must never race: an older 401 can
  // otherwise overwrite the success of a freshly saved token.
  if (loading.value) return;
  if (!localStorage.getItem("companion-api-token")) {
    runtime.value = {};
    verified.value = false;
    return;
  }
  loading.value = true;
  error.value = "";
  try {
    runtime.value = await api("/runtime/health");
    verified.value = true;
  } catch (e) {
    runtime.value = {};
    verified.value = false;
    const message = String(e);
    error.value = message.includes('"statusCode":401')
      ? "Token ที่บันทึกไว้ไม่ตรงกับ Backend กรุณาวาง Token ใหม่แล้วกดตรวจสอบ"
      : message;
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
  if (loading.value) return;
  const candidate = normalizeLocalApiToken(token.value);
  token.value = candidate;
  error.value = "";
  verified.value = false;

  if (candidate.length < 32 || /\s/.test(candidate)) {
    error.value = "รูปแบบ Token ไม่ถูกต้อง: ต้องเป็นรหัสยาวอย่างน้อย 32 ตัวอักษรและไม่มีช่องว่าง";
    return;
  }

  loading.value = true;
  try {
    // Verify the newly entered token directly, BEFORE saving it or reconnecting
    // Socket.IO. Don't use api() here: it reads the previously saved token.
    const response = await fetch(base + "/v1/runtime/health", {
      headers: { Authorization: `Bearer ${candidate}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    if (response.status === 401) {
      throw new Error(
        "Backend ปฏิเสธ Token (HTTP 401) — กรุณาใช้ LOCAL_API_TOKEN ที่ Container API กำลังใช้อยู่",
      );
    }
    if (!response.ok) {
      throw new Error(`ตรวจสอบ Token ไม่สำเร็จ: Backend HTTP ${response.status}`);
    }
    const health = await response.json();
    localStorage.setItem("companion-api-token", candidate);
    runtime.value = health;
    verified.value = true;
  } catch (e) {
    runtime.value = {};
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
  if (!verified.value) return;

  voice.cancel();
  chat.stop();
  await chat.init();
  await voice.checkHealth();
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
    <section class="modal" role="dialog" aria-modal="true" aria-label="การเชื่อมต่อและ Desktop">
      <div class="modal-title">
        <h2>การเชื่อมต่อและ Desktop</h2>
        <button @click="open = false">×</button>
      </div>
      <p>วาง LOCAL_API_TOKEN จาก apps/api/.env หรือค่าจาก Backend Container</p>
      <p class="muted small">ตรวจสอบ Token กับ Backend ก่อนบันทึก รองรับการวางทั้งรหัสและบรรทัด LOCAL_API_TOKEN=...</p>
      <form @submit.prevent="pair">
        <label>Local API token
          <input v-model="token" type="password" autocomplete="off" autocapitalize="off"
            spellcheck="false" aria-label="Local API token" />
        </label>
        <button class="primary" :disabled="chat.busy || voice.active || loading">
          {{ loading ? "กำลังตรวจสอบ..." : "ตรวจสอบ Token และเชื่อมต่อ" }}
        </button>
      </form>
      <p v-if="verified" role="status" class="muted">✓ Token ถูกต้อง — Backend ยืนยันแล้ว</p>
      <h3>บริการบนเครื่อง</h3>
      <p v-for="name in ['backend', 'database', 'ollama', 'localai', 'voice']" :key="name">
        {{ name }}: <strong>{{ runtime[name]?.status ?? "unknown" }}</strong>
      </p>
      <p class="muted small">
        เปิด NestJS, PostgreSQL และ AI backend ที่เลือก (Ollama/LocalAI)
        รวมถึง FastAPI ถ้าใช้เสียงแบบเดิม แอปไม่เปิดบริการให้อัตโนมัติ
      </p>
      <button @click="refresh" :disabled="loading">ตรวจใหม่</button>
      <template v-if="desktop">
        <h3>หน้าต่างตัวละคร</h3>
        <button @click="run('show')">แสดง / คลิกได้</button>
        <button @click="run('reset')">คืนตำแหน่งกลางจอ</button>
        <p>โหมด: {{ native.clickThrough ? "คลิกทะลุ" : "โต้ตอบได้" }}</p>
        <label><input type="checkbox" :checked="native.autostart" @change="auto" />
          เปิดแอปเมื่อเข้าสู่ระบบ (ไม่เปิดไมโครโฟน)</label>
        <p class="small">Ctrl+Alt+Y แสดง · Ctrl+Alt+M แชต · Ctrl+Alt+H ซ่อน</p>
        <p v-for="warning in native.warnings" class="error">{{ warning }}</p>
      </template>
      <p v-if="error" role="alert" class="error">{{ error }}</p>
    </section>
  </div>
</template>
