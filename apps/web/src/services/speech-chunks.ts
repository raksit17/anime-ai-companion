// Pack word boundaries first; split oversized words only at grapheme boundaries.
export function speechChunks(text: string, max = 350): string[] {
  if (max < 10) throw new Error("Chunk limit too small");
  const words = [
    ...new Intl.Segmenter(undefined, { granularity: "word" }).segment(text),
  ].map((v) => v.segment);
  const parts = words.flatMap((word) =>
    word.length <= max
      ? [word]
      : [
          ...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
            word,
          ),
        ].map((v) => v.segment),
  );
  const output: string[] = [];
  let chunk = "";
  for (const part of parts) {
    if (part.length > max) throw new Error("A grapheme exceeds speech limit");
    if (chunk.length + part.length > max) {
      output.push(chunk);
      chunk = "";
    }
    chunk += part;
  }
  if (chunk) output.push(chunk);
  return output.filter((c) => c.trim());
}
