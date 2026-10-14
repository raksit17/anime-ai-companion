/** Keep a feminine Thai character's final polite particle consistent when the model slips. */
export function normalizeThaiFeminineEnding(text: string): string {
  return text
    .trimEnd()
    .replace(
      /([ค่ะคะ])?ครับ([.!?…。]*)$/u,
      (_match, feminine: string | undefined, punctuation: string) =>
        `${feminine ?? "ค่ะ"}${punctuation}`,
    );
}
