import { Controller, Get, Inject } from "@nestjs/common";
import { Database } from "./database";
import { localAiEnabled, localAiVoiceEnabled } from "./ai/localai.service";
export async function probe(check: () => Promise<unknown>) {
  const start = Date.now();
  try {
    await check();
    return { status: "ready", latencyMs: Date.now() - start };
  } catch {
    return { status: "offline", latencyMs: Date.now() - start };
  }
}
async function http(url: string, headers: Record<string, string> = {}) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error("offline");
  await response.arrayBuffer();
}
@Controller("v1/runtime")
export class RuntimeController {
  constructor(@Inject(Database) private db: Database) {}
  @Get("health") async health() {
    const url = (process.env.LOCALAI_URL ?? "http://127.0.0.1:8080") + "/v1/models";
    const headers: Record<string, string> = process.env.LOCALAI_API_KEY ? { Authorization: `Bearer ${process.env.LOCALAI_API_KEY}` } : {};
    const [database, ollama, localai, voice] = await Promise.all([
      probe(() => this.db.$queryRawUnsafe("SELECT 1")),
      probe(() =>
        http(
          (process.env.OLLAMA_URL ?? "http://127.0.0.1:11434") + "/api/tags",
        ),
      ),
      probe(() => http(url, headers)),
      probe(() => localAiVoiceEnabled() ? http(url, headers) : http((process.env.VOICE_SERVICE_URL ?? "http://127.0.0.1:8000") + "/health")),
    ]);
    return {
      checkedAt: new Date().toISOString(),
      backend: { status: "ready" },
      database,
      ollama,
      localai,
      selectedProvider: localAiEnabled() ? "localai" : "ollama",
      voice,
    };
  }
}
