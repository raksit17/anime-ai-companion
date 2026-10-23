import { afterEach, expect, it, vi } from "vitest";
import { generateRequestId } from "../src/services/request-id";

afterEach(() => vi.unstubAllGlobals());

it("uses native randomUUID on a secure origin", () => {
  const native = "2d6aefc3-cf28-4ef0-a189-457c2e51b3c0";
  vi.stubGlobal("crypto", {
    randomUUID: () => native,
    getRandomValues: () => { throw new Error("Should not use fallback"); },
  });
  expect(generateRequestId()).toBe(native);
});

it("uses secure getRandomValues on an HTTP LAN origin without randomUUID", () => {
  vi.stubGlobal("crypto", {
    getRandomValues: (bytes: Uint8Array) => {
      bytes.forEach((_, i) => { bytes[i] = i + 1; });
      return bytes;
    },
  });
  const id = generateRequestId();
  expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(id.length).toBe(36);
});
