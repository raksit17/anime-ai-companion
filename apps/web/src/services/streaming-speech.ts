import { speechChunks } from "./speech-chunks";

export interface ReadySpeech {
  text: string;
  language: "en" | "th";
}

/** Separate completed sentences for TTS without waiting for the full AI reply. */
export class StreamingSpeechChunker {
  private raw = "";
  private consumed = 0;

  constructor(private readonly preferred: string) {}

  private section(final = false): ReadySpeech | null {
    const matches = [...this.raw.matchAll(/^[ \t]*(English|Thai(?: translation)?)[ \t]*[:：][ \t]*/gim)];
    let language: "en" | "th" =
      this.preferred.toLowerCase().startsWith("th") ? "th" : "en";
    let body = this.raw;

    if (matches.length) {
      const target = matches.find((m) =>
        (/^english$/i.test(m[1]!) ? "en" : "th") === language,
      ) ?? (final ? matches[0] : undefined);
      if (!target) return null;
      language = /^english$/i.test(target[1]!) ? "en" : "th";
      const from = target.index! + target[0].length;
      const end = matches.find((m) => m.index! > target.index!)?.index ?? this.raw.length;
      body = this.raw.slice(from, end);
    } else {
      // A partial heading is not dialogue.
      if (!final && /^(?:\s*English?|\s*Thai(?: translation)?)(?:\s*[:：]?)?$/i.test(this.raw)) return null;
      if (/[\u0E00-\u0E7F]/.test(body)) language = "th";
      else if (/[A-Za-z]/.test(body)) language = "en";
    }

    // Ignore Live2D *actions*, including an unfinished action mid-stream.
    body = body
      .replace(/(?<!\\)\*[^*\r\n]{1,240}\*/g, " ")
      .replace(/(?<!\\)\*[^*\r\n]*$/, "")
      .replace(/\p{Extended_Pictographic}/gu, "")
      .replace(/[\uFE0E\uFE0F\u200D]/g, "")
      .replace(/[ \t]+/g, " ");
    return { text: body, language };
  }

  append(delta: string): ReadySpeech[] {
    this.raw += delta;
    return this.drain(false);
  }

  finish(): ReadySpeech[] {
    return this.drain(true);
  }

  private drain(final: boolean): ReadySpeech[] {
    const section = this.section(final);
    if (!section) return [];
    const raw = section.text;
    let end = final ? raw.length : -1;
    if (!final) {
      const punctuation = /[.!?。！？]+(?:["”’)\]]*)?(?=\s|$)/g;
      let match: RegExpExecArray | null;
      while ((match = punctuation.exec(raw))) {
        if (punctuation.lastIndex > this.consumed) end = punctuation.lastIndex;
      }
    }
    if (end <= this.consumed) return [];
    const pending = raw.slice(this.consumed, end).trim();
    this.consumed = end;
    if (!pending) return [];
    return speechChunks(pending, 240).map((text) => ({
      text: text.trim(),
      language: section.language,
    })).filter((value) => !!value.text);
  }
}
