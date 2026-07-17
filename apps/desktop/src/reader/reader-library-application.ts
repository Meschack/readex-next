import type { DomainEventDispatcher } from "@sonelle/domain";
import { libraryImportNotice } from "@sonelle/library";
import type {
  BookCatalog,
  BookDropAdapter,
  BookDropEvent,
  BookImporter,
  BookOpenRequestAdapter,
  BookmarkStore,
  LibraryBookmarkDto,
  SaveBookmarkInput
} from "../library/library-contracts";
import { resolveDroppedEpubPath } from "../library/book-drop-adapter";
import type { LibraryBookSummary, ReaderDocumentDto } from "../library/library-models";
import type { AppView, OpenBookOptions } from "./reader-experience-types";
import { createReaderLibraryWorkflows } from "./reader-library-workflows";

interface ReaderLibraryApplicationDependencies {
  catalog: BookCatalog;
  drops: BookDropAdapter;
  openRequests: BookOpenRequestAdapter;
  importer: BookImporter;
  bookmarks: BookmarkStore;
  eventDispatcher: DomainEventDispatcher;
  friendlyError(error: unknown): string;
  onEventError?(error: unknown): void;
}

interface ReaderLibraryApplicationOptions {
  activeView(): AppView;
  currentBookSource(): "sample" | "library";
  projectBooks(books: LibraryBookSummary[]): void;
  projectBookmarks(update: (current: LibraryBookmarkDto[]) => LibraryBookmarkDto[]): void;
  projectLoading(loading: boolean): void;
  projectImporting(importing: boolean): void;
  projectDropTarget(active: boolean): void;
  projectLibraryNotice(message: string | null): void;
  projectBookmarkNotice(message: string | null): void;
  openDocument(document: ReaderDocumentDto, options?: OpenBookOptions): Promise<void>;
  openBookmarkInspector(): void;
}

export interface ReaderLibraryApplication {
  start(): Promise<() => void>;
  refresh(): Promise<void>;
  open(bookId: string, options?: OpenBookOptions): Promise<void>;
  importFromDialog(): Promise<void>;
  importFromPath(path: string): Promise<void>;
  handleBrowserDrop(files: File[]): void;
  saveBookmark(input: SaveBookmarkInput): Promise<void>;
  deleteBookmark(bookmarkId: string, bookId: string): Promise<void>;
  refreshBookmarks(bookId?: string): Promise<void>;
}

