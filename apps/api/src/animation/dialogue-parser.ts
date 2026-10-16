import type { AnimationPlanV1, AnimationSegment, Emotion } from "@companion/contracts";

/**
 * Splits a completed model response into ordered speech / *action* spans.
 * Unclosed markers remain literal speech, so streaming truncation loses no text.
 * Never execute arbitrary motion names supplied by the model.
 */
export function parseDialogue(content: string): AnimationSegment[] {
  const segments: AnimationSegment[] = [];
  let cursor = 0;
  const marker = /(?<!\\)\*([^*\n]{1,240})\*/g;
  let match: RegExpExecArray | null;
  const addSpeech = (value: string) => {
    const text = value.trim();
    if (text) segments.push({ id: "s" + segments.length, type: "speech", text, emotion: "neutral" });
  };
  while ((match = marker.exec(content))) {
    addSpeech(content.slice(cursor, match.index));
    segments.push({
      id: "a" + segments.length, type: "action",
      description: match[1]!.trim(),
      emotion: classifyEmotion(match[1]!), motion: null,
      durationMs: 900,
    });
    cursor = marker.lastIndex;
  }
  addSpeech(content.slice(cursor));
  return segments;
}

export function classifyEmotion(text: string): Emotion {
  if (/โกรธ|โมโห|หงุดหงิด|หน้าบึ้ง|angry/i.test(text)) return "angry";
  if (/เขิน|หน้าแดง|หลบตา|shy|blush/i.test(text)) return "shy";
  if (/เศร้า|เสียใจ|ร้องไห้|sad|cry/i.test(text)) return "sad";
  if (/ตกใจ|ประหลาดใจ|surpris/i.test(text)) return "surprised";
  if (/ยิ้ม|หัวเราะ|ดีใจ|ร่าเริง|happy|smile/i.test(text)) return "happy";
  return "neutral";
}

export function buildAnimationPlan(
  messageId: string, characterId: string, content: string, fallback: Emotion,
): AnimationPlanV1 {
  const segments = parseDialogue(content);
  let currentEmotion = fallback;
  for (const segment of segments) {
    if (segment.type === "action") {
      if (segment.emotion !== "neutral") currentEmotion = segment.emotion ?? currentEmotion;
      // Motion remains null until model-specific capabilities are verified.
    } else {
      segment.emotion = currentEmotion;
    }
  }
  return { version: 1, messageId, characterId, segments };
}
