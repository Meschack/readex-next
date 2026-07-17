import { describe, expect, it } from "vitest";
import type { LibraryBookSummary } from "../library/library-models";
import { cssFontFamilyStack, libraryProgressPercent } from "./reader-formatting";

describe("reader formatting", () => {
  it("quotes selected system fonts before composing a CSS fallback stack", () => {
    expect(cssFontFamilyStack('Reader "Serif"', "serif")).toBe('"Reader \\"Serif\\"", serif');
    expect(cssFontFamilyStack(null, "sans-serif")).toBe("sans-serif");
  });
});

describe("library progress formatting", () => {
  it("uses cumulative completed sentences and keeps the percentage bounded", () => {
    const book: LibraryBookSummary = {
      id: "book-1",
      title: "Book",
      author: "Writer",
      importedAt: "2026-07-16T00:00:00.000Z",
      chapterCount: 3,
      sentenceCount: 7,
      lastChapterId: "chapter-2",
      completedSentenceCount: 4
    };

    expect(libraryProgressPercent(book)).toBe(57);
    expect(libraryProgressPercent({ ...book, completedSentenceCount: 100 })).toBe(100);
    expect(libraryProgressPercent({ ...book, completedSentenceCount: -2 })).toBe(0);
  });
});
