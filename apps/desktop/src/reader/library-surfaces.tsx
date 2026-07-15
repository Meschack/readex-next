import { For, Show } from "solid-js";
import {
  hasLibrarySearchQuery,
  type LibraryBookFilter,
  type LibraryBookListState
} from "@sonelle/library";
import type { LibrarySearchResultDto } from "../library/library-contracts";
import { BookCover } from "./book-cover";
import type { LibraryBookSummary } from "../library/library-models";
import type { AppView, InspectorTab } from "./reader-experience-types";
import { libraryProgressPercent } from "./reader-formatting";
import { isBookRailMode, type LibraryRailMode } from "./library-rail-state";
import { StateBlock, StateNotice } from "./reader-feedback";
import type { ReaderChapterNavigationItem } from "./reader-view";
import {
  ArrowLeftIcon,
  BookmarkIcon,
  HelpIcon,
  LibraryIcon,
  PlusIcon,
  ReaderIcon,
  SearchIcon,
  SettingsIcon,
  WordIcon
} from "./reader-icons";

export interface LibraryCollectionModel {
  books: LibraryBookSummary[];
  totalBookCount: number;
  bookListState: LibraryBookListState;
  query: string;
  filter: LibraryBookFilter;
  importing: boolean;
  notice: string | null;
  onQueryChange: (query: string) => void;
  onFilterChange: (filter: LibraryBookFilter) => void;
  onImport: () => void;
  onOpenBook: (bookId: string) => void;
  onRetryLibrary: () => void;
  onOpenSample: () => void;
}

export interface LibraryNavigationModel {
  collection: LibraryCollectionModel;
  activeView: AppView;
  activeBookId: string;
  searching: boolean;
  searchResults: LibrarySearchResultDto[];
  onOpenSearchResult: (result: LibrarySearchResultDto) => void;
  onOpenView: (view: AppView) => void;
  onOpenToolTab: (tab: InspectorTab) => void;
}

export interface FocusedBookModel {
  book: ActiveRailBook;
  chapters: ReaderChapterNavigationItem[];
  activeChapterId: string;
  onOpenChapter: (chapterId: string) => void;
  onReturnToLibrary: () => void;
}

export interface LibraryRailModel {
  mode: LibraryRailMode;
  navigation: LibraryNavigationModel;
  focusedBook: FocusedBookModel;
}

export interface ActiveRailBook {
  title: string;
  author: string;
  coverImageSrc: string | null;
}

export function LibraryRail(componentProps: { model: LibraryRailModel }) {
  const model = componentProps.model;

  return (
    <aside
      classList={{
        "library-rail": true,
        "focused-book": isBookRailMode(model.mode),
        "library-mode": !isBookRailMode(model.mode)
      }}
      aria-label="Library"
    >
      <Show
        when={isBookRailMode(model.mode)}
        fallback={<NavigationRail model={model.navigation} />}
      >
        <FocusedBookRail model={model.focusedBook} />
      </Show>
    </aside>
  );
}

