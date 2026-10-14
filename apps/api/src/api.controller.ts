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
import { CharacterDto, MemoryDto, ConversationDto } from "./dto";
@Controller("v1")
export class ApiController {
  constructor(@Inject(Database) private db: Database) {}
  @Get("health") async health() {
    await this.db.$queryRaw`SELECT 1`;
    let ollama = "offline";
    try {
      const r = await fetch(`${process.env.OLLAMA_URL}/api/tags`, {
        signal: AbortSignal.timeout(2500),
      });
      if (r.ok) ollama = "online";
    } catch {}
    return {
      status: "ok",
      database: "online",
      ollama,
      model: process.env.OLLAMA_MODEL,
    };
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
