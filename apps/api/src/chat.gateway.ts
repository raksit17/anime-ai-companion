import { validToken, allowedOrigins } from "./auth";
import type { Namespace } from "socket.io";
import { ResourceGate } from "./resources";
import { Inject } from "@nestjs/common";
import {
  WebSocketGateway,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
  OnGatewayDisconnect,
} from "@nestjs/websockets";
import { Socket } from "socket.io";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { Database } from "./database";
import { OllamaService } from "./ai/ollama.service";
import { buildPrompt } from "./ai/prompt-builder";
import { normalizeThaiFeminineEnding } from "./ai/text-style";
import { SendDto } from "./dto";
import { buildAnimationPlan } from "./animation/dialogue-parser";
@WebSocketGateway({
  namespace: "/chat",
  cors: { origin: allowedOrigins() },
})
export class ChatGateway implements OnGatewayDisconnect {
  private active = new Map<
    string,
    { socketId: string; requestId: string; abort: AbortController }
  >();
  constructor(
    @Inject(Database) private db: Database,
    @Inject(OllamaService) private ai: OllamaService,
    @Inject(ResourceGate) private gate: ResourceGate = new ResourceGate(),
  ) {}
  afterInit(server: Namespace) {
    server.use((socket, next) =>
      next(
        validToken(socket.handshake.auth?.token)
          ? undefined
          : new Error("Unauthorized: check Local API token"),
      ),
    );
  }
  handleDisconnect(socket: Socket) {
    for (const task of this.active.values())
      if (task.socketId === socket.id) task.abort.abort();
  }
  @SubscribeMessage("chat:stop") stop(
    @ConnectedSocket() socket: Socket,
    @MessageBody() data: any,
  ) {
    for (const task of this.active.values())
      if (task.socketId === socket.id && task.requestId === data?.requestId)
        task.abort.abort();
  }
  @SubscribeMessage("chat:send") async send(
    @ConnectedSocket() socket: Socket,
    @MessageBody() raw: any,
  ) {
    const dto = plainToInstance(SendDto, raw ?? {});
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    const event = {
      requestId: typeof raw?.requestId === "string" ? raw.requestId : "",
      conversationId:
        typeof raw?.conversationId === "string" ? raw.conversationId : "",
    };
    const emit = (name: string, data: object = {}) =>
      socket.emit(name, { ...event, ...data });
    if (errors.length || !dto.content?.trim()) {
      emit("chat:error", { error: "ข้อความหรือ requestId ไม่ถูกต้อง" });
      return;
    }
    if (this.active.has(dto.conversationId)) {
      emit("chat:error", { error: "ห้องนี้กำลังสร้างคำตอบอยู่" });
      return;
    }
    const abort = new AbortController();
    this.active.set(dto.conversationId, {
      socketId: socket.id,
      requestId: dto.requestId,
      abort,
    });
    let content = "",
      savedUser = false;
    let release: (() => void) | undefined;
    const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(300000)]);
    try {
      release = await this.gate.acquire(signal);
      const conv = await this.db.conversation.findUnique({
        where: { id: dto.conversationId },
        include: { character: true },
      });
      if (!conv) throw new Error("ไม่พบห้องสนทนา");
      const duplicate = await this.db.message.findFirst({
        where: { conversationId: conv.id, requestId: dto.requestId },
      });
      if (duplicate) throw new Error("คำขอนี้ถูกบันทึกแล้ว กรุณาโหลดประวัติ");
      const englishContent = await this.ai.translateToEnglish(
        dto.content.trim(),
        signal,
      );
      await this.db.message.create({
        data: {
          conversationId: conv.id,
          role: "user",
          content: dto.content.trim(),
          englishContent,
          requestId: dto.requestId,
        },
      });
      savedUser = true;
      await this.db.conversation.update({
        where: { id: conv.id },
        data: {
          title: conv.title ?? dto.content.trim().slice(0, 60),
          updatedAt: new Date(),
        },
      });
      emit("chat:start");
      const history = await this.db.message.findMany({
        where: { conversationId: conv.id, status: "complete" },
        orderBy: { createdAt: "desc" },
        take: 16,
      });
      for (const previous of history) {
        if (!previous.englishContent) {
          const englishReply = previous.content.match(
            /English:\s*([\s\S]*?)\n\s*Thai translation:/i,
          )?.[1]?.trim();
          const source = englishReply ?? previous.content;
          previous.englishContent = /[\u0e00-\u0e7f]/.test(source)
            ? await this.ai.translateToEnglish(source, signal)
            : source;
          await this.db.message.update({
            where: { id: previous.id },
            data: { englishContent: previous.englishContent },
          });
        }
      }
      const memories = await this.db.memory.findMany({
        where: { characterId: conv.characterId },
        orderBy: { importance: "desc" },
        take: 8,
      });
      const translateThai = (value: string) =>
        /[\u0e00-\u0e7f]/.test(value)
          ? this.ai.translateToEnglish(value, signal)
          : Promise.resolve(value);
      const personality = await translateThai(conv.character.personality);
      const characterPrompt = await translateThai(conv.character.systemPrompt);
      const translatedMemories = [];
      for (const memory of memories)
        translatedMemories.push(await translateThai(memory.content));

      for await (const delta of this.ai.stream(
        buildPrompt(
          { ...conv.character, personality, systemPrompt: characterPrompt },
          translatedMemories.map((content) => ({ content })),
          history.reverse(),
        ),
        signal,
      )) {
        content += delta;
        emit("chat:delta", { delta });
      }
      if (!content.trim()) throw new Error("โมเดลตอบข้อความว่าง");
      content = normalizeThaiFeminineEnding(content);
      const assistantEnglishContent = content.match(
        /English:\s*([\s\S]*?)\n\s*Thai translation:/i,
      )?.[1]?.trim();
      const emotion = await this.ai.emotion(dto.content.trim(), content, signal);
      signal.throwIfAborted();
      const message = await this.db.message.create({
        data: {
          conversationId: conv.id,
          role: "assistant",
          content,
          englishContent: assistantEnglishContent ?? content,
          emotion,
          requestId: dto.requestId,
        },
      });
      emit("chat:emotion", { emotion });
      const animationPlan = buildAnimationPlan(message.id, conv.characterId, content, emotion);
      const { englishContent: _englishContent, ...publicMessage } = message;
      emit("chat:complete", { message: { ...publicMessage, animationPlan }, emotion });
    } catch (error) {
      if (savedUser && content) {
        try {
          await this.db.message.create({
            data: {
              conversationId: dto.conversationId,
              role: "assistant",
              content,
              status: "interrupted",
              requestId: dto.requestId,
            },
          });
        } catch {}
      }
      emit("chat:error", {
        error: abort.signal.aborted
          ? "หยุดคำตอบแล้ว"
          : error instanceof Error
            ? error.message
            : "เกิดข้อผิดพลาด",
        content,
      });
    } finally {
      release?.();
      this.active.delete(dto.conversationId);
    }
  }
}