export function createReaderLibraryApplication(
  dependencies: ReaderLibraryApplicationDependencies,
  options: ReaderLibraryApplicationOptions
): ReaderLibraryApplication {
  const workflows = createReaderLibraryWorkflows({
    eventDispatcher: dependencies.eventDispatcher,
    catalog: dependencies.catalog,
    importer: dependencies.importer,
    bookmarks: dependencies.bookmarks,
    friendlyError: dependencies.friendlyError,
    onEventError: dependencies.onEventError
  });
  let importing = false;

  const reportLibraryError = (error: unknown) => {
    options.projectLibraryNotice(dependencies.friendlyError(error));
  };
  const reportBookmarkError = (error: unknown) => {
    options.projectBookmarkNotice(dependencies.friendlyError(error));
  };

  const refreshBooks = async () => {
    const books = await dependencies.catalog.list();
    options.projectBooks(books);
    return books;
  };

  const refreshBookmarks = async (bookId?: string) => {
    try {
      const bookmarks = await dependencies.bookmarks.list(bookId);
      options.projectBookmarks((current) =>
        bookId == null
          ? bookmarks
          : [...bookmarks, ...current.filter((bookmark) => bookmark.bookId !== bookId)]
      );
    } catch (error) {
      reportBookmarkError(error);
    }
  };

  const open = async (bookId: string, openOptions: OpenBookOptions = {}) => {
    try {
      const document = await dependencies.catalog.open(bookId, openOptions.chapterId);
      await options.openDocument(document, openOptions);
      options.projectLibraryNotice(null);
    } catch (error) {
      reportLibraryError(error);
    }
  };

  const importBook = async (path?: string) => {
    if (importing) return;
    if (path == null) await workflows.importFromDialog();
    else await workflows.importFromPath(path);
  };

  const handleDrop = (event: BookDropEvent) => {
    if (options.activeView() !== "library") return;
    if (event.type === "leave") {
      options.projectDropTarget(false);
      return;
    }
    if (event.type === "enter" || event.type === "over") {
      options.projectDropTarget(true);
      return;
    }
    options.projectDropTarget(false);
    const path = resolveDroppedEpubPath(event.paths);
    if (path == null) {
      options.projectLibraryNotice("Drop an EPUB file to add it to your library.");
      return;
    }
    void importBook(path);
  };

  return {
    async start() {
      const subscriptions = [
        dependencies.eventDispatcher.subscribe("BookImportRequested", () => {
          importing = true;
          options.projectImporting(true);
          options.projectLibraryNotice(null);
        }),
        dependencies.eventDispatcher.subscribe("BookImported", () =>
          refreshBooks().then(() => undefined)
        ),
        dependencies.eventDispatcher.subscribe("BookImported", (event) =>
          open(event.payload.bookId)
        ),
        dependencies.eventDispatcher.subscribe("BookImported", (event) => {
          options.projectLibraryNotice(
            libraryImportNotice(event.payload.replacedExisting ? "reopened" : "added")
          );
        }),
        dependencies.eventDispatcher.subscribe("BookImported", () => {
          importing = false;
          options.projectImporting(false);
        }),
        dependencies.eventDispatcher.subscribe("BookImportCancelled", () => {
          importing = false;
          options.projectImporting(false);
        }),
        dependencies.eventDispatcher.subscribe("BookImportFailed", (event) => {
          options.projectLibraryNotice(event.payload.reason);
        }),
        dependencies.eventDispatcher.subscribe("BookImportFailed", () => {
          importing = false;
          options.projectImporting(false);
        }),
        dependencies.eventDispatcher.subscribe("BookmarkCreated", (event) =>
          refreshBookmarks(event.payload.bookId)
        ),
        dependencies.eventDispatcher.subscribe("BookmarkCreated", () => {
          options.projectBookmarkNotice("Bookmark saved.");
        }),
        dependencies.eventDispatcher.subscribe("BookmarkCreated", () => {
          options.openBookmarkInspector();
        }),
        dependencies.eventDispatcher.subscribe("BookmarkDeleted", (event) =>
          refreshBookmarks(event.payload.bookId)
        ),
        dependencies.eventDispatcher.subscribe("BookmarkDeleted", () => {
          options.projectBookmarkNotice("Bookmark removed.");
        }),
        dependencies.eventDispatcher.subscribe("ReaderClosed", async () => {
          try {
            await refreshBooks();
          } catch (error) {
            reportLibraryError(error);
          }
        })
      ];
      const stopCore = workflows.start();
      const stopDrops = await dependencies.drops.listen(handleDrop);
      const stopOpenRequests = await dependencies.openRequests.listen(importBook);
      return () => {
        stopOpenRequests();
        stopDrops();
        stopCore();
        subscriptions.forEach((unsubscribe) => unsubscribe());
      };
    },
    async refresh() {
      options.projectLoading(true);
      try {
        const books = await refreshBooks();
        if (options.currentBookSource() === "sample" && books[0] != null) {
          await open(books[0].id);
        }
      } catch (error) {
        reportLibraryError(error);
      } finally {
        options.projectLoading(false);
      }
    },
    open,
    importFromDialog: () => importBook(),
    importFromPath: (path) => importBook(path),
    handleBrowserDrop(files) {
      options.projectDropTarget(false);
      const paths = files
        .map((file) => (file as File & { path?: unknown }).path)
        .filter((value): value is string => typeof value === "string");
      const path = resolveDroppedEpubPath(paths);
      if (path == null) {
        options.projectLibraryNotice(
          "Drop an EPUB file into the desktop app to add it to your library."
        );
        return;
      }
      void importBook(path);
    },
    async saveBookmark(input) {
      try {
        await workflows.saveBookmark(input);
      } catch (error) {
        reportBookmarkError(error);
      }
    },
    async deleteBookmark(bookmarkId, bookId) {
      try {
        await workflows.deleteBookmark(bookmarkId, bookId);
      } catch (error) {
        reportBookmarkError(error);
      }
    },
    refreshBookmarks
  };
}
