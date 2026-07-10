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
      repository: {
        importBookFromDialog: vi.fn().mockResolvedValue(importedDocument),
        importBookFromPath: vi.fn(),
        saveBookmark: vi.fn(),
        deleteBookmark: vi.fn()
      }
    });

    await workflows.importFromDialog(new Set(["book-1"]));

    expect(projectionReaction).toHaveBeenCalledOnce();
    expect(openBookReaction).toHaveBeenCalledOnce();
    expect(projectionReaction.mock.calls[0]?.[0]).toMatchObject({
      name: "BookImported",
      payload: { bookId: "book-1", replacedExisting: true }
    });
  });

  it("publishes bookmark facts after their core operations succeed", async () => {
    const dispatcher = createDomainEventDispatcher();
    const created = vi.fn();
    const deleted = vi.fn();
    dispatcher.subscribe("BookmarkCreated", created);
    dispatcher.subscribe("BookmarkDeleted", deleted);
    const repository = {
      importBookFromDialog: vi.fn(),
      importBookFromPath: vi.fn(),
      saveBookmark: vi.fn().mockResolvedValue({
        id: "bookmark-1",
        bookId: "book-1",
        chapterId: "chapter-1",
        sentenceId: "sentence-1",
        sentenceIndex: 0
      }),
      deleteBookmark: vi.fn().mockResolvedValue(undefined)
    };
    const workflows = createReaderLibraryWorkflows({ eventDispatcher: dispatcher, repository });

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
});
