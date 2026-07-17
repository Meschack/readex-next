import { createDomainEvent, type DomainEvent, type DomainEventDispatcher } from "@sonelle/domain";
import type {
  BookCatalog,
  BookImporter,
  BookmarkStore,
  SaveBookmarkInput
} from "../library/library-contracts";

export interface ReaderLibraryWorkflowDependencies {
  eventDispatcher: DomainEventDispatcher;
  catalog: Pick<BookCatalog, "list">;
  importer: BookImporter;
  bookmarks: Pick<BookmarkStore, "delete" | "save">;
  friendlyError(error: unknown): string;
  onEventError?(error: unknown): void;
}

export interface ReaderLibraryWorkflows {
  importFromDialog(): Promise<void>;
  importFromPath(path: string): Promise<void>;
  saveBookmark(input: SaveBookmarkInput): Promise<void>;
  deleteBookmark(bookmarkId: string, bookId: string): Promise<void>;
  start(): () => void;
}

export function createReaderLibraryWorkflows(
  dependencies: ReaderLibraryWorkflowDependencies
): ReaderLibraryWorkflows {
  const publish = async (event: Parameters<DomainEventDispatcher["dispatch"]>[0]) => {
    try {
      await dependencies.eventDispatcher.dispatch(event);
    } catch (error) {
      reportEventErrorSafely(dependencies.onEventError, error);
    }
  };

  const handleImportRequested = async (event: DomainEvent<"BookImportRequested">) => {
    const { path } = event.payload;
    try {
      const existingBookIds = new Set((await dependencies.catalog.list()).map((book) => book.id));
      const document =
        path == null
          ? await dependencies.importer.importFromDialog()
          : await dependencies.importer.importFromPath(path);
      if (document == null) {
        await publish(createDomainEvent("BookImportCancelled", { path }));
        return;
      }

      await publish(
        createDomainEvent("BookImported", {
          bookId: document.book.id,
          title: document.book.title,
          chapterCount: document.chapters.length,
          replacedExisting: existingBookIds.has(document.book.id)
        })
      );
    } catch (error) {
      await publish(
        createDomainEvent("BookImportFailed", {
          path,
          reason: dependencies.friendlyError(error)
        })
      );
    }
  };

  return {
    async importFromDialog() {
      await publish(createDomainEvent("BookImportRequested", { path: null }));
    },
    async importFromPath(path) {
      await publish(createDomainEvent("BookImportRequested", { path }));
    },
    async saveBookmark(input) {
      const bookmark = await dependencies.bookmarks.save(input);
      await publish(
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
      await dependencies.bookmarks.delete(bookmarkId);
      await publish(createDomainEvent("BookmarkDeleted", { bookmarkId, bookId }));
    },
    start() {
      const subscriptions = [
        dependencies.eventDispatcher.subscribe("BookImportRequested", handleImportRequested)
      ];
      return () => subscriptions.forEach((unsubscribe) => unsubscribe());
    }
  };
}

function reportEventErrorSafely(reporter: ((error: unknown) => void) | undefined, error: unknown) {
  try {
    reporter?.(error);
  } catch {
    // Development diagnostics must not alter library behavior.
  }
}
