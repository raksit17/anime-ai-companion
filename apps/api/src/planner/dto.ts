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
/** Optional 4-day trial window; ordinary long-term planning remains unchanged. */
export class RecommendationDto extends PlanDto {
  @IsOptional() @IsInt() @Min(4) @Max(365) days?: number;
}
export class MoveDto {
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) date!: string;
  @IsInt() @Min(0) @Max(1439) start!: number;
}
export class SwapSessionsDto {
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) date!: string;
  @IsString() @MaxLength(100) @Matches(/^[\w-]+$/) sourceId!: string;
  @IsString() @MaxLength(100) @Matches(/^[\w-]+$/) targetId!: string;
  @IsInt() @Min(0) expectedRevision!: number;
}

/** Rename only this calendar occurrence, not its recurring goal. */
export class RenameSessionDto {
  @IsString() @MaxLength(120) @Matches(/\S/u) name!: string;
  @IsInt() @Min(0) expectedRevision!: number;
}

export class EditSessionTimeDto {
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) date!: string;
  @IsInt() @Min(0) @Max(1439) start!: number;
  @IsInt() @Min(5) @Max(240) duration!: number;
  @IsInt() @Min(0) expectedRevision!: number;
}

export class EventDto extends MoveDto {
  @IsString() @MaxLength(120) @Matches(/\S/) name!: string;
  @IsInt() @Min(5) @Max(720) duration!: number;
}
/** Explicit user report; unknown time is allowed and never fabricated. */
export class PastActivityDto {
  @IsString() @MaxLength(120) @Matches(/\S/u) name!: string;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) date!: string;
  @IsInt() @Min(5) @Max(720) duration!: number;
  @IsOptional() @IsInt() @Min(0) @Max(1439) start?: number;
  @IsOptional() @IsIn(["exact", "estimated"]) accuracy?: "exact" | "estimated";
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
  @IsOptional() @IsString() @Matches(/^[\w-]{1,100}$/) requestId?: string;
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
