import { describe, expect, it } from "vitest";
import { normalizeReaderText, segmentSentences } from "./index";

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
});
