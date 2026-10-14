import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { io } from "socket.io-client";
const { LocalAuthGuard, validToken, allowedOrigins } = require("../dist/auth");
const { RuntimeController } = require("../dist/runtime.controller");
const { Database } = require("../dist/database");
const { ChatGateway } = require("../dist/chat.gateway");
const { OllamaService } = require("../dist/ai/ollama.service");
const { ResourceGate } = require("../dist/resources");
@Module({
  controllers: [RuntimeController],
  providers: [
    ChatGateway,
    ResourceGate,
    {
      provide: Database,
      useValue: {
        $queryRawUnsafe: async () => {
          throw new Error("offline");
        },
      },
    },
    { provide: OllamaService, useValue: {} },
  ],
})
class TestModule {}
test("local authentication rejects absent/wrong REST and socket tokens; runtime tolerates offline services", async () => {
  process.env.LOCAL_API_TOKEN = "test-token-" + "x".repeat(40);
  process.env.OLLAMA_URL = "http://127.0.0.1:1";
  process.env.VOICE_SERVICE_URL = "http://127.0.0.1:1";
  assert.equal(validToken(undefined), false);
  assert.equal(validToken("wrong"), false);
  assert.equal(validToken(process.env.LOCAL_API_TOKEN), true);
  assert.ok(allowedOrigins().includes("http://tauri.localhost"));
  assert.ok(!allowedOrigins().includes("*"));
  const app = await NestFactory.create(TestModule, { logger: false });
  app.useGlobalGuards(new LocalAuthGuard());
  try {
    await app.listen(0, "127.0.0.1");
    const base = await app.getUrl();
    assert.equal((await fetch(base + "/v1/runtime/health")).status, 401);
    assert.equal(
      (
        await fetch(base + "/v1/runtime/health", {
          headers: { Authorization: "Bearer wrong" },
        })
      ).status,
      401,
    );
    const good = await fetch(base + "/v1/runtime/health", {
      headers: { Authorization: `Bearer ${process.env.LOCAL_API_TOKEN}` },
    });
    assert.equal(good.status, 200);
    const body: any = await good.json();
    assert.equal(body.backend.status, "ready");
    for (const key of ["database", "ollama", "voice"])
      assert.equal(body[key].status, "offline");
    for (const [token, accepted] of [
      ["bad", false],
      [process.env.LOCAL_API_TOKEN, true],
    ] as const) {
      const socket = io(base + "/chat", {
        auth: { token },
        reconnection: false,
        autoConnect: false,
      });
      try {
        const result = await new Promise<boolean>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error("socket timeout")),
            3000,
          );
          socket.once("connect", () => {
            clearTimeout(timer);
            resolve(true);
          });
          socket.once("connect_error", () => {
            clearTimeout(timer);
            resolve(false);
          });
          socket.connect();
        });
        assert.equal(result, accepted);
      } finally {
        socket.disconnect();
      }
    }
  } finally {
    await app.close();
    delete process.env.LOCAL_API_TOKEN;
  }
});
