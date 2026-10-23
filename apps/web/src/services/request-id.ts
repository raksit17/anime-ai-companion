/**
 * Generate a standards-compliant UUID v4 on HTTPS/localhost and also on an
 * ordinary HTTP LAN origin (e.g. http://192.168.1.21:5175).
 *
 * crypto.randomUUID() is secure-context-only, but getRandomValues() is
 * available on insecure origins too. Never fall back to Math.random().
 */
export function generateRequestId(): string {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40; // RFC 4122 UUID v4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}
