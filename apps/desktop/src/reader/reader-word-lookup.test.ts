import { describe, expect, it, vi } from "vitest";
import { createDomainEvent } from "@sonelle/domain";
import { lookupReaderWord } from "./reader-word-lookup";

describe("reader word lookup workflow", () => {
  it("resolves a word-inspection reaction through the dictionary adapter", async () => {
    const lookupWord = vi.fn().mockResolvedValue({
      surface: "bonjour",
      normalized: "bonjour",
      phonetic: null,
      meanings: [{ partOfSpeech: "interjection", definitions: ["A French greeting."] }],
      sourceUrl: null
    });

    const result = await lookupReaderWord(
      createDomainEvent("WordInspected", {
        bookId: "book-1",
        chapterId: "chapter-2",
        sentenceId: "sentence-3",
        surface: "bonjour",
        language: "fr"
      }),
      { dictionaryRepository: { lookupWord } }
    );

    expect(result.status).toBe("ready");
    expect(lookupWord).toHaveBeenCalledWith("bonjour", "fr");
  });

  it("turns adapter failures into reader-safe lookup state", async () => {
    const result = await lookupReaderWord(
      createDomainEvent("WordInspected", {
        bookId: "book-1",
        chapterId: "chapter-2",
        sentenceId: "sentence-3",
        surface: "bonjour",
        language: "fr"
      }),
      {
        dictionaryRepository: { lookupWord: vi.fn().mockRejectedValue(new Error("offline")) }
      }
    );

    expect(result.status).toBe("error");
  });
});
