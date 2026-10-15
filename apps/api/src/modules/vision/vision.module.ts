import { Module } from "@nestjs/common";
import { VisionController } from "./vision.controller";
import { LocalAiModule } from "../../ai/localai.module";
import { ResourceModule } from "../../resources";

@Module({ imports: [LocalAiModule, ResourceModule], controllers: [VisionController] })
export class VisionModule {}
