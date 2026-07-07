import { describe, expect, it } from "vitest";
import { buildFixtureReaderView, buildReaderViewFromDocument } from "./reader-view";

describe("fixture reader view", () => {
  it("turns the fixture chapter into sentence views with word tokens", () => {
    const reader = buildFixtureReaderView();

    expect(reader.sentences).toHaveLength(5);
    expect(reader.sentences[0]?.id).toBe("fixture-book-mara:chapter-1:sentence-1");
    expect(reader.sentences[0]?.tokens.some((token) => token.kind === "word")).toBe(true);
  });

  it("turns a persisted reader document into the active chapter view", () => {
    const reader = buildReaderViewFromDocument({
      book: {
        id: "book-1",
        title: "Imported",
        author: "Author"
      },
      chapters: [
        {
          id: "chapter-1",
          title: "One",
          index: 0,
          sentences: [{ id: "sentence-1", index: 0, text: "Hello reader." }]
        }
      ],
      position: {
        bookId: "book-1",
        chapterId: "chapter-1",
        sentenceIndex: 0,
        updatedAt: "2026-07-07T00:00:00Z"
      }
    });

    expect(reader.source).toBe("library");
    expect(reader.book.title).toBe("Imported");
    expect(reader.sentences[0]?.tokens.map((token) => token.text)).toEqual([
      "Hello",
      " ",
      "reader",
      "."
    ]);
  });
});
