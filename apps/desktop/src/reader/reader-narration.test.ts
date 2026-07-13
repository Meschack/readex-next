import { describe, expect, it } from "vitest";
import { createReaderNarrationOutline } from "./reader-narration";
import { buildFixtureReaderView } from "./reader-view";

describe("reader narration outline", () => {
  it("projects reader sentences and paragraphs without leaking reader UI state", () => {
    const reader = buildFixtureReaderView();
    const outline = createReaderNarrationOutline(reader);

    expect(outline).toMatchObject({
      bookId: reader.book.id,
      chapterId: reader.chapter.id,
      language: "en"
    });
    expect(outline.sentences.map((sentence) => sentence.id)).toEqual(
      reader.sentences.map((sentence) => sentence.id)
    );
    expect(outline.paragraphs).toEqual(
      reader.paragraphs.map(({ id, index, startSentenceIndex, endSentenceIndex }) => ({
        id,
        index,
        startSentenceIndex,
        endSentenceIndex
      }))
    );
  });
});
