import { describe, expect, it, vi } from "vitest";
import { createDomainEventDispatcher } from "@sonelle/domain";
import { createReaderLibraryWorkflows } from "./reader-library-workflows";

const importedDocument = {
  book: { id: "book-1", title: "The Book", author: "A. Writer", language: "en" },
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

describe("reader library workflows", () => {
  it("publishes an import fact and leaves reactions to listeners", async () => {
    const dispatcher = createDomainEventDispatcher();
    const projectionReaction = vi.fn();
    const openBookReaction = vi.fn();
    dispatcher.subscribe("BookImported", projectionReaction);
    dispatcher.subscribe("BookImported", openBookReaction);
    const workflows = createReaderLibraryWorkflows({
      eventDispatcher: dispatcher,
      friendlyError: friendlyError,
      catalog: { list: vi.fn().mockResolvedValue([{ id: "book-1" }]) },
      importer: {
        importFromDialog: vi.fn().mockResolvedValue(importedDocument),
        importFromPath: vi.fn()
      },
      bookmarks: { save: vi.fn(), delete: vi.fn() }
    });
    const stop = workflows.start();

    await workflows.importFromDialog();

    expect(projectionReaction).toHaveBeenCalledOnce();
    expect(openBookReaction).toHaveBeenCalledOnce();
    expect(projectionReaction.mock.calls[0]?.[0]).toMatchObject({
      name: "BookImported",
      payload: { bookId: "book-1", replacedExisting: true }
    });
    stop();
  });

  it("publishes bookmark facts after their core operations succeed", async () => {
    const dispatcher = createDomainEventDispatcher();
    const created = vi.fn();
    const deleted = vi.fn();
    dispatcher.subscribe("BookmarkCreated", created);
    dispatcher.subscribe("BookmarkDeleted", deleted);
    const bookmarks = {
      save: vi.fn().mockResolvedValue({
        id: "bookmark-1",
        bookId: "book-1",
        chapterId: "chapter-1",
        sentenceId: "sentence-1",
        sentenceIndex: 0
      }),
      delete: vi.fn().mockResolvedValue(undefined)
    };
    const workflows = createReaderLibraryWorkflows({
      eventDispatcher: dispatcher,
      friendlyError,
      catalog: { list: vi.fn().mockResolvedValue([]) },
      importer: { importFromDialog: vi.fn(), importFromPath: vi.fn() },
      bookmarks
    });

    await workflows.saveBookmark({
      bookId: "book-1",
      bookTitle: "The Book",
      chapterId: "chapter-1",
      chapterTitle: "Chapter 1",
      sentenceId: "sentence-1",
      sentenceIndex: 0,
      text: "Hello.",
      note: null
    });
    await workflows.deleteBookmark("bookmark-1", "book-1");

    expect(created).toHaveBeenCalledOnce();
    expect(deleted).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "BookmarkDeleted",
        payload: { bookmarkId: "bookmark-1", bookId: "book-1" }
      })
    );
  });

  it("publishes import failures without making the request producer own the reaction", async () => {
    const dispatcher = createDomainEventDispatcher();
    const failed = vi.fn();
    dispatcher.subscribe("BookImportFailed", failed);
    const workflows = createReaderLibraryWorkflows({
      eventDispatcher: dispatcher,
      friendlyError,
      catalog: { list: vi.fn().mockResolvedValue([]) },
      importer: {
        importFromDialog: vi.fn(),
        importFromPath: vi.fn().mockRejectedValue(new Error("broken EPUB"))
      },
      bookmarks: { save: vi.fn(), delete: vi.fn() }
    });
    const stop = workflows.start();

    await expect(workflows.importFromPath("/tmp/broken.epub")).resolves.toBeUndefined();

    expect(failed).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "BookImportFailed",
        payload: { path: "/tmp/broken.epub", reason: "broken EPUB" }
      })
    );
    stop();
  });

  it("publishes a terminal fact when the import dialog is dismissed", async () => {
    const dispatcher = createDomainEventDispatcher();
    const cancelled = vi.fn();
    dispatcher.subscribe("BookImportCancelled", cancelled);
    const workflows = createReaderLibraryWorkflows({
      eventDispatcher: dispatcher,
      friendlyError,
      catalog: { list: vi.fn().mockResolvedValue([]) },
      importer: {
        importFromDialog: vi.fn().mockResolvedValue(null),
        importFromPath: vi.fn()
      },
      bookmarks: { save: vi.fn(), delete: vi.fn() }
    });
    const stop = workflows.start();

    await workflows.importFromDialog();

    expect(cancelled).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "BookImportCancelled",
        payload: { path: null }
      })
    );
    stop();
  });
});

function friendlyError(error: unknown): string {
  return error instanceof Error ? error.message : "Import failed";
}
