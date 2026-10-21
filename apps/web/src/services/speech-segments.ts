export type AssistantSegment =
  | { type: "speech"; text: string; emotion?: string }
  | { type: "action"; expression?: string; motion?: string };

const emotions = new Set(["neutral", "happy", "angry", "shy", "sad", "surprised"]);

function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Accept an ordered JSON segment envelope; ordinary assistant text stays speech. */
export function parseAssistantSegments(
  content: string,
  fallbackEmotion?: string | null,
): AssistantSegment[] {
  const fallback: AssistantSegment = {
    type: "speech",
    text: content,
    ...(fallbackEmotion && emotions.has(fallbackEmotion)
      ? { emotion: fallbackEmotion }
      : {}),
  };
  const source = content.trim().replace(/^`{3}(?:json)?\s*|\s*`{3}$/g, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return [fallback];
  }
  const values =
    Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray((parsed as any).segments)
        ? (parsed as any).segments
        : null;
  if (!values) return [fallback];

  const segments: AssistantSegment[] = [];
  for (const value of values) {
    if (!value || typeof value !== "object") continue;
    if ((value as any).type === "speech" && isText((value as any).text)) {
      const emotion = (value as any).emotion;
      segments.push({
        type: "speech",
        text: (value as any).text,
        ...(typeof emotion === "string" && emotions.has(emotion)
          ? { emotion }
          : fallbackEmotion && emotions.has(fallbackEmotion)
            ? { emotion: fallbackEmotion }
            : {}),
      });
    } else if ((value as any).type === "action") {
      const action: Extract<AssistantSegment, { type: "action" }> = { type: "action" };
      if (typeof (value as any).expression === "string") action.expression = (value as any).expression;
      if (typeof (value as any).motion === "string") action.motion = (value as any).motion;
      segments.push(action);
    }
  }
  return segments.length ? segments : [fallback];
}

export function assistantDisplayText(content: string): string {
  const segments = parseAssistantSegments(content);
  if (segments.length === 1 && segments[0]?.type === "speech" && segments[0].text === content)
    return content;
  return segments
    .filter((segment): segment is Extract<AssistantSegment, { type: "speech" }> => segment.type === "speech")
    .map((segment) => segment.text)
    .join("\n");
}


/** Extract the selected speech from real model replies using "Thai:" or "Thai translation:". */
export function selectBilingualSpeech(
  content: string,
  preferred: string,
): { text: string; language: "th" | "en" } | null {
  const markers = [...content.matchAll(/^[ \t]*(English|Thai(?: translation)?)[ \t]*[:：][ \t]*/gim)];
  const languageOf = (value: string) => /^english$/i.test(value) ? "en" : "th";
  if (!markers.some((m) => languageOf(m[1]!) === "en") ||
      !markers.some((m) => languageOf(m[1]!) === "th")) return null;
  const language = preferred.toLowerCase().startsWith("th") ? "th" : "en";
  const sections: string[] = [];
  for (let i = 0; i < markers.length; i++) {
    const marker = markers[i]!;
    if (languageOf(marker[1]!) !== language) continue;
    const start = marker.index! + marker[0].length;
    const end = markers[i + 1]?.index ?? content.length;
    sections.push(content.slice(start, end).trim());
  }
  return { text: sections.join("\n").trim(), language };
}

/** Actions between single asterisks belong to Live2D, not the synthesizer. */
export function removeNarratedActions(text: string): string {
  return text.replace(/(?<!\\)\*[^*\r\n]{1,240}\*/g, " ").replace(/[ \t]+/g, " ").trim();
}
