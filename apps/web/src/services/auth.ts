export function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("companion-api-token") ?? "";
  return token ? { Authorization: `Bearer ${token}` } : {};
}
