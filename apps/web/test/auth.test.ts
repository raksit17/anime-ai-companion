import { afterEach, expect, it, vi } from "vitest";
import { api } from "../src/api";
import { transcribe } from "../src/services/voice.api";
import { normalizeLocalApiToken } from "../src/services/auth";
afterEach(() => vi.unstubAllGlobals());
it("REST and multipart voice requests attach the paired token without breaking multipart boundaries", async () => {
  vi.stubGlobal("localStorage", { getItem: () => "paired-token" });
  const fetcher = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({ text: "hello" }) });
  vi.stubGlobal("fetch", fetcher);
  await api("/characters");
  expect(fetcher.mock.calls[0][1].headers.Authorization).toBe(
    "Bearer paired-token",
  );
  await transcribe(new Blob(["audio"]), "th", new AbortController().signal);
  expect(fetcher.mock.calls[1][1].headers.Authorization).toBe(
    "Bearer paired-token",
  );
  expect(fetcher.mock.calls[1][1].headers["Content-Type"]).toBeUndefined();
});

it("normalizes phone-pasted raw tokens, env lines and invisible clipboard characters", () => {
  const value = "a".repeat(64);
  expect(normalizeLocalApiToken("  " + value + "  ")).toBe(value);
  expect(normalizeLocalApiToken("LOCAL_API_TOKEN=" + value + "\r\n")).toBe(value);
  expect(normalizeLocalApiToken('  LOCAL_API_TOKEN="' + value + '"  ')).toBe(value);
  expect(normalizeLocalApiToken("\u200B" + value + "\u200D")).toBe(value);
});
