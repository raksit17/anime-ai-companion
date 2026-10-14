import { authHeaders } from "./services/auth";
export const base = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
export async function api<T = any>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const r = await fetch(base + "/v1" + path, {
    method,
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
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
