import { Global, Module } from "@nestjs/common";
import { LocalAiService } from "./localai.service";

@Global()
@Module({ providers: [LocalAiService], exports: [LocalAiService] })
export class LocalAiModule {}
