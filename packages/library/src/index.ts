import type { BookRef } from "@readex/domain";

export interface LibraryBook extends BookRef {
  lastOpenedAt: string | null;
  readyToRead: boolean;
}

export type LibraryBookFilter = "all" | "in-progress" | "bookmarked";

export interface LibraryBookSearchTarget extends BookRef {
  lastChapterId: string | null;
  lastSentenceIndex: number;
}

export interface FilterLibraryBooksInput<TBook extends LibraryBookSearchTarget> {
  books: TBook[];
  query: string;
  filter: LibraryBookFilter;
  bookmarkedBookIds?: ReadonlySet<string>;
}

export interface BookmarkRef {
  id: string;
  bookId: string;
  chapterId: string;
  sentenceId: string;
  sentenceIndex: number;
  text: string;
  createdAt: string;
}

export type LibraryBookListState = "ready" | "loading" | "empty-library" | "empty-filter";
export type LibraryImportOutcome = "added" | "reopened";

export interface ResolveLibraryBookListStateInput {
  totalBookCount: number;
  visibleBookCount: number;
  query: string;
  filter: LibraryBookFilter;
  loading: boolean;
}

export function filterLibraryBooks<TBook extends LibraryBookSearchTarget>({
  books,
  query,
  filter,
  bookmarkedBookIds = new Set<string>()
}: FilterLibraryBooksInput<TBook>): TBook[] {
  const normalizedQuery = normalizeLibraryQuery(query);

  return books.filter((book) => {
    if (filter === "in-progress" && !isBookInProgress(book)) return false;
    if (filter === "bookmarked" && !bookmarkedBookIds.has(book.id)) return false;
    if (normalizedQuery.length === 0) return true;

    return [book.title, book.author].some((value) =>
      normalizeLibraryQuery(value).includes(normalizedQuery)
    );
  });
}

export function isBookInProgress(book: LibraryBookSearchTarget): boolean {
  return book.lastChapterId != null || book.lastSentenceIndex > 0;
}

export function normalizeLibraryQuery(query: string): string {
  return query.normalize("NFKC").trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

export function bookmarkedBookIds(bookmarks: BookmarkRef[]): Set<string> {
  return new Set(bookmarks.map((bookmark) => bookmark.bookId));
}

export function libraryImportNotice(outcome: LibraryImportOutcome): string {
  return outcome === "reopened"
    ? "Book already in your library. Reopened it."
    : "Book added to your library.";
}

export function hasLibrarySearchQuery(query: string): boolean {
  return normalizeLibraryQuery(query).length >= 2;
}

export function resolveLibraryBookListState({
  totalBookCount,
  visibleBookCount,
  query,
  filter,
  loading
}: ResolveLibraryBookListStateInput): LibraryBookListState {
  if (loading) return "loading";
  if (totalBookCount <= 0) return "empty-library";
  if (visibleBookCount <= 0 && (hasLibrarySearchQuery(query) || filter !== "all")) {
    return "empty-filter";
  }

  return "ready";
}
