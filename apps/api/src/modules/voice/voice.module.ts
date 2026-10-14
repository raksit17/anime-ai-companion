import { Module } from "@nestjs/common";
import { VoiceController } from "./voice.controller";
import { VoiceService } from "./voice.service";
import { ResourceModule } from "../../resources";
@Module({
  imports: [ResourceModule],
  controllers: [VoiceController],
  providers: [VoiceService],
})
export class VoiceModule {}
