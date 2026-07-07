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
import type { SentenceNarration, SentenceNarrationRequest } from "@readex/audio";
import {
  createWordInsight,
  dictionaryLookupFailed,
  dictionaryLookupNotFound,
  dictionaryLookupReady,
  forgetDictionaryEntry,
  listSavedDictionaryEntries,
  loadingDictionaryLookup,
  normalizeInsightKey,
  primaryDefinition,
  saveDictionaryEntry,
  type DictionaryLookupResult,
  type SavedDictionary,
  type SavedDictionaryEntry,
  type WordInsight
} from "@readex/learning";
import type { ReaderTextToken } from "@readex/text";
import { createNarrationRepository, toFriendlyNarrationError } from "../audio/narration-repository";
import { createDictionaryRepository } from "../learning/dictionary-repository";
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

interface SelectedWord {
  sentenceId: string;
  tokenIndex: number;
  surface: string;
}

export function ReaderExperience() {
  const repository = createBookRepository();
  const narrationRepository = createNarrationRepository();
  const dictionaryRepository = createDictionaryRepository();
  const sampleReader = buildFixtureReaderView();
  const [reader, setReader] = createSignal<ReaderView>(sampleReader);
  const [libraryBooks, setLibraryBooks] = createSignal<LibraryBookSummary[]>([]);
  const [libraryNotice, setLibraryNotice] = createSignal<string | null>(null);
  const [isImporting, setIsImporting] = createSignal(false);
  const [playback, setPlayback] = createSignal(createPlaybackState());
  const [activeNarration, setActiveNarration] = createSignal<SentenceNarration | null>(null);
  const [isPreparingNarration, setIsPreparingNarration] = createSignal(false);
  const [narrationNotice, setNarrationNotice] = createSignal<string | null>(null);
  const [savedDictionary, setSavedDictionary] = createSignal<SavedDictionary>(
    dictionaryRepository.loadSavedDictionary()
  );
  const [dictionaryLookups, setDictionaryLookups] = createSignal<
    Record<string, DictionaryLookupResult>
  >({});
  const [selectedWord, setSelectedWord] = createSignal<SelectedWord | null>(null);
  let activeHtmlAudio: HTMLAudioElement | null = null;
  let narrationRun = 0;

  const activeSentence = createMemo(() => reader().sentences[playback().activeSentenceIndex]);
  const highlight = createMemo(() => highlightSentence(activeSentence()?.id ?? null));
  const activeWordInsight = createMemo(() => {
    const selection = selectedWord();
    if (selection == null) return null;

    const key = normalizeInsightKey(selection.surface);
    return createWordInsight(
      selection.surface,
      savedDictionary(),
      dictionaryLookups()[key] ?? null
    );
  });
  const savedWords = createMemo(() => listSavedDictionaryEntries(savedDictionary()));
  const statusLabel = createMemo(() => {
    if (isPreparingNarration()) return "Preparing audio";
    if (narrationNotice() != null) return "Needs attention";

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
  const narrationStatusLabel = createMemo(() => {
    if (isPreparingNarration()) return "Preparing audio";
    if (narrationNotice() != null) return "Needs attention";
    if (activeNarration()?.readiness === "ready") return "Ready to listen";

    return reader().source === "sample" ? "Sample narration" : "Ready to listen";
  });

  onMount(() => {
    void refreshLibrary();
  });

  createEffect(() => {
    const currentPlayback = playback();
    const sentence = activeSentence();
    const currentReader = reader();

    if (currentPlayback.status !== "playing" || sentence == null) return;

    const runId = ++narrationRun;
    const request: SentenceNarrationRequest = {
      bookId: currentReader.book.id,
      chapterId: currentReader.chapter.id,
      sentenceId: sentence.id,
      sentenceIndex: sentence.index,
      text: sentence.text
    };

    setIsPreparingNarration(true);
    setNarrationNotice(null);

    void playSentenceNarration(request, runId, currentReader.sentences.length);

    onCleanup(() => {
      narrationRun += 1;
      setIsPreparingNarration(false);
      activeHtmlAudio?.pause();
      activeHtmlAudio = null;
      void narrationRepository.stopPreparedSentenceAudio().catch(() => undefined);
    });
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
    void lookupDictionaryWord(token.text);
    setSelectedWord({
      sentenceId: sentence.id,
      tokenIndex: token.index,
      surface: token.text
    });
  };

  const selectSavedWord = (word: SavedDictionaryEntry) => {
    setSelectedWord({
      sentenceId: "saved-words",
      tokenIndex: -1,
      surface: word.surface
    });
  };

  const isSelectedWord = (sentenceId: string, token: ReaderTextToken) =>
    token.kind === "word" &&
    selectedWord()?.sentenceId === sentenceId &&
    selectedWord()?.tokenIndex === token.index;

  const lookupDictionaryWord = async (surface: string) => {
    const key = normalizeInsightKey(surface);
    if (key.length === 0 || savedDictionary().entries[key] != null) return;

    setDictionaryLookups((current) => ({
      ...current,
      [key]: loadingDictionaryLookup()
    }));

    try {
      const entry = await dictionaryRepository.lookupWord(surface);
      setDictionaryLookups((current) => ({
        ...current,
        [key]: entry == null ? dictionaryLookupNotFound(surface) : dictionaryLookupReady(entry)
      }));
    } catch {
      setDictionaryLookups((current) => ({
        ...current,
        [key]: dictionaryLookupFailed()
      }));
    }
  };

  const persistSavedDictionary = (nextDictionary: SavedDictionary) => {
    setSavedDictionary(nextDictionary);
    dictionaryRepository.saveSavedDictionary(nextDictionary);
  };

  const saveDictionaryWord = (insight: WordInsight) => {
    if (insight.entry == null) return;
    persistSavedDictionary(saveDictionaryEntry(savedDictionary(), insight.entry));
  };

  const forgetSavedWord = (surface: string) => {
    persistSavedDictionary(forgetDictionaryEntry(savedDictionary(), surface));
  };

  const activateReader = (nextReader: ReaderView) => {
    setReader(nextReader);
    setPlayback(() =>
      selectPlaybackSentence(
        { activeSentenceIndex: nextReader.initialSentenceIndex, status: "idle" },
        nextReader.sentences.length,
        nextReader.initialSentenceIndex
      )
    );
    setActiveNarration(null);
    setNarrationNotice(null);
    setIsPreparingNarration(false);
    setSelectedWord(null);
  };

  const playSentenceNarration = async (
    request: SentenceNarrationRequest,
    runId: number,
    sentenceCount: number
  ) => {
    try {
      const narration = await narrationRepository.prepareSentenceAudio(request);
      if (runId !== narrationRun) return;

      setActiveNarration(narration);
      setIsPreparingNarration(false);

      if (narration.readiness !== "ready") {
        setNarrationNotice(narration.message ?? "Narration needs attention.");
        setPlayback((current) => pausePlayback(current));
        return;
      }

      if (narration.playbackMode === "html-audio" && narration.sourceUrl != null) {
        await playHtmlAudio(narration.sourceUrl, runId);
      } else {
        await narrationRepository.playPreparedSentenceAudio(request, narration);
      }

      if (runId !== narrationRun) return;
      setPlayback((current) => advancePlayback(current, sentenceCount));
    } catch (error) {
      if (runId !== narrationRun) return;

      setIsPreparingNarration(false);
      setNarrationNotice(toFriendlyNarrationError(error));
      setPlayback((current) => pausePlayback(current));
    }
  };

  const playHtmlAudio = (sourceUrl: string, runId: number): Promise<void> =>
    new Promise((resolve, reject) => {
      activeHtmlAudio?.pause();

      const audio = new Audio(sourceUrl);
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        reject(error);
      };

      activeHtmlAudio = audio;
      audio.onended = finish;
      audio.onpause = () => {
        if (runId !== narrationRun) finish();
      };
      audio.onerror = () => fail(new Error("Narration needs attention. Please try again."));
      audio.play().catch(fail);

      if (runId !== narrationRun) {
        audio.pause();
        finish();
      }
    });

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
                        insight={isSelectedWord(sentence.id, token) ? activeWordInsight() : null}
                        onSelect={selectWord}
                        onClear={() => setSelectedWord(null)}
                        onSave={saveDictionaryWord}
                      />
                    )}
                  </For>
                </p>
              )}
            </For>
          </article>
        </div>
      </section>

      <WordInspector
        insight={activeWordInsight()}
        savedWords={savedWords()}
        onSave={saveDictionaryWord}
        onForget={forgetSavedWord}
        onSelectSavedWord={selectSavedWord}
      />

      <PlaybackRail
        chapterTitle={reader().chapter.title}
        activeIndex={playback().activeSentenceIndex}
        sentenceCount={reader().sentences.length}
        status={playback().status}
        narrationStatus={narrationStatusLabel()}
        narrationNotice={narrationNotice()}
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
  insight: WordInsight | null;
  onSelect: (
    sentence: ReaderSentenceView,
    token: Extract<ReaderTextToken, { kind: "word" }>
  ) => void;
  onClear: () => void;
  onSave: (insight: WordInsight) => void;
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
      <Show when={props.selected ? props.insight : null}>
        {(insight) => (
          <WordPopover insight={insight()} onClear={props.onClear} onSave={props.onSave} />
        )}
      </Show>
    </span>
  );
}