function NavigationRail(componentProps: { model: LibraryNavigationModel }) {
  const props = componentProps.model;
  const collection = props.collection;
  const hasSearchQuery = () => hasLibrarySearchQuery(collection.query);

  return (
    <>
      <header class="side-brand">
        <strong>Library</strong>
        <span>
          {collection.books.length + 1} {collection.books.length === 0 ? "book" : "books"} stored
          locally
        </span>
      </header>

      <nav class="nav-list" aria-label="Primary">
        <button
          classList={{ "nav-link": true, active: props.activeView === "reader" }}
          type="button"
          onClick={() => props.onOpenView("reader")}
        >
          <ReaderIcon />
          <span>Continue reading</span>
        </button>
        <details class="library-shelf">
          <summary
            classList={{ "nav-link": true, active: props.activeView === "library" }}
            onClick={(event) => {
              event.preventDefault();
              props.onOpenView("library");
            }}
          >
            <LibraryIcon />
            <span>All books</span>
          </summary>
          <section class="library-actions" aria-label="Book library">
            <div class="library-controls">
              <input
                aria-label="Search library"
                type="search"
                value={collection.query}
                placeholder="Search library"
                onInput={(event) => collection.onQueryChange(event.currentTarget.value)}
              />
              <select
                aria-label="Library filter"
                value={collection.filter}
                onChange={(event) =>
                  collection.onFilterChange(event.currentTarget.value as LibraryBookFilter)
                }
              >
                <option value="all">All</option>
                <option value="in-progress">In progress</option>
                <option value="bookmarked">Bookmarked</option>
              </select>
            </div>
            <Show when={collection.notice}>
              {(notice) => (
                <StateNotice message={notice()} onRetry={collection.onRetryLibrary} compact />
              )}
            </Show>
            <Show when={hasSearchQuery()}>
              <LibrarySearchState
                searching={props.searching}
                results={props.searchResults}
                onOpenSearchResult={props.onOpenSearchResult}
              />
            </Show>
            <div class="book-list" role="list">
              <button
                classList={{
                  "book-row": true,
                  active: props.activeBookId === "fixture-book-mara"
                }}
                type="button"
                onClick={collection.onOpenSample}
              >
                <span>The Listening Margin</span>
                <small>Sample book</small>
              </button>
              <For each={collection.books}>
                {(book) => (
                  <button
                    classList={{
                      "book-row": true,
                      active: props.activeBookId === book.id
                    }}
                    type="button"
                    onClick={() => collection.onOpenBook(book.id)}
                  >
                    <span>{book.title}</span>
                    <small>
                      {book.author} · {book.chapterCount} chapter
                      {book.chapterCount === 1 ? "" : "s"}
                    </small>
                  </button>
                )}
              </For>
              <BookListState
                state={collection.bookListState}
                hasLibraryBooks={collection.totalBookCount > 0}
                importing={collection.importing}
                onImport={collection.onImport}
              />
            </div>
          </section>
        </details>
        <button class="nav-link" type="button" onClick={() => props.onOpenToolTab("bookmarks")}>
          <BookmarkIcon />
          <span>Saved passages</span>
        </button>
        <button class="nav-link" type="button" onClick={() => props.onOpenToolTab("word")}>
          <WordIcon />
          <span>Vocabulary</span>
        </button>
      </nav>

      <section class="side-import">
        <button
          class="import-button"
          type="button"
          disabled={collection.importing}
          onClick={collection.onImport}
        >
          <PlusIcon />
          <span>{collection.importing ? "Adding..." : "Add EPUB"}</span>
        </button>
      </section>

      <footer class="side-footer">
        <nav class="nav-list secondary" aria-label="Secondary">
          <button class="nav-link" type="button" onClick={() => props.onOpenToolTab("settings")}>
            <SettingsIcon />
            <span>Settings</span>
          </button>
          <button class="nav-link" type="button">
            <HelpIcon />
            <span>Support</span>
          </button>
        </nav>
        <div class="reader-avatar">
          <span aria-hidden="true">R</span>
          <strong>Reader Avatar</strong>
        </div>
      </footer>
    </>
  );
}

function FocusedBookRail(componentProps: { model: FocusedBookModel }) {
  const props = componentProps.model;
  return (
    <section class="book-rail" aria-label="Open book">
      <button
        class="book-rail-back"
        type="button"
        aria-label="Back to library"
        onClick={props.onReturnToLibrary}
      >
        <ArrowLeftIcon />
        <span>Library</span>
      </button>
      <ActiveBookNavigation
        book={props.book}
        chapters={props.chapters}
        activeChapterId={props.activeChapterId}
        onOpenChapter={props.onOpenChapter}
      />
    </section>
  );
}

interface ActiveBookNavigationProps {
  book: ActiveRailBook;
  chapters: ReaderChapterNavigationItem[];
  activeChapterId: string;
  onOpenChapter: (chapterId: string) => void;
}

