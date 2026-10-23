import { authHeaders } from "./services/auth";
import { desktop } from "./desktop";

// Docker/mobile: send HTTP and Socket.IO to the same origin as the web page.
// Tauri and Vite development keep the existing localhost:3001 behavior.
// VITE_API_URL remains an explicit override for custom installations.
const configuredApiUrl = import.meta.env.VITE_API_URL?.trim();
export const base = (
  configuredApiUrl ||
  (desktop || import.meta.env.DEV
    ? "http://localhost:3001"
    : window.location.origin)
).replace(/\/+$/, "");
export async function api<T = any>(
  path: string,
  method = "GET",
  body?: unknown,
  timeoutMs = 15000,
): Promise<T> {
  const r = await fetch(base + "/v1" + path, {
    method,
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await r.json();
  if (!r.ok)
    throw new Error(
      typeof data.message === "string"
        ? data.message
        : JSON.stringify(data.message),
    );
  return data;
}
