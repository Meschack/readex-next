import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import {
  advancePlayback,
  createPlaybackState,
  highlightSentence,
  movePlayback,
  pausePlayback,
  playPlayback,
  selectPlaybackSentence,
  type PlaybackStatus
} from "@readex/reader";
import { createWordInsight, type WordInsight } from "@readex/learning";
import type { ReaderTextToken } from "@readex/text";
import {
  createBookRepository,
  toFriendlyLibraryError,
  type SaveReadingPositionInput
} from "../library/book-repository";
import type { LibraryBookSummary } from "./reader-document";
import {
  buildFixtureReaderView,
  buildReaderViewFromDocument,
  type ReaderSentenceView,
  type ReaderView
} from "./reader-view";

const playbackTickMs = 2600;

interface SelectedWord {
  sentenceId: string;
  tokenIndex: number;
  insight: WordInsight;
}

export function ReaderExperience() {
  const repository = createBookRepository();
  const sampleReader = buildFixtureReaderView();
  const [reader, setReader] = createSignal<ReaderView>(sampleReader);
  const [libraryBooks, setLibraryBooks] = createSignal<LibraryBookSummary[]>([]);
  const [libraryNotice, setLibraryNotice] = createSignal<string | null>(null);
  const [isImporting, setIsImporting] = createSignal(false);
  const [playback, setPlayback] = createSignal(createPlaybackState());
  const [selectedWord, setSelectedWord] = createSignal<SelectedWord | null>(null);

  const activeSentence = createMemo(() => reader().sentences[playback().activeSentenceIndex]);
  const highlight = createMemo(() => highlightSentence(activeSentence()?.id ?? null));
  const activeWordInsight = createMemo(() => selectedWord()?.insight ?? null);
  const statusLabel = createMemo(() => {
    switch (playback().status) {
      case "playing":
        return "Listening";
      case "paused":
        return "Paused";
      case "ended":
        return "Finished";
      default:
        return reader().source === "sample" ? "Sample reader" : "Ready to listen";
    }
  });

  onMount(() => {
    void refreshLibrary();
  });

  createEffect(() => {
    if (playback().status !== "playing") return;

    const timer = window.setInterval(() => {
      setPlayback((current) => advancePlayback(current, reader().sentences.length));
    }, playbackTickMs);

    onCleanup(() => window.clearInterval(timer));
  });

  createEffect(() => {
    const currentReader = reader();
    const currentPlayback = playback();
    const sentence = currentReader.sentences[currentPlayback.activeSentenceIndex];

    if (currentReader.source !== "library" || sentence == null) return;

    const position: SaveReadingPositionInput = {
      bookId: currentReader.book.id,
      chapterId: currentReader.chapter.id,
      sentenceIndex: sentence.index
    };

    void repository.saveReadingPosition(position).catch(() => {
      setLibraryNotice("We couldn't save your place just now.");
    });
  });

  const togglePlayback = () => {
    setPlayback((current) =>
      current.status === "playing"
        ? pausePlayback(current)
        : playPlayback(current, reader().sentences.length)
    );
  };

  const moveSentence = (direction: -1 | 1) => {
    setPlayback((current) => movePlayback(current, reader().sentences.length, direction));
  };

  const selectSentence = (sentenceIndex: number) => {
    setPlayback((current) =>
      selectPlaybackSentence(current, reader().sentences.length, sentenceIndex)
    );
  };

  const selectWord = (
    sentence: ReaderSentenceView,
    token: Extract<ReaderTextToken, { kind: "word" }>
  ) => {
    setSelectedWord({
      sentenceId: sentence.id,
      tokenIndex: token.index,
      insight: createWordInsight(token.text)
    });
  };

  const isSelectedWord = (sentenceId: string, token: ReaderTextToken) =>
    token.kind === "word" &&
    selectedWord()?.sentenceId === sentenceId &&
    selectedWord()?.tokenIndex === token.index;

  const activateReader = (nextReader: ReaderView) => {
    setReader(nextReader);
    setPlayback((current) =>
      selectPlaybackSentence(
        { activeSentenceIndex: nextReader.initialSentenceIndex, status: current.status },
        nextReader.sentences.length,
        nextReader.initialSentenceIndex
      )
    );
    setSelectedWord(null);
  };

  const refreshLibrary = async () => {
    try {
      const books = await repository.listBooks();
      setLibraryBooks(books);

      if (reader().source === "sample" && books[0] != null) {
        await openLibraryBook(books[0].id);
      }
    } catch (error) {
      setLibraryNotice(toFriendlyLibraryError(error));
    }
  };

  const openSampleReader = () => {
    activateReader(sampleReader);
    setLibraryNotice(null);
  };

  const openLibraryBook = async (bookId: string) => {
    try {
      const document = await repository.openBook(bookId);
      activateReader(buildReaderViewFromDocument(document));
      setLibraryNotice(null);
    } catch (error) {
      setLibraryNotice(toFriendlyLibraryError(error));
    }
  };

  const importBook = async () => {
    setIsImporting(true);
    setLibraryNotice(null);

    try {
      const document = await repository.importBookFromDialog();
      if (document == null) return;

      activateReader(buildReaderViewFromDocument(document));
      setLibraryNotice("Book added to your library.");
      setLibraryBooks(await repository.listBooks());
    } catch (error) {
      setLibraryNotice(toFriendlyLibraryError(error));
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <main class="readex-shell">
      <LibraryRail
        activeBookId={reader().book.id}
        books={libraryBooks()}
        importing={isImporting()}
        notice={libraryNotice()}
        onImport={importBook}
        onOpenBook={openLibraryBook}
        onOpenSample={openSampleReader}
      />

      <section class="reader-surface" aria-label="Reader">
        <header class="reader-header">
          <p>{statusLabel()}</p>
          <h1>{reader().book.title}</h1>
          <span>{reader().book.author}</span>
        </header>

        <div class="reader-layout">
          <div class="audio-margin" aria-hidden="true">
            <For each={reader().sentences}>
              {(sentence) => (
                <span
                  classList={{
                    marker: true,
                    active: highlight().activeSentenceId === sentence.id
                  }}
                />
              )}
            </For>
          </div>

          <article class="page" aria-label={`${reader().chapter.title} text`}>
            <For each={reader().sentences}>
              {(sentence) => (
                <p
                  classList={{
                    sentence: true,
                    active: highlight().activeSentenceId === sentence.id
                  }}
                  onClick={() => selectSentence(sentence.index)}
                >
                  <For each={sentence.tokens}>
                    {(token) => (
                      <SentenceToken
                        token={token}
                        sentence={sentence}
                        selected={isSelectedWord(sentence.id, token)}
                        onSelect={selectWord}
                        onClear={() => setSelectedWord(null)}
                      />
                    )}
                  </For>
                </p>
              )}
            </For>
          </article>
        </div>
      </section>

      <WordInspector insight={activeWordInsight()} />

      <PlaybackRail
        chapterTitle={reader().chapter.title}
        activeIndex={playback().activeSentenceIndex}
        sentenceCount={reader().sentences.length}
        status={playback().status}
        onPrevious={() => moveSentence(-1)}
        onToggle={togglePlayback}
        onNext={() => moveSentence(1)}
      />
    </main>
  );
}

interface LibraryRailProps {
  activeBookId: string;
  books: LibraryBookSummary[];
  importing: boolean;
  notice: string | null;
  onImport: () => void;
  onOpenBook: (bookId: string) => void;
  onOpenSample: () => void;
}

function LibraryRail(props: LibraryRailProps) {
  return (
    <aside class="library-rail" aria-label="Library">
      <strong class="brand">Readex</strong>
      <nav class="nav-list">
        <a class="active" href="/">
          Reader
        </a>
        <a href="/">Library</a>
        <a href="/">Bookmarks</a>
        <a href="/">Words</a>
      </nav>
      <section class="library-actions" aria-label="Book library">
        <button
          class="import-button"
          type="button"
          disabled={props.importing}
          onClick={props.onImport}
        >
          {props.importing ? "Adding..." : "Add EPUB"}
        </button>
        <Show when={props.notice}>{(notice) => <p class="library-notice">{notice()}</p>}</Show>
        <div class="book-list" role="list">
          <button
            classList={{
              "book-row": true,
              active: props.activeBookId === "fixture-book-mara"
            }}
            type="button"
            onClick={props.onOpenSample}
          >
            <span>The Listening Margin</span>
            <small>Sample book</small>
          </button>
          <For each={props.books}>
            {(book) => (
              <button
                classList={{
                  "book-row": true,
                  active: props.activeBookId === book.id
                }}
                type="button"
                onClick={() => props.onOpenBook(book.id)}
              >
                <span>{book.title}</span>
                <small>
                  {book.author} · {book.chapterCount} chapter{book.chapterCount === 1 ? "" : "s"}
                </small>
              </button>
            )}
          </For>
        </div>
      </section>
    </aside>
  );
}

interface SentenceTokenProps {
  token: ReaderTextToken;
  sentence: ReaderSentenceView;
  selected: boolean;
  onSelect: (
    sentence: ReaderSentenceView,
    token: Extract<ReaderTextToken, { kind: "word" }>
  ) => void;
  onClear: () => void;
}

function SentenceToken(props: SentenceTokenProps) {
  if (props.token.kind === "text") return <>{props.token.text}</>;

  const token = props.token;

  return (
    <span class="word-shell">
      <button
        classList={{
          "word-token": true,
          selected: props.selected
        }}
        type="button"
        aria-label={`Inspect ${token.text}`}
        onClick={(event) => {
          event.stopPropagation();
          props.onSelect(props.sentence, token);
        }}
      >
        {token.text}
      </button>
      <Show when={props.selected}>
        <WordPopover insight={createWordInsight(token.text)} onClear={props.onClear} />
      </Show>
    </span>
  );
}

interface WordPopoverProps {
  insight: WordInsight;
  onClear: () => void;
}

function WordPopover(props: WordPopoverProps) {
  return (
    <span class="word-popover" role="dialog" aria-label={`Insight for ${props.insight.surface}`}>
      <strong>{props.insight.surface}</strong>
      <span>{props.insight.definition}</span>
      <button
        type="button"
        aria-label="Close word insight"
        onClick={(event) => {
          event.stopPropagation();
          props.onClear();
        }}
      >
        Close
      </button>
    </span>
  );
}

interface WordInspectorProps {
  insight: WordInsight | null;
}

function WordInspector(props: WordInspectorProps) {
  return (
    <aside class="inspector" aria-label="Word insight">
      <span class="inspector-label">Word insight</span>
      <Show
        when={props.insight}
        fallback={
          <>
            <strong>Pick a word</strong>
            <p>Tap any word in the page to keep its meaning beside the text.</p>
          </>
        }
      >
        {(insight) => (
          <>
            <strong>{insight().surface}</strong>
            <dl>
              <Show when={insight().partOfSpeech}>
                <div>
                  <dt>Type</dt>
                  <dd>{insight().partOfSpeech}</dd>
                </div>
              </Show>
              <div>
                <dt>Meaning</dt>
                <dd>{insight().definition}</dd>
              </div>
              <Show when={insight().translation}>
                <div>
                  <dt>French</dt>
                  <dd>{insight().translation}</dd>
                </div>
              </Show>
              <Show when={insight().example}>
                <div>
                  <dt>Example</dt>
                  <dd>{insight().example}</dd>
                </div>
              </Show>
            </dl>
            <span class="learning-state">{insight().state}</span>
          </>
        )}
      </Show>
    </aside>
  );
}

interface PlaybackRailProps {
  chapterTitle: string;
  activeIndex: number;
  sentenceCount: number;
  status: PlaybackStatus;
  onPrevious: () => void;
  onToggle: () => void;
  onNext: () => void;
}

function PlaybackRail(props: PlaybackRailProps) {
  const progress = () =>
    props.sentenceCount <= 1 ? 0 : (props.activeIndex / (props.sentenceCount - 1)) * 100;

  return (
    <footer class="audio-rail" aria-label="Playback controls">
      <div class="chapter-status">
        <span>{props.chapterTitle}</span>
        <span class="mono">
          {props.activeIndex + 1} / {props.sentenceCount}
        </span>
      </div>
      <div class="progress-track" aria-hidden="true">
        <span style={{ width: `${progress()}%` }} />
      </div>
      <button
        class="icon-button"
        type="button"
        aria-label="Previous sentence"
        onClick={props.onPrevious}
      >
        <PreviousIcon />
      </button>
      <button
        class="play"
        type="button"
        aria-label={props.status === "playing" ? "Pause" : "Play"}
        onClick={props.onToggle}
      >
        <Show when={props.status === "playing"} fallback={<PlayIcon />}>
          <PauseIcon />
        </Show>
        <span>{props.status === "playing" ? "Pause" : "Play"}</span>
      </button>
      <button class="icon-button" type="button" aria-label="Next sentence" onClick={props.onNext}>
        <NextIcon />
      </button>
      <span class="mono">1.00x</span>
    </footer>
  );
}

function PreviousIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M7 6h2v12H7zM18 7v10l-8-5z" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M7 5h4v14H7zM13 5h4v14h-4z" />
    </svg>
  );
}

function NextIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M15 6h2v12h-2zM6 7v10l8-5z" />
    </svg>
  );
}
