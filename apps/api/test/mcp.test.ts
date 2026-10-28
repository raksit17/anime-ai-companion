import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
const { McpService, configuredMcpServers } =
  require("../dist/mcp/mcp.service");

async function fakeServer() {
  const requests: { method: string; headers: Record<string, any> }[] = [];
  const http = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk.toString();
    let message: any;
    try { message = JSON.parse(body); }
    catch { res.writeHead(400).end(); return; }
    requests.push({ method: message.method, headers: req.headers });
    if (req.headers.authorization !== "Bearer example-secret") {
      res.writeHead(401).end(); return;
    }
    if (message.method === "initialize") {
      res.writeHead(200, { "Content-Type": "application/json",
        "Mcp-Session-Id": "test-session" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id,
        result: { protocolVersion: "2025-11-25",
          serverInfo: { name: "fake", version: "1" }, capabilities: { tools: {} } } }));
      return;
    }
    if (req.headers["mcp-session-id"] !== "test-session" ||
        req.headers["mcp-protocol-version"] !== "2025-11-25") {
      res.writeHead(400).end(); return;
    }
    if (message.method === "notifications/initialized") {
      res.writeHead(202).end(); return;
    }
    if (message.method === "tools/list") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id,
        result: { tools: [
          { name: "read_status", description: "Inspect the state",
            inputSchema: { type: "object" }, annotations: { readOnlyHint: true } },
          { name: "dangerous", description: "Must not be visible" },
        ] } }));
      return;
    }
    if (message.method === "tools/call") {
      // Use SSE to verify the client handles both legal MCP response formats.
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write('event: message\ndata: ' +
        JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress",
          params: { progress: 1 } }) + '\n\n');
      res.end('event: message\ndata: ' + JSON.stringify({
        jsonrpc: "2.0", id: message.id,
        result: { content: [{ type: "text", text: "healthy" }] },
      }) + '\n\n');
      return;
    }
    res.writeHead(400).end();
  });
  http.listen(0, "127.0.0.1");
  await once(http, "listening");
  const address = http.address();
  if (!address || typeof address === "string") throw Error("Missing test server port");
  return { http, requests, url: `http://127.0.0.1:${address.port}/mcp` };
}

test("MCP validates backend-configured endpoints and explicit tool allowlists", () => {
  assert.deepEqual(configuredMcpServers("[]"), []);
  assert.throws(() => configuredMcpServers("not json"), /MCP_SERVERS_JSON/);
  assert.throws(() => configuredMcpServers(JSON.stringify([
    { id: "external", url: "http://example.com/mcp", allowedTools: [] },
  ])), /HTTPS/);
  assert.throws(() => configuredMcpServers(JSON.stringify([
    { id: "bad", url: "file:///tmp/token", allowedTools: ["read"] },
  ])), /HTTPS/);
  assert.throws(() => configuredMcpServers(JSON.stringify([
    { id: "demo", url: "https://example.com/mcp", allowedTools: ["ok"] },
    { id: "demo", url: "https://example.com/mcp", allowedTools: ["ok"] },
  ])), /Duplicate/);
});

test("MCP negotiates sessions, lists only allowed tools and accepts SSE call results", async () => {
  const oldConfig = process.env.MCP_SERVERS_JSON;
  const oldToken = process.env.TEST_MCP_TOKEN;
  const { http, requests, url } = await fakeServer();
  process.env.TEST_MCP_TOKEN = "example-secret";
  process.env.MCP_SERVERS_JSON = JSON.stringify([
    { id: "demo", url, allowedTools: ["read_status"], tokenEnv: "TEST_MCP_TOKEN" },
  ]);
  try {
    const mcp = new McpService();
    assert.deepEqual(mcp.servers().map((x: any) => x.id), ["demo"]);
    assert.equal(JSON.stringify(mcp.servers()).includes("example-secret"), false);
    const tools = await mcp.tools("demo");
    assert.deepEqual(tools.map((t: any) => t.name), ["read_status"]);
    await assert.rejects(() => mcp.call("demo", "dangerous", {}), /allowlisted/);
    const result: any = await mcp.call("demo", "read_status", {});
    assert.equal(result.content[0].text, "healthy");
    assert.equal(requests.filter(x => x.method === "initialize").length, 1);
    assert.equal(requests.filter(x => x.method === "tools/list").length, 2);
    assert.equal(requests.filter(x => x.method === "tools/call").length, 1);
  } finally {
    await new Promise<void>((resolve, reject) =>
      http.close(error => error ? reject(error) : resolve()));
    if (oldConfig === undefined) delete process.env.MCP_SERVERS_JSON;
    else process.env.MCP_SERVERS_JSON = oldConfig;
    if (oldToken === undefined) delete process.env.TEST_MCP_TOKEN;
    else process.env.TEST_MCP_TOKEN = oldToken;
  }
});
