// Paste-friendly pairing: accept either the raw value or a LOCAL_API_TOKEN= line.
// Some phone clipboard/keyboard apps add invisible formatting characters.
export function normalizeLocalApiToken(input: string): string {
  return input
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .trim()
    .replace(/^LOCAL_API_TOKEN\s*=\s*/i, "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .trim();
}

export function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("companion-api-token") ?? "";
  return token ? { Authorization: `Bearer ${token}` } : {};
}