interface WordPopoverProps {
  insight: WordInsight;
  onClear: () => void;
  onSave: (insight: WordInsight) => void;
}

function WordPopover(props: WordPopoverProps) {
  const runAction = (event: MouseEvent, action: () => void) => {
    event.stopPropagation();
    action();
  };
  const definition = () => primaryDefinition(props.insight.entry);

  return (
    <span class="word-popover" role="dialog" aria-label={`Insight for ${props.insight.surface}`}>
      <strong>{props.insight.surface}</strong>
      <DictionaryStatus insight={props.insight} compact />
      <Show when={definition()}>{(item) => <span>{item().definition}</span>}</Show>
      <Show when={definition()?.example}>
        {(example) => <span class="popover-example">{example()}</span>}
      </Show>
      <span class="popover-actions">
        <Show when={props.insight.status === "ready" && !props.insight.saved}>
          <button
            type="button"
            onClick={(event) => runAction(event, () => props.onSave(props.insight))}
          >
            Save
          </button>
        </Show>
      </span>
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
  savedWords: SavedDictionaryEntry[];
  onSave: (insight: WordInsight) => void;
  onForget: (surface: string) => void;
  onSelectSavedWord: (word: SavedDictionaryEntry) => void;
}

function WordInspector(props: WordInspectorProps) {
  return (
    <aside class="inspector" aria-label="Word insight">
      <span class="inspector-label">Word insight</span>
      <Show
        when={props.insight}
        fallback={
          <>
            <strong>No word selected</strong>
            <SavedWordList words={props.savedWords} onSelect={props.onSelectSavedWord} />
          </>
        }
      >
        {(insight) => (
          <>
            <div class="inspector-heading">
              <strong>{insight().surface}</strong>
              <DictionaryStatus insight={insight()} />
            </div>
            <div class="dictionary-actions">
              <Show when={insight().status === "ready" && !insight().saved}>
                <button type="button" onClick={() => props.onSave(insight())}>
                  Save
                </button>
              </Show>
              <Show when={insight().saved}>
                <button type="button" onClick={() => props.onForget(insight().surface)}>
                  Forget
                </button>
              </Show>
            </div>
            <dl>
              <Show when={insight().entry?.phonetic}>
                <div>
                  <dt>Pronunciation</dt>
                  <dd>{insight().entry?.phonetic}</dd>
                </div>
              </Show>
              <Show when={primaryDefinition(insight().entry)}>
                {(definition) => (
                  <div>
                    <dt>Definition</dt>
                    <dd>{definition().definition}</dd>
                  </div>
                )}
              </Show>
              <Show when={primaryDefinition(insight().entry)?.example}>
                {(example) => (
                  <div>
                    <dt>Example</dt>
                    <dd>{example()}</dd>
                  </div>
                )}
              </Show>
              <Show when={insight().entry?.meanings[0]?.partOfSpeech}>
                {(partOfSpeech) => (
                  <div>
                    <dt>Type</dt>
                    <dd>{partOfSpeech()}</dd>
                  </div>
                )}
              </Show>
              <Show when={primaryDefinition(insight().entry)?.synonyms.length}>
                <div>
                  <dt>Synonyms</dt>
                  <dd>{primaryDefinition(insight().entry)?.synonyms.slice(0, 6).join(", ")}</dd>
                </div>
              </Show>
              <Show when={insight().entry?.sourceUrl}>
                {(sourceUrl) => (
                  <div>
                    <dt>Source</dt>
                    <dd>
                      <a href={sourceUrl()} target="_blank" rel="noreferrer">
                        Dictionary
                      </a>
                    </dd>
                  </div>
                )}
              </Show>
              <Show when={insight().message != null && insight().entry == null}>
                <div>
                  <dt>Status</dt>
                  <dd>{insight().message}</dd>
                </div>
              </Show>
            </dl>
          </>
        )}
      </Show>
    </aside>
  );
}

interface DictionaryStatusProps {
  insight: WordInsight;
  compact?: boolean;
}

function DictionaryStatus(props: DictionaryStatusProps) {
  const label = () => {
    if (props.insight.saved) return "Saved";

    switch (props.insight.status) {
      case "loading":
        return "Looking up";
      case "ready":
        return "Definition found";
      case "not-found":
        return "Not found";
      case "error":
        return "Needs attention";
      default:
        return "Ready";
    }
  };

  return (
    <span
      classList={{
        "dictionary-state": true,
        compact: props.compact === true,
        attention: props.insight.status === "error" || props.insight.status === "not-found",
        saved: props.insight.saved
      }}
    >
      {label()}
    </span>
  );
}

interface SavedWordListProps {
  words: SavedDictionaryEntry[];
  onSelect: (word: SavedDictionaryEntry) => void;
}

function SavedWordList(props: SavedWordListProps) {
  return (
    <Show
      when={props.words.length > 0}
      fallback={<p class="inspector-empty">No saved words yet.</p>}
    >
      <section class="saved-word-list" aria-label="Saved words">
        <span class="inspector-section-title">Saved words</span>
        <For each={props.words}>
          {(word) => (
            <button class="saved-word-row" type="button" onClick={() => props.onSelect(word)}>
              <span>{word.surface}</span>
              <small>{primaryDefinition(word)?.definition ?? "Saved definition"}</small>
            </button>
          )}
        </For>
      </section>
    </Show>
  );
}

interface PlaybackRailProps {
  chapterTitle: string;
  activeIndex: number;
  sentenceCount: number;
  status: PlaybackStatus;
  narrationStatus: string;
  narrationNotice: string | null;
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
        <span classList={{ "narration-status": true, attention: props.narrationNotice != null }}>
          {props.narrationStatus}
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
