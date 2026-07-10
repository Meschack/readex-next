import { describe, expect, it } from "vitest";
import { createDomainEvent } from "@sonelle/domain";
import { createMemoryEventJournal } from "./index";

describe("memory event journal", () => {
  it("keeps typed domain events in append order without exposing mutable state", async () => {
    const journal = createMemoryEventJournal();
    const event = createDomainEvent(
      "WordInspected",
      {
        bookId: "book-1",
        chapterId: "chapter-2",
        sentenceId: "sentence-3",
        surface: "bonjour",
        language: "fr"
      },
      { id: "event-1", occurredAt: "2026-07-10T00:00:00.000Z" }
    );

    await journal.append(event);
    const firstRead = await journal.readAll();
    const secondRead = await journal.readAll();

    expect(firstRead).toEqual([event]);
    expect(secondRead).not.toBe(firstRead);
  });
});
