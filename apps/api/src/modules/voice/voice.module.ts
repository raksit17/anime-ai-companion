import { Module } from "@nestjs/common";
import { VoiceController } from "./voice.controller";
import { VoiceService } from "./voice.service";
import { MossVoiceClient } from "./moss-voice.client";
import { ResourceModule } from "../../resources";
import { LocalAiModule } from "../../ai/localai.module";
@Module({
  imports: [ResourceModule, LocalAiModule],
  controllers: [VoiceController],
  providers: [VoiceService, MossVoiceClient],
})
export class VoiceModule {}
