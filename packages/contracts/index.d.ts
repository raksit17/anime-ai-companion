export type Emotion =
  "neutral" | "happy" | "angry" | "shy" | "sad" | "surprised";
export interface MotionMapping {
  group: string;
  index?: number;
}
export type MotionMap = Record<string, MotionMapping>;
export type CharacterState = "idle" | "listening" | "thinking" | "responding" | "speaking";
export interface Character {
  id: string;
  name: string;
  personality: string;
  systemPrompt: string;
  modelPath: string | null;
  expressionMap: Record<string, string> | null;
  motionMap: MotionMap | null;
}
export interface Message {
  id: string;
  role: string;
  content: string;
  emotion: Emotion | null;
  status: string;
  createdAt: string;
  animationPlan?: AnimationPlanV1;
}
export interface Conversation {
  id: string;
  title: string | null;
  characterId: string;
}
export interface Memory {
  id: string;
  content: string;
  importance: number;
}
export interface SendChat {
  requestId: string;
  conversationId: string;
  content: string;
}
export interface ChatEvent {
  requestId: string;
  conversationId: string;
  content?: string;
  delta?: string;
  emotion?: Emotion;
  message?: Message;
  animationPlan?: AnimationPlanV1;
  error?: string;
}

export type AnimationSegment =
  | { id: string; type: "speech"; text: string; emotion: Emotion; lipSync?: boolean }
  | { id: string; type: "action"; description: string; emotion?: Emotion; motion?: { group: string; index?: number } | null; durationMs?: number };
export interface AnimationPlanV1 {
  version: 1;
  messageId: string;
  characterId: string;
  segments: AnimationSegment[];
}
