import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Module, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
// Use tsc output so the same decorator metadata as production is tested.
const { ApiController } = require("../dist/api.controller");
const { Database } = require("../dist/database");
const db = {
  character: { findMany: async () => [{ id: "yuna", name: "Yuna" }] },
};
@Module({
  controllers: [ApiController],
  providers: [{ provide: Database, useValue: db }],
})
class TestModule {}
test("REST routes and DTO validation work with compiled Nest metadata", async () => {
  const app = await NestFactory.create(TestModule, { logger: false });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  try {
    await app.listen(0, "127.0.0.1");
    const base = await app.getUrl();
    const list = await fetch(base + "/v1/characters");
    assert.equal(list.status, 200);
    assert.equal(((await list.json()) as any)[0].name, "Yuna");
    const invalid = await fetch(base + "/v1/characters", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: 42, rogue: true }),
    });
    assert.equal(invalid.status, 400);
  } finally {
    await app.close();
  }
});
