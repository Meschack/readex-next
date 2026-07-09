import { describe, expect, it } from "vitest";
import { nextReaderChapter } from "./reader-chapter-flow";

describe("reader chapter flow", () => {
  it("returns the next chapter by chapter order", () => {
    expect(
      nextReaderChapter(
        [
          { id: "chapter-3", title: "Three", index: 2, sentenceCount: 4 },
          { id: "chapter-1", title: "One", index: 0, sentenceCount: 2 },
          { id: "chapter-2", title: "Two", index: 1, sentenceCount: 3 }
        ],
        "chapter-1"
      )
    ).toMatchObject({
      id: "chapter-2"
    });
  });

  it("returns null at the end of the book", () => {
    expect(
      nextReaderChapter(
        [
          { id: "chapter-1", title: "One", index: 0, sentenceCount: 2 },
          { id: "chapter-2", title: "Two", index: 1, sentenceCount: 3 }
        ],
        "chapter-2"
      )
    ).toBeNull();
  });
});
