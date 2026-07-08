import { describe, expect, it } from "vitest";
import {
  normalizeReaderParagraphs,
  normalizeReaderText,
  segmentParagraphs,
  segmentSentences,
  tokenizeReaderText
} from "./index";

describe("reader text", () => {
  it("normalizes typography and spacing for display and narration", () => {
    expect(normalizeReaderText("“Hello”\u00a0reader — line-\n break.")).toBe(
      '"Hello" reader - linebreak.'
    );
  });

  it("segments text into sentence-level playback highlights", () => {
    expect(segmentSentences("First sentence. Second sentence follows.")).toEqual([
      { text: "First sentence.", index: 0 },
      { text: "Second sentence follows.", index: 1 }
    ]);
  });

  it("preserves paragraph boundaries for reader display", () => {
    expect(normalizeReaderParagraphs("First paragraph.\n\nSecond\u00a0paragraph .")).toBe(
      "First paragraph.\n\nSecond paragraph."
    );
    expect(segmentParagraphs("First sentence. Second sentence.\n\nThird sentence.")).toEqual([
      {
        index: 0,
        sentences: [
          { text: "First sentence.", index: 0 },
          { text: "Second sentence.", index: 1 }
        ]
      },
      {
        index: 1,
        sentences: [{ text: "Third sentence.", index: 2 }]
      }
    ]);
  });

  it("tokenizes words without losing punctuation or spacing", () => {
    expect(tokenizeReaderText("Wait, language-learner.").map((token) => token.text)).toEqual([
      "Wait",
      ", ",
      "language-learner",
      "."
    ]);
  });
});