function ActiveBookNavigation(props: ActiveBookNavigationProps) {
  return (
    <section class="active-book-navigation" aria-label={`${props.book.title} chapters`}>
      <div class="active-book-card">
        <BookCover
          className="sidebar-book-cover"
          title={props.book.title}
          src={props.book.coverImageSrc}
        />
        <div class="active-book-meta">
          <strong>{props.book.title}</strong>
          <span>{props.book.author || "Unknown author"}</span>
        </div>
      </div>

      <span class="chapter-list-label">Chapters</span>
      <div class="sidebar-chapter-list" role="list">
        <For each={props.chapters}>
          {(chapter, index) => (
            <button
              classList={{
                "sidebar-chapter-row": true,
                active: props.activeChapterId === chapter.id
              }}
              type="button"
              onClick={() => props.onOpenChapter(chapter.id)}
            >
              <span>
                {index() + 1}. {chapter.title}
              </span>
              <small>
                {chapter.sentenceCount} sentence{chapter.sentenceCount === 1 ? "" : "s"}
              </small>
            </button>
          )}
        </For>
      </div>
    </section>
  );
}

export interface LibraryWorkspaceModel {
  collection: LibraryCollectionModel;
  dropActive: boolean;
  onDragEnter: () => void;
  onDragLeave: () => void;
  onDropFiles: (files: File[]) => void;
}

export function LibraryWorkspace(componentProps: { model: LibraryWorkspaceModel }) {
  const model = componentProps.model;
  const props = model.collection;
  const hasNoBooks = () => props.totalBookCount === 0 && props.bookListState !== "loading";

  return (
    <section
      classList={{ "library-workspace": true, "drop-active": model.dropActive }}
      aria-label="Library workspace"
      onDragEnter={(event) => {
        event.preventDefault();
        model.onDragEnter();
      }}
      onDragOver={(event) => {
        event.preventDefault();
        if (event.dataTransfer != null) event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) model.onDragLeave();
      }}
      onDrop={(event) => {
        event.preventDefault();
        model.onDropFiles(Array.from(event.dataTransfer?.files ?? []));
      }}
    >
      <section class="library-collection" aria-label="Book collection">
        <div class="library-collection-header">
          <div>
            <p>Offline library</p>
            <h1>Your library</h1>
            <span>
              {props.totalBookCount === 0
                ? "Import an EPUB and keep every page on your device."
                : `${props.totalBookCount} book${props.totalBookCount === 1 ? "" : "s"} ready to read.`}
            </span>
          </div>
          <button
            class="library-add-button"
            type="button"
            disabled={props.importing}
            onClick={props.onImport}
          >
            <PlusIcon />
            {props.importing ? "Adding EPUB" : "Add EPUB"}
          </button>
        </div>

        <button
          class="library-drop-zone"
          type="button"
          disabled={props.importing}
          onClick={props.onImport}
        >
          <span class="library-drop-icon" aria-hidden="true">
            <PlusIcon />
          </span>
          <strong>{model.dropActive ? "Release to add your book" : "Drop an EPUB here"}</strong>
          <small>Or choose a file. Your books stay private and local.</small>
        </button>

        <Show
          when={!hasNoBooks()}
          fallback={
            <EmptyLibraryState
              notice={props.notice}
              onOpenSample={props.onOpenSample}
              onRetryLibrary={props.onRetryLibrary}
            />
          }
        >
          <div class="library-tools">
            <label class="library-search">
              <SearchIcon />
              <input
                aria-label="Search library"
                type="search"
                value={props.query}
                placeholder="Search library"
                onInput={(event) => props.onQueryChange(event.currentTarget.value)}
              />
            </label>
            <div class="library-filter-row" aria-label="Library filters">
              <button
                classList={{ active: props.filter === "all" }}
                type="button"
                onClick={() => props.onFilterChange("all")}
              >
                All books
              </button>
              <button
                classList={{ active: props.filter === "in-progress" }}
                type="button"
                onClick={() => props.onFilterChange("in-progress")}
              >
                In progress
              </button>
              <button
                classList={{ active: props.filter === "bookmarked" }}
                type="button"
                onClick={() => props.onFilterChange("bookmarked")}
              >
                Bookmarked
              </button>
            </div>
          </div>

          <Show when={props.notice}>
            {(notice) => <StateNotice message={notice()} onRetry={props.onRetryLibrary} compact />}
          </Show>

          <Show
            when={props.bookListState !== "loading"}
            fallback={
              <StateBlock title="Opening library" body="Your saved books will appear here." />
            }
          >
            <div class="library-grid" role="list">
              <For each={props.books}>
                {(book) => (
                  <button
                    class="library-book-card"
                    type="button"
                    onClick={() => props.onOpenBook(book.id)}
                  >
                    <BookCover
                      className="library-book-cover"
                      title={book.title}
                      src={book.coverImageSrc}
                    />
                    <span class="library-book-copy">
                      <strong>{book.title}</strong>
                      <small>{book.author}</small>
                      <span class="library-card-progress" aria-hidden="true">
                        <span style={{ width: `${libraryProgressPercent(book)}%` }} />
                      </span>
                      <em>{libraryProgressPercent(book)}% read</em>
                    </span>
                  </button>
                )}
              </For>
            </div>
          </Show>
        </Show>
      </section>
    </section>
  );
}

