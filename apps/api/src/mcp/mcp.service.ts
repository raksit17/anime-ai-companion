import { BadGatewayException, BadRequestException, Injectable, NotFoundException } from "@nestjs/common";

/** Explicit, backend-only allowlist. Never accept MCP endpoints or secrets from a chat message. */
export type McpServerConfig = {
  id: string;
  url: string;
  allowedTools: string[];
  tokenEnv?: string;
};
export type McpTool = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
};
type RpcResponse = {
  jsonrpc: string;
  id?: number;
  result?: any;
  error?: { code: number; message: string };
};
type Session = { version: string; sessionId?: string };
const VERSION = "2025-11-25";
const MAX_RESPONSE = 1024 * 1024;
const MAX_ARGUMENTS = 48 * 1024;
const CLIENT = { name: "anime-ai-companion", version: "1.0.0" };

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function configuredMcpServers(raw = process.env.MCP_SERVERS_JSON ?? "[]"): McpServerConfig[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BadRequestException("MCP_SERVERS_JSON must be valid JSON");
  }
  if (!Array.isArray(parsed) || parsed.length > 12)
    throw new BadRequestException("MCP_SERVERS_JSON must contain at most 12 servers");
  const names = new Set<string>();
  return parsed.map((entry: unknown): McpServerConfig => {
    if (!isRecord(entry) ||
        typeof entry.id !== "string" || !/^[a-z][a-z0-9_-]{0,39}$/.test(entry.id) ||
        typeof entry.url !== "string" ||
        !Array.isArray(entry.allowedTools) || entry.allowedTools.length > 60 ||
        entry.allowedTools.some((tool: unknown) => typeof tool !== "string" ||
          !/^[a-zA-Z0-9_.:/-]{1,120}$/.test(tool)) ||
        (entry.tokenEnv !== undefined && (typeof entry.tokenEnv !== "string" ||
          !/^[A-Z][A-Z0-9_]{0,79}$/.test(entry.tokenEnv))))
      throw new BadRequestException("Invalid MCP server config: id, url, allowedTools, tokenEnv");
    if (names.has(entry.id)) throw new BadRequestException("Duplicate MCP server id");
    names.add(entry.id);
    let url: URL;
    try { url = new URL(entry.url); }
    catch { throw new BadRequestException("Invalid MCP server URL"); }
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.username || url.password || url.hash || url.search ||
        (url.protocol !== "https:" && !(url.protocol === "http:" &&
          (loopback || process.env.MCP_ALLOW_INSECURE_HTTP === "true"))))
      throw new BadRequestException("MCP URL must use HTTPS or explicitly trusted local HTTP");
    return { id: entry.id, url: url.toString(), allowedTools: [...new Set(entry.allowedTools)],
      ...(entry.tokenEnv ? { tokenEnv: entry.tokenEnv } : {}) };
  });
}

async function readLimited(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let body = "", bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_RESPONSE) throw new BadGatewayException("MCP response exceeds 1 MiB");
      body += decoder.decode(chunk.value, { stream: true });
    }
    return body + decoder.decode();
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function decodeRpc(body: string, contentType: string, expectedId: number): RpcResponse {
  let candidates: unknown[] = [];
  try {
    if (contentType.includes("text/event-stream")) {
      const blocks = body.replace(/\r\n/g, "\n").split(/\n\n/);
      for (const block of blocks) {
        const data = block.split("\n")
          .filter(line => line.startsWith("data:"))
          .map(line => line.slice(5).trimStart()).join("\n");
        if (data) candidates.push(JSON.parse(data));
      }
    } else if (contentType.includes("application/json")) {
      candidates = [JSON.parse(body)];
    } else {
      throw new Error("Unsupported MCP response content-type");
    }
  } catch {
    throw new BadGatewayException("MCP returned invalid JSON-RPC or SSE");
  }
  const value = candidates.find(x => isRecord(x) &&
    x.jsonrpc === "2.0" && x.id === expectedId) as RpcResponse | undefined;
  if (!value) throw new BadGatewayException("MCP response did not match request ID");
  if (value.error) throw new BadGatewayException("MCP tool error: " +
    String(value.error.message).slice(0, 200));
  if (!Object.prototype.hasOwnProperty.call(value, "result"))
    throw new BadGatewayException("MCP response has no result");
  return value;
}

/** Streamable HTTP MCP (2025-11-25). REST remains the browser-facing transport. */
@Injectable()
export class McpService {
  private sessions = new Map<string, Promise<Session>>();
  private requestId = 0;

  servers() {
    return configuredMcpServers().map(({ id, url, allowedTools }) =>
      ({ id, url, allowedTools }));
  }

  private server(id: string): McpServerConfig {
    const server = configuredMcpServers().find(server => server.id === id);
    if (!server) throw new NotFoundException("MCP server not configured");
    return server;
  }

