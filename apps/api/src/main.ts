import "reflect-metadata";
import "dotenv/config";
import { LocalAuthGuard, allowedOrigins } from "./auth";
import { RuntimeController } from "./runtime.controller";
import { VoiceModule } from "./modules/voice/voice.module";
import { ResourceModule } from "./resources";
import {
  Module,
  ValidationPipe,
  Catch,
  ArgumentsHost,
  ExceptionFilter,
  HttpException,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { Database } from "./database";
import { ApiController } from "./api.controller";
import { ChatGateway } from "./chat.gateway";
import { OllamaService } from "./ai/ollama.service";
import { LocalAiModule } from "./ai/localai.module";
import { VisionModule } from "./modules/vision/vision.module";
@Catch()
class ApiErrors implements ExceptionFilter {
  catch(e: any, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse();
    const status =
      e instanceof HttpException
        ? e.getStatus()
        : e.code === "P2025" || e.code === "P2003"
          ? 404
          : 500;
    response.status(status).json({
      message:
        status === 500
          ? "Database/server error"
          : e instanceof HttpException
            ? e.getResponse()
            : "Record not found",
    });
  }
}
@Module({
  imports: [ResourceModule, LocalAiModule, VoiceModule, VisionModule],
  controllers: [ApiController, RuntimeController],
  providers: [Database, ChatGateway, OllamaService],
})
class AppModule {}
async function bootstrap() {
  if ((process.env.LOCAL_API_TOKEN ?? "").length < 32)
    throw new Error("Run npm run setup to create LOCAL_API_TOKEN");
  const app = await NestFactory.create(AppModule);
  app.useGlobalGuards(new LocalAuthGuard());
  app.enableCors({ origin: allowedOrigins() });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalFilters(new ApiErrors());
  app.enableShutdownHooks();
  await app.listen(
    Number(process.env.PORT ?? 3001),
    process.env.HOST ?? "127.0.0.1",
  );
}
bootstrap().catch((e) => {
  console.error(e);
  process.exit(1);
});