interface EmptyLibraryStateProps {
  notice: string | null;
  onOpenSample: () => void;
  onRetryLibrary: () => void;
}

function EmptyLibraryState(props: EmptyLibraryStateProps) {
  return (
    <section class="empty-library-state" aria-label="Empty library">
      <h2>No books here yet</h2>
      <p>Use the drop area above, or open the sample while you get settled.</p>
      <div class="sample-collection-row">
        <span>Explore the sample</span>
        <button type="button" onClick={props.onOpenSample}>
          Open The Listening Margin
        </button>
      </div>
      <Show when={props.notice}>
        {(notice) => <StateNotice message={notice()} onRetry={props.onRetryLibrary} compact />}
      </Show>
    </section>
  );
}

interface LibrarySearchStateProps {
  searching: boolean;
  results: LibrarySearchResultDto[];
  onOpenSearchResult: (result: LibrarySearchResultDto) => void;
}

function LibrarySearchState(props: LibrarySearchStateProps) {
  return (
    <div class="library-search-results" role="list" aria-busy={props.searching}>
      <Show
        when={!props.searching}
        fallback={<StateBlock title="Searching library" body="Looking through saved books." />}
      >
        <Show
          when={props.results.length > 0}
          fallback={
            <StateBlock
              title="No library matches"
              body="Try a different title, author, or sentence."
            />
          }
        >
          <For each={props.results}>
            {(result) => (
              <button type="button" onClick={() => props.onOpenSearchResult(result)}>
                <span>{result.kind === "book" ? result.bookTitle : result.excerpt}</span>
                <small>
                  {result.kind === "book"
                    ? result.author
                    : `${result.bookTitle} · ${result.chapterTitle ?? "Chapter"}`}
                </small>
              </button>
            )}
          </For>
        </Show>
      </Show>
    </div>
  );
}

interface BookListStateProps {
  state: LibraryBookListState;
  hasLibraryBooks: boolean;
  importing: boolean;
  onImport: () => void;
}

function BookListState(props: BookListStateProps) {
  if (props.state === "ready") return null;

  if (props.state === "loading") {
    return <StateBlock title="Opening library" body="Your saved books will appear here." />;
  }

  if (!props.hasLibraryBooks) {
    return (
      <StateBlock
        title="No imported books"
        body="The sample stays available until a book is added."
        actionLabel={props.importing ? "Adding book..." : "Add EPUB"}
        actionDisabled={props.importing}
        onAction={props.onImport}
      />
    );
  }

  return <StateBlock title="No books in this view" body="Try All books or clear the search." />;
}
