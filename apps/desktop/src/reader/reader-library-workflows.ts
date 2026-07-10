import { createDomainEvent, type DomainEventDispatcher } from "@sonelle/domain";
import type { BookRepository, SaveBookmarkInput } from "../library/book-repository";

export interface ReaderLibraryWorkflowDependencies {
  eventDispatcher: DomainEventDispatcher;
  repository: Pick<
    BookRepository,
    "deleteBookmark" | "importBookFromDialog" | "importBookFromPath" | "saveBookmark"
  >;
}

export interface ReaderLibraryWorkflows {
  importFromDialog(existingBookIds: ReadonlySet<string>): Promise<boolean>;
  importFromPath(path: string, existingBookIds: ReadonlySet<string>): Promise<void>;
  saveBookmark(input: SaveBookmarkInput): Promise<void>;
  deleteBookmark(bookmarkId: string, bookId: string): Promise<void>;
}

export function createReaderLibraryWorkflows(
  dependencies: ReaderLibraryWorkflowDependencies
): ReaderLibraryWorkflows {
  const dispatchImportedBook = async (
    document: Awaited<ReturnType<BookRepository["importBookFromPath"]>>,
    existingBookIds: ReadonlySet<string>
  ) => {
    await dependencies.eventDispatcher.dispatch(
      createDomainEvent("BookImported", {
        bookId: document.book.id,
        title: document.book.title,
        chapterCount: document.chapters.length,
        replacedExisting: existingBookIds.has(document.book.id)
      })
    );
  };

  return {
    async importFromDialog(existingBookIds) {
      const document = await dependencies.repository.importBookFromDialog();
      if (document == null) return false;

      await dispatchImportedBook(document, existingBookIds);
      return true;
    },
    async importFromPath(path, existingBookIds) {
      const document = await dependencies.repository.importBookFromPath(path);
      await dispatchImportedBook(document, existingBookIds);
    },
    async saveBookmark(input) {
      const bookmark = await dependencies.repository.saveBookmark(input);
      await dependencies.eventDispatcher.dispatch(
        createDomainEvent("BookmarkCreated", {
          bookmarkId: bookmark.id,
          bookId: bookmark.bookId,
          chapterId: bookmark.chapterId,
          sentenceId: bookmark.sentenceId,
          sentenceIndex: bookmark.sentenceIndex
        })
      );
    },
    async deleteBookmark(bookmarkId, bookId) {
      await dependencies.repository.deleteBookmark(bookmarkId);
      await dependencies.eventDispatcher.dispatch(
        createDomainEvent("BookmarkDeleted", { bookmarkId, bookId })
      );
    }
  };
}
