import { describe, expect, it } from "vitest";
import {
  createDomainEvent,
  createDomainEventDispatcher,
  DomainEventDispatchError,
  normalizeLanguageCode
} from "./index";

describe("language codes", () => {
  it("normalizes EPUB locales and bibliographic aliases", () => {
    expect(normalizeLanguageCode("en-GB")).toBe("en");
    expect(normalizeLanguageCode("fr_FR")).toBe("fr");
    expect(normalizeLanguageCode("eng")).toBe("en");
    expect(normalizeLanguageCode("fra")).toBe("fr");
    expect(normalizeLanguageCode("  ")).toBeNull();
  });
});

describe("domain event dispatcher", () => {
  it("runs independent reactions and supports unsubscribing", async () => {
    const dispatcher = createDomainEventDispatcher();
    const reactions: string[] = [];
    const unsubscribe = dispatcher.subscribe("BookmarkDeleted", async (event) => {
      reactions.push(`projection:${event.payload.bookmarkId}`);
    });
    dispatcher.subscribe("BookmarkDeleted", () => {
      reactions.push("notice");
    });
    const event = createDomainEvent(
      "BookmarkDeleted",
      { bookmarkId: "bookmark-1", bookId: "book-1" },
      { id: "event-1", occurredAt: "2026-07-10T00:00:00.000Z" }
    );

    await dispatcher.dispatch(event);
    expect(reactions).toEqual(["projection:bookmark-1", "notice"]);

    unsubscribe();
    await dispatcher.dispatch(event);
    expect(reactions).toEqual(["projection:bookmark-1", "notice", "notice"]);
  });

  it("lets sibling reactions finish before reporting failures", async () => {
    const dispatcher = createDomainEventDispatcher();
    const reactions: string[] = [];
    dispatcher.subscribe("BookExported", () => {
      throw new Error("projection failed");
    });
    dispatcher.subscribe("BookExported", () => {
      reactions.push("analytics completed");
    });

    await expect(
      dispatcher.dispatch(
        createDomainEvent("BookExported", {
          bookId: "book-1",
          exportedAt: "2026-07-10T00:00:00.000Z",
          bookmarkCount: 2,
          fileName: "the-book-sonelle-export.json"
        })
      )
    ).rejects.toBeInstanceOf(DomainEventDispatchError);
    expect(reactions).toEqual(["analytics completed"]);
  });

  it("lets navigation and playback react independently when the reader closes", async () => {
    const dispatcher = createDomainEventDispatcher();
    const reactions: string[] = [];
    dispatcher.subscribe("ReaderClosed", () => {
      reactions.push("library opened");
    });
    dispatcher.subscribe("ReaderClosed", () => {
      reactions.push("playback stopped");
    });

    await dispatcher.dispatch(
      createDomainEvent("ReaderClosed", {
        bookId: "book-1",
        chapterId: "chapter-1",
        sentenceId: "sentence-1"
      })
    );

    expect(reactions).toEqual(["library opened", "playback stopped"]);
  });
});
