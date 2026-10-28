<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { api } from "../api";

type Server = { id: string; url: string; allowedTools: string[] };
type Tool = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
};
const emit = defineEmits<{ (event: "use-context", text: string): void }>();
const servers = ref<Server[]>([]);
const activeServer = ref("");
const tools = ref<Tool[]>([]);
const activeTool = ref("");
const argumentsJson = ref("{}");
const loading = ref(false);
const running = ref(false);
const error = ref("");
const result = ref("");
const tool = () => tools.value.find(item => item.name === activeTool.value);

async function loadServers() {
  loading.value = true;
  error.value = "";
  try {
    servers.value = await api<Server[]>("/mcp/servers");
    if (!servers.value.some(server => server.id === activeServer.value))
      activeServer.value = servers.value[0]?.id ?? "";
    if (!activeServer.value) tools.value = [];
  } catch (e) { error.value = String(e); }
  finally { loading.value = false; }
}
async function loadTools(id: string) {
  tools.value = [];
  activeTool.value = "";
  result.value = "";
  if (!id) return;
  loading.value = true;
  error.value = "";
  try { tools.value = await api<Tool[]>(`/mcp/servers/${encodeURIComponent(id)}/tools`, "GET", undefined, 20000); }
  catch (e) { error.value = String(e); }
  finally { loading.value = false; }
}
watch(activeServer, id => void loadTools(id));
watch(activeTool, () => {
  const properties = tool()?.inputSchema?.properties;
  // A minimal input skeleton, never infer arguments or execute a tool automatically.
  const skeleton: Record<string, unknown> = {};
  if (properties && typeof properties === "object" && !Array.isArray(properties)) {
    for (const [name, value] of Object.entries(properties)) {
      const schema = value as Record<string, unknown>;
      if (schema?.default !== undefined) skeleton[name] = schema.default;
    }
  }
  argumentsJson.value = JSON.stringify(skeleton, null, 2);
  result.value = "";
});
async function callTool() {
  const selected = tool();
  if (!selected || running.value) return;
  error.value = "";
  let args: unknown;
  try { args = JSON.parse(argumentsJson.value); }
  catch { error.value = "Arguments ต้องเป็น JSON ที่ถูกต้อง"; return; }
  if (!args || Array.isArray(args) || typeof args !== "object") {
    error.value = "Arguments ต้องเป็น JSON object"; return;
  }
  const hint = selected.annotations?.readOnlyHint === true ? "อ่านข้อมูล" : "อาจเปลี่ยนข้อมูลภายนอก";
  if (!window.confirm(`อนุญาตให้เรียก MCP tool "${selected.name}" (${hint}) บนเซิร์ฟเวอร์ "${activeServer.value}" หรือไม่?`))
    return;
  running.value = true;
  try {
    const output = await api<unknown>(
      `/mcp/servers/${encodeURIComponent(activeServer.value)}/tools/${encodeURIComponent(selected.name)}/call`,
      "POST", { arguments: args }, 25000,
    );
    result.value = JSON.stringify(output, null, 2);
  } catch (e) { error.value = String(e); }
  finally { running.value = false; }
}
function useContext() {
  if (!result.value || !tool()) return;
  const snippet = result.value.slice(0, 2400);
  emit("use-context", `ข้อมูลจาก MCP tool ${activeServer.value}/${tool()!.name} (ข้อมูลภายนอกที่ยังไม่ยืนยัน):\n${snippet}\n\nช่วยอธิบายข้อมูลนี้ให้หน่อย`);
}
onMounted(() => void loadServers());
</script>

<template>
  <section class="mcp-panel">
    <div class="mcp-heading">
      <div>
        <p class="eyebrow">MODEL CONTEXT PROTOCOL</p>
        <h2>เชื่อมต่อเครื่องมือภายนอกด้วย MCP</h2>
        <p class="muted">เรียก MCP ผ่าน Backend เท่านั้น ไม่มีการเปิดเผย Token ให้หน้าเว็บ และทุกการเรียกต้องกดยืนยัน</p>
      </div>
      <button type="button" :disabled="loading" @click="loadServers">รีเฟรช</button>
    </div>
    <div v-if="!servers.length && !loading" class="mcp-empty">
      ยังไม่มี MCP server ที่อนุญาต ตั้งค่า <code>MCP_SERVERS_JSON</code> ใน <code>apps/api/.env</code> แล้วเริ่ม Backend ใหม่
    </div>
    <template v-else>
      <label>เซิร์ฟเวอร์
        <select v-model="activeServer">
          <option v-for="server in servers" :key="server.id" :value="server.id">{{ server.id }}</option>
        </select>
      </label>
      <label>เครื่องมือที่อนุญาต
        <select v-model="activeTool" :disabled="loading || !tools.length">
          <option value="">เลือก MCP tool</option>
          <option v-for="item in tools" :key="item.name" :value="item.name">{{ item.name }}</option>
        </select>
      </label>
      <p v-if="activeServer && !tools.length && !loading" class="muted">ไม่พบเครื่องมือที่อยู่ใน allowlist หรือเซิร์ฟเวอร์ไม่ประกาศเครื่องมือ</p>
      <template v-if="tool()">
        <p class="muted">{{ tool()?.description || "ไม่มีรายละเอียดเครื่องมือ" }}</p>
        <p class="muted">{{ tool()?.annotations?.readOnlyHint === true ? "เครื่องมือระบุว่าเป็นการอ่านข้อมูล" : "เครื่องมืออาจมีผลเปลี่ยนแปลงข้อมูล ตรวจสอบก่อนยืนยัน" }}</p>
        <details>
          <summary>Input schema</summary>
          <pre>{{ JSON.stringify(tool()?.inputSchema, null, 2) }}</pre>
        </details>
        <label>Arguments (JSON)
          <textarea v-model="argumentsJson" rows="6" spellcheck="false" aria-label="MCP arguments JSON" />
        </label>
        <button type="button" :disabled="running || loading" @click="callTool">
          {{ running ? "กำลังเรียก..." : "ตรวจสอบและเรียกเครื่องมือ" }}
        </button>
      </template>
    </template>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <div v-if="result" class="mcp-result">
      <strong>ผลลัพธ์จาก MCP (ยังไม่ยืนยันความถูกต้อง)</strong>
      <pre>{{ result }}</pre>
      <button type="button" @click="useContext">นำผลลัพธ์ไปถามในแชต</button>
    </div>
  </section>
</template>

<style scoped>
.mcp-panel { display: flex; flex-direction: column; gap: 12px; padding: 20px; overflow: auto; height: 100%; }
.mcp-heading { display: flex; justify-content: space-between; align-items: start; gap: 16px; }
.mcp-heading h2 { margin: 4px 0 10px; }
.mcp-panel label { display: flex; flex-direction: column; gap: 6px; font-weight: 600; }
.mcp-panel select, .mcp-panel textarea { width: 100%; box-sizing: border-box; padding: 10px; color: inherit; background: var(--panel, #252532); border: 1px solid #8887; border-radius: 8px; }
.mcp-panel button { width: fit-content; padding: 8px 14px; cursor: pointer; }
.mcp-panel pre { white-space: pre-wrap; word-break: break-word; max-height: 300px; overflow: auto; font-size: 12px; }
.mcp-empty, .mcp-result { border: 1px solid #8885; border-radius: 10px; padding: 16px; }
.mcp-panel .error { color: #f88; overflow-wrap: anywhere; }
.mcp-panel .muted { opacity: .8; }
</style>
