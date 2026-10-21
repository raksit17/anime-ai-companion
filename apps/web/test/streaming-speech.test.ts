import { describe, it, expect } from "vitest";
import { StreamingSpeechChunker } from "../src/services/streaming-speech";

describe("streaming speech chunker", () => {
  it("sends first English sentence before Thai translation or complete event", () => {
    const c = new StreamingSpeechChunker("en");
    expect(c.append("English:\n*Grins.*\nHello ")).toEqual([]);
    expect(c.append("again!")).toEqual([{ text: "Hello again!", language: "en" }]);
    expect(c.append("\nNext sentence.")).toEqual([{ text: "Next sentence.", language: "en" }]);
    expect(c.append("\n\nThai:\n*ยิ้ม*\nสวัสดีค่ะ")).toEqual([]);
    expect(c.finish()).toEqual([]);
  });
  it("waits for Thai translation when Thai is selected", () => {
    const c = new StreamingSpeechChunker("th");
    expect(c.append("English:\nHello!")).toEqual([]);
    expect(c.append("\nThai translation:\n*ยิ้ม*\nสวัสดีค่ะ!")).toEqual([{ text: "สวัสดีค่ะ!", language: "th" }]);
    expect(c.finish()).toEqual([]);
  });
  it("flushes unfinished tail once", () => {
    const c = new StreamingSpeechChunker("en");
    expect(c.append("Hello. More")).toEqual([{ text: "Hello.", language: "en" }]);
    expect(c.finish()).toEqual([{ text: "More", language: "en" }]);
    expect(c.finish()).toEqual([]);
  });
  it("never narrates unfinished star actions", () => {
    const c = new StreamingSpeechChunker("en");
    expect(c.append("English:\n*Smiles")).toEqual([]);
    expect(c.append(" softly.* Hello.")).toEqual([{ text: "Hello.", language: "en" }]);
  });
});
