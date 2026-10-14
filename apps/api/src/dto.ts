import type { SendChat } from "@companion/contracts";
import {
  IsString,
  IsNotEmpty,
  MaxLength,
  IsOptional,
  IsInt,
  Min,
  Max,
  IsObject,
  Matches,
  IsUUID,
} from "class-validator";
export class CharacterDto {
  @IsString() @IsNotEmpty() @MaxLength(80) name!: string;
  @IsString() @MaxLength(4000) personality!: string;
  @IsString() @MaxLength(8000) systemPrompt!: string;
  @IsOptional()
  @IsString()
  @Matches(/^\/live2d\/[^?#]*\.model3\.json$/)
  modelPath?: string;
  @IsOptional() @IsObject() expressionMap?: Record<string, string>;
}
export class MemoryDto {
  @IsString() @IsNotEmpty() @MaxLength(1000) content!: string;
  @IsInt() @Min(1) @Max(5) importance!: number;
}
export class ConversationDto {
  @IsString() @IsNotEmpty() characterId!: string;
}
export class SendDto implements SendChat {
  @IsUUID() requestId!: string;
  @IsString() @IsNotEmpty() conversationId!: string;
  @IsString() @IsNotEmpty() @MaxLength(4000) content!: string;
}
