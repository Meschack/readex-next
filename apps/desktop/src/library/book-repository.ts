import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { LibraryBookSummary, ReaderDocumentDto } from "../reader/reader-document";

export interface BookRepository {
  importBookFromDialog(): Promise<ReaderDocumentDto | null>;
  importBookFromPath(path: string): Promise<ReaderDocumentDto>;
  listBooks(): Promise<LibraryBookSummary[]>;
  openBook(bookId: string, chapterId?: string): Promise<ReaderDocumentDto>;
  saveReadingPosition(input: SaveReadingPositionInput): Promise<void>;
  listBookmarks(bookId?: string): Promise<LibraryBookmarkDto[]>;
  saveBookmark(input: SaveBookmarkInput): Promise<LibraryBookmarkDto>;
  deleteBookmark(bookmarkId: string): Promise<void>;
  searchLibrary(input: SearchLibraryInput): Promise<LibrarySearchResultDto[]>;
  exportBookData(bookId: string): Promise<BookExportDataDto>;
}

export interface SaveReadingPositionInput {
  bookId: string;
  chapterId: string;
  sentenceIndex: number;
}

export interface LibraryBookmarkDto {
  id: string;
  bookId: string;
  bookTitle: string;
  chapterId: string;
  chapterTitle: string;
  sentenceId: string;
  sentenceIndex: number;
  text: string;
  note: string | null;
  createdAt: string;
}

export interface SaveBookmarkInput {
  bookId: string;
  bookTitle: string;
  chapterId: string;
  chapterTitle: string;
  sentenceId: string;
  sentenceIndex: number;
  text: string;
  note: string | null;
}

export interface SearchLibraryInput {
  query: string;
  bookId?: string;
  limit?: number;
}

export interface LibrarySearchResultDto {
  id: string;
  kind: "book" | "sentence";
  bookId: string;
  bookTitle: string;
  author: string;
  chapterId: string | null;
  chapterTitle: string | null;
  sentenceId: string | null;
  sentenceIndex: number | null;
  excerpt: string;
}

export interface BookExportDataDto {
  exportedAt: string;
  book: ReaderDocumentDto["book"];
  chapters: ReaderDocumentDto["chapters"];
  position: ReaderDocumentDto["position"];
  bookmarks: LibraryBookmarkDto[];
}

export type BookDropEvent =
  | { type: "enter"; paths: string[] }
  | { type: "over" }
  | { type: "drop"; paths: string[] }
  | { type: "leave" };

export function createBookRepository(): BookRepository {
  return isTauriRuntime() ? nativeBookRepository : browserBookRepository;
}

const bookmarksStorageKey = "sonelle.bookmarks.v1";

const nativeBookRepository: BookRepository = {
  async importBookFromDialog() {
    const selected = await open({
      multiple: false,
      filters: [
        {
          name: "EPUB books",
          extensions: ["epub"]
        }
      ]
    });

    if (selected == null || Array.isArray(selected)) return null;

    return this.importBookFromPath(selected);
  },

  importBookFromPath(path) {
    return invoke<ReaderDocumentDto>("import_epub", { path }).then(resolveDocumentAssets);
  },

  listBooks() {
    return invoke<LibraryBookSummary[]>("list_books").then((books) => books.map(resolveBookCover));
  },

  openBook(bookId, chapterId) {
    return invoke<ReaderDocumentDto>("open_book", {
      bookId,
      chapterId: chapterId ?? null
    }).then(resolveDocumentAssets);
  },

  saveReadingPosition(position) {
    return invoke<void>("save_reading_position", { position });
  },

  listBookmarks(bookId) {
    if (bookId != null && isFixtureBookId(bookId)) {
      return browserBookRepository.listBookmarks(bookId);
    }

    return invoke<LibraryBookmarkDto[]>("list_bookmarks", { bookId: bookId ?? null });
  },

  saveBookmark(bookmark) {
    if (isFixtureBookId(bookmark.bookId)) {
      return browserBookRepository.saveBookmark(bookmark);
    }

    return invoke<LibraryBookmarkDto>("save_bookmark", { bookmark });
  },

  deleteBookmark(bookmarkId) {
    if (isLocalBookmarkId(bookmarkId)) {
      return browserBookRepository.deleteBookmark(bookmarkId);
    }

    return invoke<void>("delete_bookmark", { bookmarkId });
  },

  searchLibrary(input) {
    return invoke<LibrarySearchResultDto[]>("search_library", {
      request: {
        query: input.query,
        bookId: input.bookId ?? null,
        limit: input.limit ?? null
      }
    });
  },

  exportBookData(bookId) {
    return invoke<BookExportDataDto>("export_book_data", { bookId }).then((data) => ({
      ...data,
      book: resolveBookCover(data.book)
    }));
  }
};

