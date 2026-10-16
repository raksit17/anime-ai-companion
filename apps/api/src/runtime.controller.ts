import { Controller, Get, Inject } from "@nestjs/common";
import { Database } from "./database";
export async function probe(check: () => Promise<unknown>) {
  const start = Date.now();
  try {
    await check();
    return { status: "ready", latencyMs: Date.now() - start };
  } catch {
    return { status: "offline", latencyMs: Date.now() - start };
  }
}
async function http(url: string, headers?: HeadersInit) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error("offline");
  await response.arrayBuffer();
}
@Controller("v1/runtime")
export class RuntimeController {
  constructor(@Inject(Database) private db: Database) {}
  @Get("health") async health() {
    const [database, ollama, voice] = await Promise.all([
      probe(() => this.db.$queryRawUnsafe("SELECT 1")),
      probe(() =>
        http(
          (process.env.OLLAMA_URL ?? "http://127.0.0.1:11434") + "/api/tags",
        ),
      ),
      probe(() =>
        process.env.VOICE_TTS_PROVIDER === "moss"
          ? http(
              (process.env.VOICE_STUDIO_URL ?? "http://127.0.0.1:8001").replace(/[/]$/, "") + "/v1/health",
              { "X-API-Key": process.env.VOICE_STUDIO_API_KEY ?? "" },
            )
          : http(
              (process.env.VOICE_SERVICE_URL ?? "http://127.0.0.1:8000") + "/health",
            ),
      ),
    ]);
    return {
      checkedAt: new Date().toISOString(),
      backend: { status: "ready" },
      database,
      ollama,
      voice,
    };
  }
}