  private async post(
    server: McpServerConfig, message: Record<string, unknown>, signal: AbortSignal,
    session?: Session,
  ): Promise<{ response: Response; body: string }> {
    const token = server.tokenEnv ? process.env[server.tokenEnv] : undefined;
    if (server.tokenEnv && !token)
      throw new BadRequestException("MCP credential environment variable is missing");
    let response: Response;
    try {
      response = await fetch(server.url, {
        method: "POST", redirect: "error", signal,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(session ? { "MCP-Protocol-Version": session.version } : {}),
          ...(session?.sessionId ? { "Mcp-Session-Id": session.sessionId } : {}),
        },
        body: JSON.stringify(message),
      });
    } catch (e) {
      if (signal.aborted) throw e;
      throw new BadGatewayException("MCP server unreachable or refused redirect");
    }
    const body = await readLimited(response);
    if (!response.ok) {
      if (response.status === 404 && session?.sessionId)
        throw new ExpiredMcpSession();
      throw new BadGatewayException(`MCP server HTTP ${response.status}`);
    }
    return { response, body };
  }

  private async initialize(server: McpServerConfig, signal: AbortSignal): Promise<Session> {
    const id = ++this.requestId;
    const message = {
      jsonrpc: "2.0", id, method: "initialize",
      params: { protocolVersion: VERSION, capabilities: {}, clientInfo: CLIENT },
    };
    const { response, body } = await this.post(server, message, signal);
    const result = decodeRpc(body, response.headers.get("content-type") ?? "", id).result;
    if (!isRecord(result) || typeof result.protocolVersion !== "string" ||
        !["2025-11-25", "2025-06-18", "2025-03-26"].includes(result.protocolVersion))
      throw new BadGatewayException("MCP server negotiated an unsupported protocol");
    const session: Session = {
      version: result.protocolVersion,
      ...(response.headers.get("mcp-session-id")
        ? { sessionId: response.headers.get("mcp-session-id")! } : {}),
    };
    await this.post(server, { jsonrpc: "2.0", method: "notifications/initialized" },
      signal, session);
    return session;
  }

  private getSession(server: McpServerConfig, signal: AbortSignal): Promise<Session> {
    const existing = this.sessions.get(server.id);
    if (existing) return existing;
    const pending = this.initialize(server, signal);
    this.sessions.set(server.id, pending);
    void pending.catch(() => {
      if (this.sessions.get(server.id) === pending) this.sessions.delete(server.id);
    });
    return pending;
  }

  private async rpc(server: McpServerConfig, method: string,
    params: Record<string, unknown>, signal: AbortSignal) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const session = await this.getSession(server, signal);
      const id = ++this.requestId;
      try {
        const { response, body } = await this.post(server,
          { jsonrpc: "2.0", id, method, params }, signal, session);
        return decodeRpc(body, response.headers.get("content-type") ?? "", id).result;
      } catch (e) {
        if (e instanceof ExpiredMcpSession && attempt === 0) {
          this.sessions.delete(server.id);
          continue; // 404 means the server rejected the expired session.
        }
        throw e;
      }
    }
    throw new BadGatewayException("MCP session could not be established");
  }

  async tools(serverId: string): Promise<McpTool[]> {
    const server = this.server(serverId);
    if (!server.allowedTools.length) return [];
    const signal = AbortSignal.timeout(15000);
    const collected: McpTool[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const result = await this.rpc(server, "tools/list",
        cursor ? { cursor } : {}, signal);
      if (!isRecord(result) || !Array.isArray(result.tools))
        throw new BadGatewayException("MCP tools/list returned an invalid result");
      for (const item of result.tools) {
        if (!isRecord(item) || typeof item.name !== "string" ||
            !server.allowedTools.includes(item.name) || seen.has(item.name)) continue;
        seen.add(item.name);
        collected.push({
          name: item.name,
          description: typeof item.description === "string"
            ? item.description.slice(0, 1200) : undefined,
          inputSchema: isRecord(item.inputSchema) ? item.inputSchema : { type: "object" },
          annotations: isRecord(item.annotations) ? item.annotations : undefined,
        });
      }
      if (typeof result.nextCursor !== "string" || !result.nextCursor) return collected;
      cursor = result.nextCursor;
    }
    throw new BadGatewayException("MCP tools/list exceeded pagination limit");
  }

  async call(serverId: string, toolName: string,
    args: Record<string, unknown>): Promise<unknown> {
    const server = this.server(serverId);
    if (!server.allowedTools.includes(toolName))
      throw new BadRequestException("MCP tool is not allowlisted");
    if (!isRecord(args) || JSON.stringify(args).length > MAX_ARGUMENTS)
      throw new BadRequestException("MCP arguments must be an object smaller than 48 KiB");
    // Prevent calling an allowlisted but no longer advertised tool.
    const available = await this.tools(serverId);
    if (!available.some(tool => tool.name === toolName))
      throw new NotFoundException("MCP tool is not advertised by its server");
    const result = await this.rpc(server, "tools/call",
      { name: toolName, arguments: args }, AbortSignal.timeout(20000));
    if (!isRecord(result) || !Array.isArray(result.content))
      throw new BadGatewayException("MCP tools/call returned an invalid result");
    return result;
  }
}

class ExpiredMcpSession extends Error {}
