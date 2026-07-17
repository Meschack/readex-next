import { describe, expect, it } from "vitest";
import {
  bookmarkedBookIds,
  filterLibraryBooks,
  hasLibrarySearchQuery,
  isBookInProgress,
  libraryImportNotice,
  normalizeLibraryQuery,
  resolveLibraryBookListState,
  type BookmarkRef,
  type LibraryBookSearchTarget
} from "./index";

const books: LibraryBookSearchTarget[] = [
  {
    id: "book-1",
    title: "The Listening Margin",
    author: "Mara Vale",
    lastChapterId: "chapter-1",
    completedSentenceCount: 5
  },
  {
    id: "book-2",
    title: "Quiet Syntax",
    author: "Iris Reed",
    lastChapterId: null,
    completedSentenceCount: 0
  }
];

describe("library filters", () => {
  it("normalizes query text for repeatable matching", () => {
    expect(normalizeLibraryQuery("  Quiet   SYNTAX ")).toBe("quiet syntax");
  });

  it("filters books by title or author", () => {
    expect(
      filterLibraryBooks({
        books,
        query: "mara",
        filter: "all"
      }).map((book) => book.id)
    ).toEqual(["book-1"]);
  });

  it("filters books by progress and bookmark state", () => {
    const bookmarks: BookmarkRef[] = [
      {
        id: "bookmark-1",
        bookId: "book-2",
        chapterId: "chapter-1",
        sentenceId: "sentence-1",
        sentenceIndex: 0,
        text: "Saved.",
        createdAt: "2026-07-07T00:00:00Z"
      }
    ];

    expect(isBookInProgress(books[0])).toBe(true);
    expect(
      filterLibraryBooks({
        books,
        query: "",
        filter: "in-progress"
      }).map((book) => book.id)
    ).toEqual(["book-1"]);
    expect(
      filterLibraryBooks({
        books,
        query: "",
        filter: "bookmarked",
        bookmarkedBookIds: bookmarkedBookIds(bookmarks)
      }).map((book) => book.id)
    ).toEqual(["book-2"]);
  });

  it("recognizes only usable library search queries", () => {
    expect(hasLibrarySearchQuery("a")).toBe(false);
    expect(hasLibrarySearchQuery("  ai ")).toBe(true);
  });

  it("separates loading, empty library, and empty filtered views", () => {
    expect(
      resolveLibraryBookListState({
        totalBookCount: 0,
        visibleBookCount: 0,
        query: "",
        filter: "all",
        loading: true
      })
    ).toBe("loading");
    expect(
      resolveLibraryBookListState({
        totalBookCount: 0,
        visibleBookCount: 0,
        query: "",
        filter: "all",
        loading: false
      })
    ).toBe("empty-library");
    expect(
      resolveLibraryBookListState({
        totalBookCount: 2,
        visibleBookCount: 0,
        query: "missing",
        filter: "all",
        loading: false
      })
    ).toBe("empty-filter");
  });

  it("keeps import notices specific to the import outcome", () => {
    expect(libraryImportNotice("added")).toBe("Book added to your library.");
    expect(libraryImportNotice("reopened")).toBe("Book already in your library. Reopened it.");
  });
});
