import {
  IsIn,
  IsString,
  MaxLength,
  Matches,
  IsOptional,
  IsBoolean,
} from "class-validator";
export class SynthesizeDto {
  @IsString() @Matches(/\S/) @MaxLength(350) text!: string;
  @IsOptional() @IsIn(["th", "ja", "en"]) language: "th" | "ja" | "en" = "th";
  @IsOptional() @IsBoolean() streaming: boolean = false;
}
export class TranscribeDto {
  @IsOptional() @IsIn(["auto", "th", "ja", "en"]) language: string = "auto";
}
