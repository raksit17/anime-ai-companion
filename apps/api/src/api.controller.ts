import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  NotFoundException,
} from "@nestjs/common";
import { Database } from "./database";
import { localAiEnabled } from "./ai/localai.service";
import { CharacterDto, MemoryDto, ConversationDto } from "./dto";
@Controller("v1")
export class ApiController {
  constructor(@Inject(Database) private db: Database) {}
  @Get("health") async health() {
    await this.db.$queryRaw`SELECT 1`;
    const provider = localAiEnabled() ? "localai" : "ollama";
    const model = localAiEnabled() ? (process.env.LOCALAI_CHAT_MODEL ?? "qwen3-4b") : (process.env.OLLAMA_MODEL ?? "qwen3.5:4b-q4_K_M");
    let status = "offline";
    try {
      const url = localAiEnabled()
        ? (process.env.LOCALAI_URL ?? "http://127.0.0.1:8080") + "/v1/models"
        : (process.env.OLLAMA_URL ?? "http://127.0.0.1:11434") + "/api/tags";
      const response = await fetch(url, {
        headers: localAiEnabled() && process.env.LOCALAI_API_KEY ? { Authorization: `Bearer ${process.env.LOCALAI_API_KEY}` } : {},
        signal: AbortSignal.timeout(2500),
      });
      if (response.ok) status = "online";
    } catch {}
    return { status: "ok", database: "online", provider, model,
      ollama: provider === "ollama" ? status : "not selected",
      localai: provider === "localai" ? status : "not selected" };
  }
  @Get("characters") characters() {
    return this.db.character.findMany({ orderBy: { createdAt: "asc" } });
  }
  @Post("characters") create(@Body() body: CharacterDto) {
    return this.db.character.create({ data: body });
  }
  @Patch("characters/:id") update(
    @Param("id") id: string,
    @Body() body: CharacterDto,
  ) {
    return this.db.character.update({
      where: { id },
      data: { ...body, modelPath: body.modelPath ?? null },
    });
  }
  @Delete("characters/:id") deleteCharacter(@Param("id") id: string) {
    return this.db.character.delete({ where: { id } });
  }
  @Post("conversations") createConversation(@Body() body: ConversationDto) {
    return this.db.conversation.create({ data: body });
  }
  @Get("conversations") conversations(
    @Query("characterId") characterId: string,
  ) {
    return this.db.conversation.findMany({
      where: { characterId },
      orderBy: { updatedAt: "desc" },
      take: 100,
    });
  }
  @Get("conversations/:id/messages") async messages(@Param("id") id: string) {
    if (!(await this.db.conversation.findUnique({ where: { id } })))
      throw new NotFoundException();
    return this.db.message.findMany({
      where: { conversationId: id },
      orderBy: { createdAt: "asc" },
    });
  }
  @Get("characters/:id/memories") memories(@Param("id") characterId: string) {
    return this.db.memory.findMany({
      where: { characterId },
      orderBy: [{ importance: "desc" }, { createdAt: "desc" }],
    });
  }
  @Post("characters/:id/memories") addMemory(
    @Param("id") characterId: string,
    @Body() body: MemoryDto,
  ) {
    return this.db.memory.create({ data: { ...body, characterId } });
  }
  @Patch("memories/:id") editMemory(
    @Param("id") id: string,
    @Body() body: MemoryDto,
  ) {
    return this.db.memory.update({ where: { id }, data: body });
  }
  @Delete("memories/:id") deleteMemory(@Param("id") id: string) {
    return this.db.memory.delete({ where: { id } });
  }
}
