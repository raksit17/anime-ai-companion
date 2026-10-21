import {
  BadRequestException,
  BadGatewayException,
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response, Express } from "express";
import { VoiceService, AUDIO_TYPES } from "./voice.service";
import { SynthesizeDto, TranscribeDto } from "./voice.dto";
function cancellation(res: Response, timeout: number) {
  const abort = new AbortController();
  const close = () => {
    if (!res.writableEnded) abort.abort();
  };
  res.on("close", close);
  return {
    signal: AbortSignal.any([abort.signal, AbortSignal.timeout(timeout)]),
    dispose: () => res.off("close", close),
  };
}
@Controller("v1/voice")
export class VoiceController {
  constructor(@Inject(VoiceService) private voice: VoiceService) {}
  @Get("health") health() {
    return this.voice.health(AbortSignal.timeout(5000));
  }
  @Post("transcribe")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 1 },
    }),
  )
  async transcribe(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: TranscribeDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!file?.size) throw new BadRequestException("Audio required");
    const mime = file.mimetype.split(";")[0]!.toLowerCase();
    if (!AUDIO_TYPES.has(mime))
      throw new BadRequestException("Unsupported audio type");
    const task = cancellation(res, 330000);
    try {
      return await this.voice.transcribe(
        file.buffer,
        mime,
        body.language,
        task.signal,
      );
    } finally {
      task.dispose();
    }
  }
  @Post("synthesize/stream")
  async synthesizeStream(
    @Body() body: SynthesizeDto,
    @Res() res: Response,
  ) {
    const task = cancellation(res, 330000);
    let release = () => {};
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const upstream = await this.voice.openSpeechStream(
        body.text.trim(),
        body.language,
        task.signal,
      );
      release = upstream.release;
      reader = upstream.response.body?.getReader();
      if (!reader) throw new BadGatewayException("MOSS streaming returned no audio data");
      res.status(200);
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("X-Audio-Encoding", "pcm_s16le");
      res.setHeader("X-Sample-Rate", "48000");
      res.setHeader("X-Channels", "1");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Accel-Buffering", "no");
      while (true) {
        task.signal.throwIfAborted();
        const { value, done } = await reader.read();
        if (done) break;
        if (!value?.byteLength) continue;
        if (!res.write(Buffer.from(value))) {
          await new Promise<void>((resolve, reject) => {
            const cleanup = () => {
              res.off("drain", drain);
              res.off("close", close);
            };
            const drain = () => { cleanup(); resolve(); };
            const close = () => { cleanup(); reject(new Error("Client disconnected")); };
            res.once("drain", drain);
            res.once("close", close);
          });
        }
      }
      res.end();
    } catch (error) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      throw error;
    } finally {
      await reader?.cancel().catch(() => undefined);
      release();
      task.dispose();
    }
  }

  @Post("synthesize") async synthesize(
    @Body() body: SynthesizeDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const task = cancellation(res, 330000);
    try {
      const audio = await this.voice.synthesize(
        body.text.trim(),
        body.language,
        task.signal,
        body.streaming,
      );
      res.setHeader("Content-Type", "audio/wav");
      res.setHeader("Cache-Control", "no-store");
      res.send(audio);
    } finally {
      task.dispose();
    }
  }
}