const browserBookRepository: BookRepository = {
  async importBookFromDialog() {
    throw new Error("EPUB import is available in the desktop app.");
  },

  async importBookFromPath() {
    throw new Error("EPUB import is available in the desktop app.");
  },

  async listBooks() {
    return [];
  },

  async openBook() {
    throw new Error("That book is not available in this preview.");
  },

  async saveReadingPosition() {
    return undefined;
  },

  async listBookmarks(bookId) {
    const bookmarks = loadLocalBookmarks();
    return bookId == null ? bookmarks : bookmarks.filter((bookmark) => bookmark.bookId === bookId);
  },

  async saveBookmark(input) {
    const bookmarks = loadLocalBookmarks();
    const id = localBookmarkId(input.bookId, input.chapterId, input.sentenceId);
    const existing = bookmarks.find((bookmark) => bookmark.id === id);
    const next: LibraryBookmarkDto = {
      id,
      bookId: input.bookId,
      bookTitle: input.bookTitle,
      chapterId: input.chapterId,
      chapterTitle: input.chapterTitle,
      sentenceId: input.sentenceId,
      sentenceIndex: input.sentenceIndex,
      text: input.text,
      note: input.note,
      createdAt: existing?.createdAt ?? new Date().toISOString()
    };

    saveLocalBookmarks([next, ...bookmarks.filter((bookmark) => bookmark.id !== id)]);
    return next;
  },

  async deleteBookmark(bookmarkId) {
    saveLocalBookmarks(loadLocalBookmarks().filter((bookmark) => bookmark.id !== bookmarkId));
  },

  async searchLibrary() {
    return [];
  },

  async exportBookData() {
    throw new Error("Export is available after opening a saved library book.");
  }
};

export function toFriendlyLibraryError(error: unknown): string {
  if (typeof error === "string" && error.trim().length > 0) return error;
  if (error instanceof Error && error.message.trim().length > 0) return error.message;

  return "Something got in the way. Please try again.";
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function listenForBookDrops(
  onEvent: (event: BookDropEvent) => void
): Promise<() => void> {
  if (!isTauriRuntime()) return () => undefined;

  const { getCurrentWebview } = await import("@tauri-apps/api/webview");
  return getCurrentWebview().onDragDropEvent(({ payload }) => onEvent(payload));
}

export function resolveDroppedEpubPath(paths: readonly string[]): string | null {
  return paths.find((path) => path.trim().toLocaleLowerCase().endsWith(".epub")) ?? null;
}

function resolveDocumentAssets(document: ReaderDocumentDto): ReaderDocumentDto {
  return {
    ...document,
    book: resolveBookCover(document.book)
  };
}

function resolveBookCover<TBook extends { coverImageSrc?: string | null }>(book: TBook): TBook {
  const source = book.coverImageSrc;
  if (source == null || /^[a-z][a-z\d+.-]*:/i.test(source)) return book;

  return {
    ...book,
    coverImageSrc: convertFileSrc(source, "asset")
  };
}

function loadLocalBookmarks(): LibraryBookmarkDto[] {
  if (typeof localStorage === "undefined") return [];

  try {
    const parsed = JSON.parse(localStorage.getItem(bookmarksStorageKey) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(isBookmarkDto);
  } catch {
    return [];
  }
}

function saveLocalBookmarks(bookmarks: LibraryBookmarkDto[]) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(bookmarksStorageKey, JSON.stringify(bookmarks));
}

function isBookmarkDto(value: unknown): value is LibraryBookmarkDto {
  if (value == null || typeof value !== "object") return false;

  const bookmark = value as Partial<LibraryBookmarkDto>;
  return (
    typeof bookmark.id === "string" &&
    typeof bookmark.bookId === "string" &&
    typeof bookmark.bookTitle === "string" &&
    typeof bookmark.chapterId === "string" &&
    typeof bookmark.chapterTitle === "string" &&
    typeof bookmark.sentenceId === "string" &&
    typeof bookmark.sentenceIndex === "number" &&
    typeof bookmark.text === "string" &&
    typeof bookmark.createdAt === "string"
  );
}

function localBookmarkId(bookId: string, chapterId: string, sentenceId: string): string {
  return `local-bookmark-${hashText(`${bookId}:${chapterId}:${sentenceId}`)}`;
}

function hashText(input: string): string {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
  }

  return hash.toString(16).padStart(8, "0");
}

function isFixtureBookId(bookId: string): boolean {
  return bookId.startsWith("fixture-");
}

function isLocalBookmarkId(bookmarkId: string): boolean {
  return bookmarkId.startsWith("local-bookmark-");
}
