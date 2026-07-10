import { describe, expect, it } from "vitest";
import { resolveDroppedEpubPath } from "./book-repository";

describe("dropped EPUB paths", () => {
  it("accepts an EPUB path regardless of case and ignores other files", () => {
    expect(resolveDroppedEpubPath(["/books/cover.png", "/books/novel.EPUB"])).toBe(
      "/books/novel.EPUB"
    );
  });

  it("rejects drops without an EPUB", () => {
    expect(resolveDroppedEpubPath(["/books/cover.png", "/books/notes.txt"])).toBeNull();
  });
});
