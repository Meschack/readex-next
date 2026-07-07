import { describe, expect, it } from "vitest";
import { tokenizeReaderText } from "@readex/text";
import { buildFixtureReaderView, buildReaderViewFromDocument } from "./reader-view";

describe("fixture reader view", () => {
  it("turns the fixture chapter into sentence views with word tokens", () => {
    const reader = buildFixtureReaderView();

    expect(reader.sentences).toHaveLength(5);
    expect(reader.sentences[0]?.id).toBe("fixture-book-mara:chapter-1:sentence-1");
    expect(
      tokenizeReaderText(reader.sentences[0]?.text ?? "").some((token) => token.kind === "word")
    ).toBe(true);
    expect(reader.chapters.map((chapter) => chapter.title)).toEqual(["Chapter 1", "Chapter 2"]);
    expect(reader.totalSentenceCount).toBe(8);
  });

  it("can open another fixture chapter for web preview navigation", () => {
    const reader = buildFixtureReaderView({ chapterId: "chapter-2" });

    expect(reader.chapter.title).toBe("Chapter 2");
    expect(reader.sentences[0]?.id).toBe("fixture-book-mara:chapter-2:sentence-1");
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
    expect(reader.totalSentenceCount).toBe(1);
    expect(reader.chapters).toEqual([
      {
        id: "chapter-1",
        title: "One",
        index: 0,
        sentenceCount: 1
      }
    ]);
    expect(tokenizeReaderText(reader.sentences[0]?.text ?? "").map((token) => token.text)).toEqual([
      "Hello",
      " ",
      "reader",
      "."
    ]);
  });

  it("can open a requested chapter and sentence for bookmark navigation", () => {
    const reader = buildReaderViewFromDocument(
      {
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
            sentences: [{ id: "sentence-1", index: 0, text: "First." }]
          },
          {
            id: "chapter-2",
            title: "Two",
            index: 1,
            sentences: [{ id: "sentence-2", index: 0, text: "Second." }]
          }
        ],
        position: {
          bookId: "book-1",
          chapterId: "chapter-1",
          sentenceIndex: 0,
          updatedAt: "2026-07-07T00:00:00Z"
        }
      },
      { chapterId: "chapter-2", sentenceIndex: 0 }
    );

    expect(reader.chapter.id).toBe("chapter-2");
    expect(reader.initialSentenceIndex).toBe(0);
    expect(reader.sentences[0]?.text).toBe("Second.");
  });

  it("clamps restored and requested sentence positions to the active chapter", () => {
    const reader = buildReaderViewFromDocument(
      {
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
            sentences: [{ id: "sentence-1", index: 0, text: "First." }]
          },
          {
            id: "chapter-2",
            title: "Two",
            index: 1,
            sentences: [
              { id: "sentence-2", index: 0, text: "Second." },
              { id: "sentence-3", index: 1, text: "Third." }
            ]
          }
        ],
        position: {
          bookId: "book-1",
          chapterId: "chapter-2",
          sentenceIndex: 9,
          updatedAt: "2026-07-07T00:00:00Z"
        }
      },
      { chapterId: "chapter-2", sentenceIndex: -4 }
    );

    expect(reader.initialSentenceIndex).toBe(0);
    expect(reader.totalSentenceCount).toBe(3);
  });
});
