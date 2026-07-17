import { describe, expect, it, vi } from "vitest";
import {
  createDomainEvent,
  createDomainEventDispatcher,
  type AnyDomainEvent
} from "@sonelle/domain";
import { libraryImportNotice } from "@sonelle/library";
import type { LibraryBookmarkDto } from "../library/library-contracts";
import type { LibraryBookSummary } from "../library/library-models";
import { createReaderLibraryApplication } from "./reader-library-application";

const book: LibraryBookSummary = {
  id: "book-1",
  title: "Book",
  author: "Writer",
  importedAt: "2026-07-15T00:00:00.000Z",
  chapterCount: 1,
  sentenceCount: 1,
  lastChapterId: null,
  completedSentenceCount: 0
};

const document = {
  book: { id: "book-1", title: "Book", author: "Writer", language: "en" },
  activeChapterId: "chapter-1",
  chapters: [
    {
      id: "chapter-1",
      title: "Chapter 1",
      index: 0,
      sentenceCount: 1,
      sentences: [{ id: "sentence-1", index: 0, text: "Hello." }]
    }
  ],
  position: null
};

describe("reader library application", () => {
  it("coordinates import facts and independent library projections through its interface", async () => {
    const dispatcher = createDomainEventDispatcher();
    const events: AnyDomainEvent[] = [];
    dispatcher.subscribe("BookImportRequested", (event) => {
      events.push(event);
    });
    const books: string[][] = [];
    const opened: string[] = [];
    const notices: Array<string | null> = [];
    const importing: boolean[] = [];
    let projectedBookmarks: LibraryBookmarkDto[] = [];
    const stopDropListener = vi.fn();
    const stopOpenRequestListener = vi.fn();
    let handleOpenRequest: ((path: string) => Promise<void>) | undefined;
    const importFromPath = vi.fn().mockResolvedValue(document);
    const listBooks = vi.fn(async () => [book]);
    const application = createReaderLibraryApplication(
      {
        catalog: {
          list: listBooks,
          open: async () => document
        },
        drops: { listen: async () => stopDropListener },
        openRequests: {
          async listen(listener) {
            handleOpenRequest = listener;
            return stopOpenRequestListener;
          }
        },
        importer: { importFromDialog: async () => document, importFromPath },
        bookmarks: {
          list: async () => [],
          save: vi.fn(),
          delete: vi.fn()
        },
        eventDispatcher: dispatcher,
        friendlyError: () => "Library needs attention"
      },
      {
        activeView: () => "library",
        currentBookSource: () => "library",
        projectBooks: (next) => books.push(next.map((book) => book.id)),
        projectBookmarks: (update) => {
          projectedBookmarks = update(projectedBookmarks);
        },
        projectLoading: vi.fn(),
        projectImporting: (active) => importing.push(active),
        projectDropTarget: vi.fn(),
        projectLibraryNotice: (message) => notices.push(message),
        projectBookmarkNotice: vi.fn(),
        openDocument: async (next) => void opened.push(next.book.id),
        openBookmarkInspector: vi.fn()
      }
    );
    const stop = await application.start();

    await handleOpenRequest?.("/tmp/book.epub");
    await vi.waitFor(() => expect(opened).toEqual(["book-1"]));

    expect(importFromPath).toHaveBeenCalledWith("/tmp/book.epub");
    expect(events.map((event) => event.name)).toEqual(["BookImportRequested"]);
    expect(books).toEqual([["book-1"]]);
    expect(notices[notices.length - 1]).toBe(libraryImportNotice("reopened"));
    expect(importing).toEqual([true, false]);

    listBooks.mockClear();
    await dispatcher.dispatch(
      createDomainEvent("ReaderClosed", {
        bookId: "book-1",
        chapterId: "chapter-1",
        sentenceId: "sentence-1"
      })
    );
    expect(listBooks).toHaveBeenCalledOnce();

    stop();
    expect(stopDropListener).toHaveBeenCalledOnce();
    expect(stopOpenRequestListener).toHaveBeenCalledOnce();
  });
});
