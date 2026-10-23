import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from "class-validator";
export class GoalDto {
  @IsString() @MaxLength(120) @Matches(/\S/) name!: string;
  @IsInt() @Min(10) @Max(240) duration!: number;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  days!: number[];
  @IsInt() @Min(0) @Max(1439) preferred!: number;
  @IsInt() @Min(1) @Max(3) priority!: number;
  @IsInt() @Min(0) @Max(6) restDays!: number;
  @IsInt() @Min(0) @Max(120) reminder!: number;
  @IsBoolean() flexible!: boolean;
}
export class SettingsDto {
  @IsInt() @Min(0) @Max(1439) wake!: number;
  @IsInt() @Min(1) @Max(1440) sleep!: number;
  @IsInt() @Min(0) @Max(120) breakMinutes!: number;
  @IsInt() @Min(10) @Max(720) maxMinutes!: number;
}
export class PlanDto {
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) date!: string;
  @IsIn(["normal", "low"]) energy!: "normal" | "low";
}
export class MoveDto {
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) date!: string;
  @IsInt() @Min(0) @Max(1439) start!: number;
}
export class EventDto extends MoveDto {
  @IsString() @MaxLength(120) @Matches(/\S/) name!: string;
  @IsInt() @Min(5) @Max(720) duration!: number;
}
export class ProgressDto {
  @IsIn(["done", "skipped"]) status!: "done" | "skipped";
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}
export class AdviceDto {
  @IsString() @Matches(/\S/) @MaxLength(2000) message!: string;
}

export class PlannerChatDto {
  @IsString() @MaxLength(100) characterId!: string;
  @IsString() @MaxLength(100) @Matches(/^[\w-]+$/) requestId!: string;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) date!: string;
  @IsString() @Matches(/\S/) @MaxLength(4000) message!: string;
  @IsBoolean() autoApply!: boolean;
}
