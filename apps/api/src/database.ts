import { Injectable, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";
@Injectable()
export class Database
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    super({
      adapter: new PrismaPg({
        connectionString: process.env.DATABASE_URL,
        connectionTimeoutMillis: 3000,
        query_timeout: 3000,
      }),
    });
  }
  async onModuleInit() {
    await this.$connect().catch(() =>
      console.warn("Database offline; runtime health remains available"),
    );
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
