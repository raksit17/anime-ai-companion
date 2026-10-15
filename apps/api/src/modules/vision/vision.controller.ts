import {
  BadRequestException, Body, Controller, Inject, Post, Res, UploadedFile, UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response, Express } from "express";
import { IsOptional, IsString, MaxLength } from "class-validator";
import { LocalAiService } from "../../ai/localai.service";
import { ResourceGate } from "../../resources";

class VisionDto {
  @IsOptional() @IsString() @MaxLength(500) question?: string;
}

@Controller("v1/vision")
export class VisionController {
  constructor(@Inject(LocalAiService) private ai: LocalAiService, @Inject(ResourceGate) private gate: ResourceGate) {}
  @Post("analyze")
  @UseInterceptors(FileInterceptor("file", {
    limits: { fileSize: 4 * 1024 * 1024, files: 1, fields: 1 },
  }))
  async analyze(@UploadedFile() file: Express.Multer.File, @Body() dto: VisionDto, @Res({ passthrough: true }) res: Response) {
    const mime = file?.mimetype?.split(";")[0]?.toLowerCase() ?? "";
    if (!file?.size || !["image/jpeg", "image/png", "image/webp"].includes(mime))
      throw new BadRequestException("Upload a JPEG, PNG or WebP image (max 4 MB)");
    // Verify image signature rather than trusting browser-controlled MIME.
    const bytes = file.buffer;
    const jpeg = mime === "image/jpeg" && bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
    const png = mime === "image/png" && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    const webp = mime === "image/webp" && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
    if (!jpeg && !png && !webp) throw new BadRequestException("Image data does not match its MIME type");
    const abort = new AbortController();
    const close = () => { if (!res.writableEnded) abort.abort(); };
    res.on("close", close);
    const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(90000)]);
    let release: (() => void) | undefined;
    try {
      release = await this.gate.acquire(signal);
      const description = await this.ai.analyzeImage(bytes, mime as "image/jpeg" | "image/png" | "image/webp", dto.question?.trim() ?? "", signal);
      res.setHeader("Cache-Control", "no-store");
      return { description };
    } finally {
      release?.();
      res.off("close", close);
    }
  }
}
