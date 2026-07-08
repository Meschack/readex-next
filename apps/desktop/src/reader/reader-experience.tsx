import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show
} from "solid-js";
import {
  createAudioSettings,
  createPrefetchingNarrationGateway,
  DEFAULT_AUDIO_SETTINGS,
  SUPPORTED_NARRATION_VOICES,
  type AudioSettings,
  type SentenceNarration,
  type SentenceNarrationRequest
} from "@readex/audio";
import {
  bookmarkedBookIds,
  filterLibraryBooks,
  hasLibrarySearchQuery,
  libraryImportNotice,
  resolveLibraryBookListState,
  type LibraryBookFilter,
  type LibraryBookListState
} from "@readex/library";
import {
  calculateReaderProgress,
  calculateSentenceRenderWindow,
  createPlaybackState,
  createReaderPreferences,
  createReadingPositionScheduler,
  finishSentencePlayback,
  highlightSentence,
  movePlayback,
  pausePlayback,
  playPlayback,
  type ReaderToolTab,
  searchReaderSentences,
  selectPlaybackSentence,
  sentenceMatchesQuery,
  type PlaybackStatus,
  type ReaderPlaybackState,
  type ReaderProgress,
  type ReaderSearchResult
} from "@readex/reader";
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
import { tokenizeReaderText, type ReaderTextToken } from "@readex/text";
import {
  createAudioCacheRepository,
  type AudioCacheStatsDto
} from "../audio/audio-cache-repository";
import { createAudioSettingsRepository } from "../audio/audio-settings-repository";
import { createNarrationRepository, toFriendlyNarrationError } from "../audio/narration-repository";
import { createDictionaryRepository } from "../learning/dictionary-repository";
import {
  createBookRepository,
  toFriendlyLibraryError,
  type BookExportDataDto,
  type LibraryBookmarkDto,
  type LibrarySearchResultDto,
  type SaveReadingPositionInput
} from "../library/book-repository";
import type { LibraryBookSummary } from "./reader-document";
import {
  buildFixtureReaderView,
  buildReaderViewFromDocument,
  type ReaderChapterNavigationItem,
  type ReaderParagraphView,
  type ReaderSentenceView,
  type ReaderView
} from "./reader-view";
import { createReaderPreferencesRepository } from "./reader-preferences-repository";

type InspectorTab = ReaderToolTab;
type AppView = "reader" | "library";

interface SelectedWord {
  sentenceId: string;
  tokenIndex: number;
  surface: string;
}

interface OpenBookOptions {
  chapterId?: string;
  sentenceIndex?: number;
  playbackStatus?: PlaybackStatus;
}

const renderedSentenceLead = 36;
const renderedSentenceTrail = 96;
const playbackPositionSaveDelayMs = 2_500;

type PositionSaveIntent = "immediate" | "playback";

export function ReaderExperience() {
  const repository = createBookRepository();
  const narrationRepository = createPrefetchingNarrationGateway(createNarrationRepository());
  const dictionaryRepository = createDictionaryRepository();
  const audioCacheRepository = createAudioCacheRepository();
  const audioSettingsRepository = createAudioSettingsRepository();
  const readerPreferencesRepository = createReaderPreferencesRepository();
  const readerPreferences = readerPreferencesRepository.load();
  const sampleReader = buildFixtureReaderView();

  const [reader, setReader] = createSignal<ReaderView>(sampleReader);
  const [libraryBooks, setLibraryBooks] = createSignal<LibraryBookSummary[]>([]);
  const [libraryNotice, setLibraryNotice] = createSignal<string | null>(null);
  const [libraryQuery, setLibraryQuery] = createSignal("");
  const [libraryFilter, setLibraryFilter] = createSignal<LibraryBookFilter>(
    readerPreferences.libraryFilter
  );
  const [librarySearchResults, setLibrarySearchResults] = createSignal<LibrarySearchResultDto[]>(
    []
  );
  const [bookmarks, setBookmarks] = createSignal<LibraryBookmarkDto[]>([]);
  const [bookmarkNotice, setBookmarkNotice] = createSignal<string | null>(null);
  const [readerSearchQuery, setReaderSearchQuery] = createSignal("");
  const [inspectorTab, setInspectorTab] = createSignal<InspectorTab>(readerPreferences.toolTab);
  const [readerContentFontSize, setReaderContentFontSize] = createSignal(
    readerPreferences.contentFontSize
  );
  const [activeView, setActiveView] = createSignal<AppView>("reader");
  const [isLibraryLoading, setIsLibraryLoading] = createSignal(false);
  const [isLibrarySearching, setIsLibrarySearching] = createSignal(false);
  const [isImporting, setIsImporting] = createSignal(false);
  const [playback, setPlayback] = createSignal(createPlaybackState());
  const [activeNarration, setActiveNarration] = createSignal<SentenceNarration | null>(null);
  const [isPreparingNarration, setIsPreparingNarration] = createSignal(false);
  const [narrationNotice, setNarrationNotice] = createSignal<string | null>(null);
  const [audioSettings, setAudioSettings] = createSignal<AudioSettings>(
    audioSettingsRepository.load()
  );
  const [audioCacheStats, setAudioCacheStats] = createSignal<AudioCacheStatsDto | null>(null);
  const [audioCacheNotice, setAudioCacheNotice] = createSignal<string | null>(null);
  const [exportNotice, setExportNotice] = createSignal<string | null>(null);
  const [savedDictionary, setSavedDictionary] = createSignal<SavedDictionary>(
    dictionaryRepository.loadSavedDictionary()
  );
  const [dictionaryLookups, setDictionaryLookups] = createSignal<
    Record<string, DictionaryLookupResult>
  >({});
  const [selectedWord, setSelectedWord] = createSignal<SelectedWord | null>(null);
  const readingPositionScheduler = createReadingPositionScheduler<SaveReadingPositionInput>({
    delayMs: playbackPositionSaveDelayMs,
    save: (position) => repository.saveReadingPosition(position),
    onError: () => setLibraryNotice("We couldn't save your place just now.")
  });

  let activeHtmlAudio: HTMLAudioElement | null = null;
  let narrationRun = 0;
  let librarySearchRun = 0;
  let nextPositionSaveIntent: PositionSaveIntent | null = null;
  let readerSearchInput: HTMLInputElement | undefined;
  const sentenceElements = new Map<string, HTMLElement>();

  const activeSentence = createMemo(() => reader().sentences[playback().activeSentenceIndex]);
  const highlight = createMemo(() => highlightSentence(activeSentence()?.id ?? null));
  const visibleSentenceRange = createMemo(() => {
    return calculateSentenceRenderWindow({
      activeSentenceIndex: playback().activeSentenceIndex,
      leadCount: renderedSentenceLead,
      sentenceCount: reader().sentences.length,
      trailCount: renderedSentenceTrail
    });
  });
  const visibleSentences = createMemo(() => {
    const range = visibleSentenceRange();

    return reader().sentences.slice(range.start, range.end);
  });
  const visibleParagraphs = createMemo(() => {
    const range = visibleSentenceRange();

    return reader()
      .paragraphs.map((paragraph) => ({
        ...paragraph,
        sentences: paragraph.sentences.filter(
          (sentence) => sentence.index >= range.start && sentence.index < range.end
        )
      }))
      .filter((paragraph) => paragraph.sentences.length > 0);
  });
  const readerProgress = createMemo(() =>
    calculateReaderProgress(reader().chapters, reader().chapter.id, playback().activeSentenceIndex)
  );
  const currentBookBookmarks = createMemo(() =>
    bookmarks().filter((bookmark) => bookmark.bookId === reader().book.id)
  );
  const activeBookmark = createMemo(() => {
    const sentence = activeSentence();
    if (sentence == null) return null;

    return (
      currentBookBookmarks().find(
        (bookmark) =>
          bookmark.chapterId === reader().chapter.id && bookmark.sentenceId === sentence.id
      ) ?? null
    );
  });
  const bookmarkedSentenceIds = createMemo(
    () =>
      new Set(
        currentBookBookmarks()
          .filter((bookmark) => bookmark.chapterId === reader().chapter.id)
          .map((bookmark) => bookmark.sentenceId)
      )
  );
  const filteredBooks = createMemo(() =>
    filterLibraryBooks({
      books: libraryBooks(),
      query: libraryQuery(),
      filter: libraryFilter(),
      bookmarkedBookIds: bookmarkedBookIds(bookmarks())
    })
  );
  const libraryBookListState = createMemo(() =>
    resolveLibraryBookListState({
      totalBookCount: libraryBooks().length,
      visibleBookCount: filteredBooks().length,
      query: libraryQuery(),
      filter: libraryFilter(),
      loading: isLibraryLoading()
    })
  );
  const readerSearchResults = createMemo(() =>
    searchReaderSentences(reader().sentences, readerSearchQuery())
  );
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
  const narrationStatusLabel = createMemo(() => {
    if (isPreparingNarration()) return "Preparing audio";
    if (narrationNotice() != null) return "Needs attention";
    if (activeNarration()?.readiness === "ready") return "Ready to listen";

    return reader().source === "sample" ? "Sample narration" : "Ready to listen";
  });

  onMount(() => {
    void refreshLibrary();
    void refreshAllBookmarks();
    void refreshAudioCacheStats();

    window.addEventListener("keydown", handleShortcut);
    onCleanup(() => window.removeEventListener("keydown", handleShortcut));
  });
  onCleanup(() => readingPositionScheduler.flush());

  createEffect(() => {
    const settings = audioSettings();
    if (activeHtmlAudio != null) {
      activeHtmlAudio.playbackRate = settings.playbackRate;
    }
    audioSettingsRepository.save(settings);
  });

  createEffect(() => {
    readerPreferencesRepository.save({
      toolTab: inspectorTab(),
      libraryFilter: libraryFilter(),
      contentFontSize: readerContentFontSize()
    });
  });

  createEffect(() => {
    const sentenceId = activeSentence()?.id;
    if (sentenceId == null) return;

    sentenceElements.get(sentenceId)?.scrollIntoView({
      block: "center",
      behavior: "smooth"
    });
  });

  createEffect(() => {
    const query = libraryQuery();
    const runId = ++librarySearchRun;

    if (query.trim().length < 2) {
      setIsLibrarySearching(false);
      setLibrarySearchResults([]);
      return;
    }

    setIsLibrarySearching(true);
    void repository
      .searchLibrary({ query, limit: 8 })
      .then((results) => {
        if (runId !== librarySearchRun) return;
        setLibrarySearchResults(results);
        setIsLibrarySearching(false);
      })
      .catch(() => {
        if (runId !== librarySearchRun) return;
        setLibrarySearchResults([]);
        setIsLibrarySearching(false);
        setLibraryNotice("We couldn't search your library just now.");
      });
  });

  createEffect(() => {
    const currentPlayback = playback();
    const sentence = activeSentence();
    const currentReader = reader();

    if (currentPlayback.status !== "playing" || sentence == null) return;

    const runId = ++narrationRun;
    const request = createSentenceNarrationRequest(
      currentReader,
      sentence,
      audioSettings().voiceId
    );

    setIsPreparingNarration(true);
    setNarrationNotice(null);

    void playSentenceNarration(request, runId, currentReader, currentPlayback.activeSentenceIndex);

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
    const saveIntent = nextPositionSaveIntent;
    nextPositionSaveIntent = null;

    if (currentReader.source !== "library" || sentence == null) {
      if (currentReader.source !== "library") readingPositionScheduler.flush();
      return;
    }

    const position: SaveReadingPositionInput = {
      bookId: currentReader.book.id,
      chapterId: currentReader.chapter.id,
      sentenceIndex: sentence.index
    };

    if (saveIntent === "immediate" || currentPlayback.status !== "playing") {
      readingPositionScheduler.saveNow(position);
      return;
    }

    readingPositionScheduler.schedulePlaybackSave(position);
  });

  const handleShortcut = (event: KeyboardEvent) => {
    if (event.defaultPrevented || isTypingTarget(event.target)) return;

    if (event.key === " ") {
      event.preventDefault();
      togglePlayback();
      return;
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      moveSentence(-1);
      return;
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      moveSentence(1);
      return;
    }

    if (event.key.toLocaleLowerCase() === "b") {
      event.preventDefault();
      void toggleActiveBookmark();
      return;
    }

    if (event.key === "/") {
      event.preventDefault();
      setInspectorTab("search");
      queueMicrotask(() => readerSearchInput?.focus());
      return;
    }

    if (event.key === "Escape") {
      setSelectedWord(null);
      setReaderSearchQuery("");
    }
  };

  const togglePlayback = () => {
    setPlayback((current) =>
      current.status === "playing"
        ? pausePlayback(current)
        : playPlayback(current, reader().sentences.length)
    );
  };

  const moveSentence = (direction: -1 | 1) => {
    commitPlaybackJump((current) => movePlayback(current, reader().sentences.length, direction));
  };

  const selectSentence = (sentenceIndex: number) => {
    commitPlaybackJump((current) =>
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
    setInspectorTab("word");
  };

  const selectSavedWord = (word: SavedDictionaryEntry) => {
    setSelectedWord({
      sentenceId: "saved-words",
      tokenIndex: -1,
      surface: word.surface
    });
    setInspectorTab("word");
  };

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

  const updateAudioSettings = (nextSettings: Partial<AudioSettings>) => {
    const currentSettings = audioSettings();
    const nextAudioSettings = createAudioSettings({ ...currentSettings, ...nextSettings });

    if (nextAudioSettings.voiceId !== currentSettings.voiceId) {
      activeHtmlAudio?.pause();
      activeHtmlAudio = null;
      narrationRepository.clearPrefetchedNarrations();
      setActiveNarration(null);
      setNarrationNotice(null);
      setPlayback((current) => pausePlayback(current));
    }

    setAudioSettings(nextAudioSettings);
  };

  const updateReaderContentFontSize = (fontSize: number) => {
    setReaderContentFontSize(
      createReaderPreferences({ contentFontSize: fontSize }).contentFontSize
    );
  };

  const jumpPlaybackStatus = (): PlaybackStatus =>
    playback().status === "ended" ? "paused" : playback().status;

  const commitPlaybackJump = (
    resolvePlayback: (current: ReaderPlaybackState) => ReaderPlaybackState
  ) => {
    nextPositionSaveIntent = "immediate";
    batch(() => {
      setPlayback(resolvePlayback);
      setActiveNarration(null);
      setNarrationNotice(null);
      setIsPreparingNarration(false);
      setSelectedWord(null);
    });
    narrationRepository.clearPrefetchedNarrations();
  };

  const activateReader = (
    nextReader: ReaderView,
    sentenceIndex = nextReader.initialSentenceIndex,
    playbackStatus: PlaybackStatus = "idle"
  ) => {
    readingPositionScheduler.flush();
    nextPositionSaveIntent = "immediate";
    sentenceElements.clear();
    batch(() => {
      setReader(nextReader);
      setPlayback(() =>
        selectPlaybackSentence(
          { activeSentenceIndex: sentenceIndex, status: playbackStatus },
          nextReader.sentences.length,
          sentenceIndex
        )
      );
      setActiveNarration(null);
      setNarrationNotice(null);
      setIsPreparingNarration(false);
      setSelectedWord(null);
    });
    narrationRepository.clearPrefetchedNarrations();
  };

  const playSentenceNarration = async (
    request: SentenceNarrationRequest,
    runId: number,
    currentReader: ReaderView,
    activeSentenceIndex: number
  ) => {
    try {
      const narration = await narrationRepository.prepareSentenceAudio(request);
      if (runId !== narrationRun) return;

      setActiveNarration(narration);
      setIsPreparingNarration(false);
      if (!narration.cached) void refreshAudioCacheStats();

      if (narration.readiness !== "ready") {
        setNarrationNotice(narration.message ?? "Narration needs attention.");
        setPlayback((current) => pausePlayback(current));
        return;
      }

      prefetchNextSentenceNarration(currentReader, activeSentenceIndex, runId);

      if (narration.playbackMode === "html-audio" && narration.sourceUrl != null) {
        await playHtmlAudio(narration.sourceUrl, runId);
      } else {
        await narrationRepository.playPreparedSentenceAudio(request, narration);
      }

      if (runId !== narrationRun) return;
      nextPositionSaveIntent = "playback";
      setPlayback((current) =>
        finishSentencePlayback(current, currentReader.sentences.length, audioSettings().autoAdvance)
      );
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
      audio.playbackRate = audioSettings().playbackRate;
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

  const prefetchNextSentenceNarration = (
    currentReader: ReaderView,
    activeSentenceIndex: number,
    runId: number
  ) => {
    const nextSentence = currentReader.sentences[activeSentenceIndex + 1];
    if (nextSentence == null) return;

    const request = createSentenceNarrationRequest(
      currentReader,
      nextSentence,
      audioSettings().voiceId
    );

    void narrationRepository
      .prefetchSentenceAudio(request)
      .then(() => {
        if (runId === narrationRun) void refreshAudioCacheStats();
      })
      .catch(() => undefined);
  };

  const refreshLibrary = async () => {
    setIsLibraryLoading(true);
    try {
      const books = await repository.listBooks();
      setLibraryBooks(books);

      if (reader().source === "sample" && books[0] != null) {
        await openLibraryBook(books[0].id);
      }
    } catch (error) {
      setLibraryNotice(toFriendlyLibraryError(error));
    } finally {
      setIsLibraryLoading(false);
    }
  };

  const refreshAllBookmarks = async () => {
    try {
      setBookmarks(await repository.listBookmarks());
    } catch (error) {
      setBookmarkNotice(toFriendlyLibraryError(error));
    }
  };

  const refreshBookmarks = async (bookId: string) => {
    try {
      const nextBookmarks = await repository.listBookmarks(bookId);
      setBookmarks((current) => [
        ...nextBookmarks,
        ...current.filter((bookmark) => bookmark.bookId !== bookId)
      ]);
    } catch (error) {
      setBookmarkNotice(toFriendlyLibraryError(error));
    }
  };

  const refreshAudioCacheStats = async () => {
    try {
      setAudioCacheStats(await audioCacheRepository.getStats());
    } catch (error) {
      setAudioCacheNotice(toFriendlyNarrationError(error));
    }
  };

  const clearAudioCache = async () => {
    try {
      narrationRepository.clearPrefetchedNarrations();
      setAudioCacheStats(await audioCacheRepository.clear());
      setAudioCacheNotice("Prepared audio cleared.");
    } catch (error) {
      setAudioCacheNotice(toFriendlyNarrationError(error));
    }
  };

  const openSampleReader = () => {
    activateReader(buildFixtureReaderView());
    setActiveView("reader");
    setLibraryNotice(null);
    void refreshBookmarks(sampleReader.book.id);
  };

  const openChapter = async (chapterId: string) => {
    if (chapterId === reader().chapter.id) return;

    if (reader().source === "sample") {
      const nextReader = buildFixtureReaderView({ chapterId, sentenceIndex: 0 });
      activateReader(nextReader, 0, jumpPlaybackStatus());
      setLibraryNotice(null);
      void refreshBookmarks(nextReader.book.id);
      return;
    }

    await openLibraryBook(reader().book.id, {
      chapterId,
      sentenceIndex: 0,
      playbackStatus: jumpPlaybackStatus()
    });
  };

  const openLibraryBook = async (bookId: string, options: OpenBookOptions = {}) => {
    try {
      const document = await repository.openBook(bookId, options.chapterId);
      const nextReader = buildReaderViewFromDocument(document, options);
      activateReader(
        nextReader,
        options.sentenceIndex ?? nextReader.initialSentenceIndex,
        options.playbackStatus ?? "idle"
      );
      setActiveView("reader");
      setLibraryNotice(null);
      await refreshBookmarks(bookId);
    } catch (error) {
      setLibraryNotice(toFriendlyLibraryError(error));
    }
  };

  const importBook = async () => {
    if (isImporting()) return;

    const existingBookIds = new Set(libraryBooks().map((book) => book.id));
    setIsImporting(true);
    setLibraryNotice(null);

    try {
      const document = await repository.importBookFromDialog();
      if (document == null) return;

      const nextReader = buildReaderViewFromDocument(document);
      const importOutcome = existingBookIds.has(nextReader.book.id) ? "reopened" : "added";
      activateReader(nextReader);
      setActiveView("reader");
      setLibraryNotice(libraryImportNotice(importOutcome));
      setLibraryBooks(await repository.listBooks());
      await refreshBookmarks(nextReader.book.id);
    } catch (error) {
      setLibraryNotice(toFriendlyLibraryError(error));
    } finally {
      setIsImporting(false);
    }
  };

  const toggleActiveBookmark = async () => {
    const existing = activeBookmark();
    if (existing != null) {
      await deleteBookmark(existing.id);
      return;
    }

    const sentence = activeSentence();
    if (sentence == null) return;

    try {
      const bookmark = await repository.saveBookmark({
        bookId: reader().book.id,
        bookTitle: reader().book.title,
        chapterId: reader().chapter.id,
        chapterTitle: reader().chapter.title,
        sentenceId: sentence.id,
        sentenceIndex: sentence.index,
        text: sentence.text,
        note: null
      });

      setBookmarks((current) => [bookmark, ...current.filter((item) => item.id !== bookmark.id)]);
      setBookmarkNotice("Bookmark saved.");
      setInspectorTab("bookmarks");
    } catch (error) {
      setBookmarkNotice(toFriendlyLibraryError(error));
    }
  };

  const deleteBookmark = async (bookmarkId: string) => {
    try {
      await repository.deleteBookmark(bookmarkId);
      setBookmarks((current) => current.filter((bookmark) => bookmark.id !== bookmarkId));
      setBookmarkNotice("Bookmark removed.");
    } catch (error) {
      setBookmarkNotice(toFriendlyLibraryError(error));
    }
  };

  const openBookmark = async (bookmark: LibraryBookmarkDto) => {
    if (bookmark.bookId === reader().book.id && bookmark.chapterId === reader().chapter.id) {
      selectSentence(bookmark.sentenceIndex);
      setInspectorTab("bookmarks");
      return;
    }

    if (bookmark.bookId === sampleReader.book.id) {
      activateReader(
        buildFixtureReaderView({
          chapterId: bookmark.chapterId,
          sentenceIndex: bookmark.sentenceIndex
        }),
        bookmark.sentenceIndex,
        jumpPlaybackStatus()
      );
      setInspectorTab("bookmarks");
      return;
    }

    await openLibraryBook(bookmark.bookId, {
      chapterId: bookmark.chapterId,
      sentenceIndex: bookmark.sentenceIndex,
      playbackStatus: bookmark.bookId === reader().book.id ? jumpPlaybackStatus() : "idle"
    });
    setInspectorTab("bookmarks");
  };

  const openLibrarySearchResult = async (result: LibrarySearchResultDto) => {
    if (result.kind === "sentence" && result.chapterId != null && result.sentenceIndex != null) {
      if (result.bookId === reader().book.id && result.chapterId === reader().chapter.id) {
        selectSentence(result.sentenceIndex);
        return;
      }

      await openLibraryBook(result.bookId, {
        chapterId: result.chapterId,
        sentenceIndex: result.sentenceIndex,
        playbackStatus: result.bookId === reader().book.id ? jumpPlaybackStatus() : "idle"
      });
      return;
    }

    await openLibraryBook(result.bookId);
  };

  const openReaderSearchResult = (result: ReaderSearchResult<ReaderSentenceView>) => {
    selectSentence(result.sentence.index);
  };

  const exportCurrentBook = async () => {
    try {
      const data =
        reader().source === "library"
          ? await repository.exportBookData(reader().book.id)
          : createSampleExport(reader(), playback().activeSentenceIndex, currentBookBookmarks());

      const fileName = `${slugify(reader().book.title)}-readex-export.json`;
      downloadJson(fileName, data);
      setExportNotice(`Downloaded ${fileName}. Check your Downloads folder.`);
    } catch (error) {
      setExportNotice(toFriendlyLibraryError(error));
    }
  };

  return (
    <main class="readex-shell">
      <LibraryRail
        activeView={activeView()}
        activeBookId={reader().book.id}
        books={filteredBooks()}
        bookListState={libraryBookListState()}
        hasLibraryBooks={libraryBooks().length > 0}
        query={libraryQuery()}
        filter={libraryFilter()}
        importing={isImporting()}
        searching={isLibrarySearching()}
        notice={libraryNotice()}
        searchResults={librarySearchResults()}
        onQueryChange={setLibraryQuery}
        onFilterChange={setLibraryFilter}
        onImport={importBook}
        onOpenBook={openLibraryBook}
        onRetryLibrary={refreshLibrary}
        onOpenSample={openSampleReader}
        onOpenSearchResult={openLibrarySearchResult}
        onOpenView={setActiveView}
        onOpenToolTab={setInspectorTab}
      />

      <Show
        when={activeView() === "reader"}
        fallback={
          <LibraryWorkspace
            books={filteredBooks()}
            totalBookCount={libraryBooks().length}
            bookListState={libraryBookListState()}
            query={libraryQuery()}
            filter={libraryFilter()}
            importing={isImporting()}
            notice={libraryNotice()}
            onQueryChange={setLibraryQuery}
            onFilterChange={setLibraryFilter}
            onImport={importBook}
            onOpenBook={openLibraryBook}
            onRetryLibrary={refreshLibrary}
            onOpenSample={openSampleReader}
          />
        }
      >
        <section class="reader-surface" aria-label="Reader">
          <ReaderTopAppBar
            bookTitle={reader().book.title}
            onOpenSearch={() => setInspectorTab("search")}
            onOpenSettings={() => setInspectorTab("settings")}
          />

          <ChapterNavigator
            chapters={reader().chapters}
            activeChapterId={reader().chapter.id}
            progress={readerProgress()}
            volume={reader().book.author || reader().book.title}
            onOpenChapter={openChapter}
          />

          <div class="reader-layout">
            <div class="audio-margin" aria-hidden="true">
              <For each={visibleSentences()}>
                {(sentence) => (
                  <span
                    classList={{
                      marker: true,
                      active: highlight().activeSentenceId === sentence.id,
                      bookmarked: bookmarkedSentenceIds().has(sentence.id)
                    }}
                  />
                )}
              </For>
            </div>

            <article
              class="page"
              aria-label={`${reader().chapter.title} text`}
              style={{ "font-size": `${readerContentFontSize()}px` }}
            >
              <h1 class="article-title">{reader().book.title}</h1>
              <Show when={visibleSentenceRange().hiddenBefore > 0}>
                <button
                  class="sentence-window-jump"
                  type="button"
                  onClick={() => selectSentence(visibleSentenceRange().start - 1)}
                >
                  Previous {Math.min(renderedSentenceLead, visibleSentenceRange().hiddenBefore)}{" "}
                  sentences
                </button>
              </Show>
              <For each={visibleParagraphs()}>
                {(paragraph) => (
                  <ReaderParagraph
                    paragraph={paragraph}
                    activeSentenceId={highlight().activeSentenceId}
                    bookmarkedSentenceIds={bookmarkedSentenceIds()}
                    readerSearchQuery={readerSearchQuery()}
                    selectedWord={selectedWord()}
                    activeWordInsight={activeWordInsight()}
                    onRegisterSentence={(sentenceId, element) => {
                      sentenceElements.set(sentenceId, element);
                    }}
                    onUnregisterSentence={(sentenceId) => {
                      sentenceElements.delete(sentenceId);
                    }}
                    onSelectSentence={selectSentence}
                    onSelectWord={selectWord}
                    onClearWord={() => setSelectedWord(null)}
                    onSaveWord={saveDictionaryWord}
                  />
                )}
              </For>
              <Show when={visibleSentenceRange().hiddenAfter > 0}>
                <button
                  class="sentence-window-jump"
                  type="button"
                  onClick={() => selectSentence(visibleSentenceRange().end)}
                >
                  Next {Math.min(renderedSentenceTrail, visibleSentenceRange().hiddenAfter)}{" "}
                  sentences
                </button>
              </Show>
            </article>
          </div>
        </section>

        <ReaderInspector
          tab={inspectorTab()}
          insight={activeWordInsight()}
          savedWords={savedWords()}
          readerSearchQuery={readerSearchQuery()}
          readerSearchResults={readerSearchResults()}
          bookmarks={currentBookBookmarks()}
          activeBookmark={activeBookmark()}
          bookmarkNotice={bookmarkNotice()}
          audioSettings={audioSettings()}
          readerContentFontSize={readerContentFontSize()}
          audioCacheStats={audioCacheStats()}
          audioCacheNotice={audioCacheNotice()}
          exportNotice={exportNotice()}
          onTabChange={setInspectorTab}
          onSaveWord={saveDictionaryWord}
          onForgetWord={forgetSavedWord}
          onSelectSavedWord={selectSavedWord}
          onReaderSearchQueryChange={setReaderSearchQuery}
          onReaderSearchResult={openReaderSearchResult}
          onReaderSearchInputReady={(input) => {
            readerSearchInput = input;
          }}
          onToggleBookmark={toggleActiveBookmark}
          onOpenBookmark={openBookmark}
          onDeleteBookmark={deleteBookmark}
          onAudioSettingsChange={updateAudioSettings}
          onReaderContentFontSizeChange={updateReaderContentFontSize}
          onRefreshCache={refreshAudioCacheStats}
          onClearCache={clearAudioCache}
          onExportBook={exportCurrentBook}
        />

        <PlaybackRail
          bookTitle={reader().book.title}
          author={reader().book.author}
          coverImageSrc={reader().book.coverImageSrc}
          chapterTitle={reader().chapter.title}
          progress={readerProgress()}
          sentenceCount={reader().sentences.length}
          status={playback().status}
          narrationStatus={narrationStatusLabel()}
          narrationNotice={narrationNotice()}
          playbackRate={audioSettings().playbackRate}
          onPrevious={() => moveSentence(-1)}
          onToggle={togglePlayback}
          onNext={() => moveSentence(1)}
        />
      </Show>
    </main>
  );
}

interface ReaderTopAppBarProps {
  bookTitle: string;
  onOpenSearch: () => void;
  onOpenSettings: () => void;
}

function ReaderTopAppBar(props: ReaderTopAppBarProps) {
  return (
    <header class="top-app-bar">
      <div class="top-reading-title">
        <span>Now reading</span>
        <strong>{props.bookTitle}</strong>
      </div>
      <div class="top-app-actions">
        <button type="button" aria-label="Open search" onClick={props.onOpenSearch}>
          <HeadphonesIcon />
        </button>
        <button type="button" aria-label="Open settings" onClick={props.onOpenSettings}>
          <MoreIcon />
        </button>
      </div>
    </header>
  );
}

interface ChapterNavigatorProps {
  chapters: ReaderChapterNavigationItem[];
  activeChapterId: string;
  progress: ReaderProgress;
  volume: string;
  onOpenChapter: (chapterId: string) => void;
}

function ChapterNavigator(props: ChapterNavigatorProps) {
  const activeChapter = () =>
    props.chapters.find((chapter) => chapter.id === props.activeChapterId) ?? props.chapters[0];

  return (
    <nav class="chapter-navigation" aria-label="Chapter navigation">
      <label class="chapter-meta-block">
        <span>Chapter</span>
        <select
          aria-label="Current chapter"
          value={props.activeChapterId}
          onChange={(event) => props.onOpenChapter(event.currentTarget.value)}
        >
          <For each={props.chapters}>
            {(chapter) => <option value={chapter.id}>{chapter.title}</option>}
          </For>
        </select>
      </label>
      <span class="chapter-divider" aria-hidden="true" />
      <div class="chapter-meta-block">
        <span>Volume</span>
        <strong>{props.volume}</strong>
      </div>
      <div class="chapter-meta-block chapter-progress-meta">
        <span>Chapter Progress</span>
        <strong>
          {activeChapter()?.sentenceCount ?? props.progress.chapterSentenceCount} sentence
          {(activeChapter()?.sentenceCount ?? props.progress.chapterSentenceCount) === 1 ? "" : "s"}
        </strong>
      </div>
    </nav>
  );
}

interface LibraryRailProps {
  activeView: AppView;
  activeBookId: string;
  books: LibraryBookSummary[];
  bookListState: LibraryBookListState;
  hasLibraryBooks: boolean;
  query: string;
  filter: LibraryBookFilter;
  importing: boolean;
  searching: boolean;
  notice: string | null;
  searchResults: LibrarySearchResultDto[];
  onQueryChange: (query: string) => void;
  onFilterChange: (filter: LibraryBookFilter) => void;
  onImport: () => void;
  onOpenBook: (bookId: string) => void;
  onRetryLibrary: () => void;
  onOpenSample: () => void;
  onOpenSearchResult: (result: LibrarySearchResultDto) => void;
  onOpenView: (view: AppView) => void;
  onOpenToolTab: (tab: InspectorTab) => void;
}

function LibraryRail(props: LibraryRailProps) {
  const hasSearchQuery = () => hasLibrarySearchQuery(props.query);

  return (
    <aside class="library-rail" aria-label="Library">
      <header class="side-brand">
        <strong>Readex</strong>
        <span>Premium Immersive Reading</span>
      </header>

      <nav class="nav-list" aria-label="Primary">
        <button
          classList={{ "nav-link": true, active: props.activeView === "reader" }}
          type="button"
          onClick={() => props.onOpenView("reader")}
        >
          <ReaderIcon />
          <span>Reader</span>
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
            <span>Library</span>
          </summary>
          <section class="library-actions" aria-label="Book library">
            <div class="library-controls">
              <input
                aria-label="Search library"
                type="search"
                value={props.query}
                placeholder="Search library"
                onInput={(event) => props.onQueryChange(event.currentTarget.value)}
              />
              <select
                aria-label="Library filter"
                value={props.filter}
                onChange={(event) =>
                  props.onFilterChange(event.currentTarget.value as LibraryBookFilter)
                }
              >
                <option value="all">All</option>
                <option value="in-progress">In progress</option>
                <option value="bookmarked">Bookmarked</option>
              </select>
            </div>
            <Show when={props.notice}>
              {(notice) => (
                <StateNotice message={notice()} onRetry={props.onRetryLibrary} compact />
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
                      {book.author} · {book.chapterCount} chapter
                      {book.chapterCount === 1 ? "" : "s"}
                    </small>
                  </button>
                )}
              </For>
              <BookListState
                state={props.bookListState}
                hasLibraryBooks={props.hasLibraryBooks}
                importing={props.importing}
                onImport={props.onImport}
              />
            </div>
          </section>
        </details>
        <button class="nav-link" type="button" onClick={() => props.onOpenToolTab("bookmarks")}>
          <BookmarkIcon />
          <span>Bookmarks</span>
        </button>
        <button class="nav-link" type="button" onClick={() => props.onOpenToolTab("word")}>
          <WordIcon />
          <span>Words</span>
        </button>
      </nav>

      <section class="side-import">
        <button
          class="import-button"
          type="button"
          disabled={props.importing}
          onClick={props.onImport}
        >
          <PlusIcon />
          <span>{props.importing ? "Adding..." : "Add EPUB"}</span>
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
    </aside>
  );
}

interface LibraryWorkspaceProps {
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

function LibraryWorkspace(props: LibraryWorkspaceProps) {
  const hasNoBooks = () => props.totalBookCount === 0 && props.bookListState !== "loading";

  return (
    <section class="library-workspace" aria-label="Library workspace">
      <header class="library-topbar">
        <h1>Library</h1>
        <div class="top-app-actions">
          <button type="button" aria-label="Listen">
            <HeadphonesIcon />
          </button>
          <button type="button" aria-label="More actions">
            <MoreIcon />
          </button>
          <span class="user-chip" aria-hidden="true">
            R
          </span>
        </div>
      </header>

      <Show
        when={!hasNoBooks()}
        fallback={
          <EmptyLibraryState
            importing={props.importing}
            notice={props.notice}
            onImport={props.onImport}
            onOpenSample={props.onOpenSample}
            onRetryLibrary={props.onRetryLibrary}
          />
        }
      >
        <section class="library-collection" aria-label="Book collection">
          <div class="library-collection-header">
            <div>
              <p>All Books</p>
              <h2>Your Collection</h2>
              <span>Manage your digital shelves and reading progress.</span>
            </div>
            <label class="library-search">
              <SearchIcon />
              <input
                aria-label="Search library"
                type="search"
                value={props.query}
                placeholder="Search library..."
                onInput={(event) => props.onQueryChange(event.currentTarget.value)}
              />
            </label>
          </div>

          <div class="library-filter-row" aria-label="Library filters">
            <button
              classList={{ active: props.filter === "all" }}
              type="button"
              onClick={() => props.onFilterChange("all")}
            >
              Recent
            </button>
            <button
              classList={{ active: props.filter === "in-progress" }}
              type="button"
              onClick={() => props.onFilterChange("in-progress")}
            >
              In progress
            </button>
            <button type="button" onClick={() => props.onFilterChange("all")}>
              Unread
            </button>
            <button
              classList={{ active: props.filter === "bookmarked" }}
              type="button"
              onClick={() => props.onFilterChange("bookmarked")}
            >
              Bookmarked
            </button>
            <span class="library-view-icons" aria-hidden="true">
              <SlidersIcon />
              <LibraryIcon />
            </span>
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
                    <strong>{book.title}</strong>
                    <small>{book.author}</small>
                    <div class="library-card-progress" aria-hidden="true">
                      <span style={{ width: `${libraryProgressPercent(book)}%` }} />
                    </div>
                    <em>{libraryProgressPercent(book)}%</em>
                  </button>
                )}
              </For>
              <button
                class="library-drop-card"
                type="button"
                disabled={props.importing}
                onClick={props.onImport}
              >
                <PlusIcon />
                <strong>{props.importing ? "Adding EPUB" : "Drop New EPUB"}</strong>
              </button>
            </div>
          </Show>
        </section>
      </Show>
    </section>
  );
}

interface EmptyLibraryStateProps {
  importing: boolean;
  notice: string | null;
  onImport: () => void;
  onOpenSample: () => void;
  onRetryLibrary: () => void;
}

function EmptyLibraryState(props: EmptyLibraryStateProps) {
  return (
    <section class="empty-library-state" aria-label="Empty library">
      <div class="empty-drop-illustration" aria-hidden="true">
        <span>
          <PlusIcon />
          Drop file here
        </span>
      </div>
      <h2>Your library is empty.</h2>
      <p>
        Import your first EPUB to start reading. Readex supports rich formatting, deep annotations,
        and seamless narration.
      </p>
      <button
        class="empty-import-button"
        type="button"
        disabled={props.importing}
        onClick={props.onImport}
      >
        <PlusIcon />
        {props.importing ? "Importing EPUB" : "Import EPUB"}
      </button>
      <div class="sample-collection-row">
        <span>Or browse our sample collection</span>
        <button type="button" onClick={props.onOpenSample}>
          Classic Literature
        </button>
        <button type="button" onClick={props.onOpenSample}>
          Research Papers
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

interface StateBlockProps {
  title: string;
  body: string;
  actionLabel?: string;
  actionDisabled?: boolean;
  onAction?: () => void;
}

function StateBlock(props: StateBlockProps) {
  return (
    <div class="state-block">
      <strong>{props.title}</strong>
      <p>{props.body}</p>
      <Show when={props.actionLabel != null && props.onAction != null}>
        <button type="button" disabled={props.actionDisabled} onClick={() => props.onAction?.()}>
          {props.actionLabel}
        </button>
      </Show>
    </div>
  );
}

interface StateNoticeProps {
  message: string;
  onRetry: () => void;
  compact?: boolean;
}

function StateNotice(props: StateNoticeProps) {
  const retryable = () => isRecoverableNotice(props.message);

  return (
    <div
      classList={{
        "state-notice": true,
        compact: props.compact === true,
        attention: retryable()
      }}
    >
      <p>{props.message}</p>
      <Show when={retryable()}>
        <button type="button" onClick={props.onRetry}>
          Retry
        </button>
      </Show>
    </div>
  );
}

function isRecoverableNotice(message: string): boolean {
  return message.startsWith("We couldn't") || message.includes("Please try again");
}

interface ReaderParagraphProps {
  paragraph: ReaderParagraphView;
  activeSentenceId: string | null;
  bookmarkedSentenceIds: Set<string>;
  readerSearchQuery: string;
  selectedWord: SelectedWord | null;
  activeWordInsight: WordInsight | null;
  onRegisterSentence: (sentenceId: string, element: HTMLElement) => void;
  onUnregisterSentence: (sentenceId: string) => void;
  onSelectSentence: (sentenceIndex: number) => void;
  onSelectWord: (
    sentence: ReaderSentenceView,
    token: Extract<ReaderTextToken, { kind: "word" }>
  ) => void;
  onClearWord: () => void;
  onSaveWord: (insight: WordInsight) => void;
}

function ReaderParagraph(props: ReaderParagraphProps) {
  const isSelectedWord = (sentenceId: string, token: ReaderTextToken) =>
    token.kind === "word" &&
    props.selectedWord?.sentenceId === sentenceId &&
    props.selectedWord?.tokenIndex === token.index;

  return (
    <p class="reader-paragraph">
      <For each={props.paragraph.sentences}>
        {(sentence) => {
          onCleanup(() => props.onUnregisterSentence(sentence.id));

          return (
            <span
              ref={(element) => props.onRegisterSentence(sentence.id, element)}
              classList={{
                sentence: true,
                active: props.activeSentenceId === sentence.id,
                bookmarked: props.bookmarkedSentenceIds.has(sentence.id),
                "search-hit": sentenceMatchesQuery(sentence, props.readerSearchQuery)
              }}
              onClick={() => props.onSelectSentence(sentence.index)}
            >
              <span class="sentence-line">
                <For each={tokenizeReaderText(sentence.text)}>
                  {(token) => (
                    <SentenceToken
                      token={token}
                      sentence={sentence}
                      selected={isSelectedWord(sentence.id, token)}
                      insight={isSelectedWord(sentence.id, token) ? props.activeWordInsight : null}
                      onSelect={props.onSelectWord}
                      onClear={props.onClearWord}
                      onSave={props.onSaveWord}
                    />
                  )}
                </For>
              </span>
            </span>
          );
        }}
      </For>
    </p>
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
            class="save-word-button"
            type="button"
            onClick={(event) => runAction(event, () => props.onSave(props.insight))}
          >
            Save
          </button>
        </Show>
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
    </span>
  );
}

interface ReaderInspectorProps {
  tab: InspectorTab;
  insight: WordInsight | null;
  savedWords: SavedDictionaryEntry[];
  readerSearchQuery: string;
  readerSearchResults: ReaderSearchResult<ReaderSentenceView>[];
  bookmarks: LibraryBookmarkDto[];
  activeBookmark: LibraryBookmarkDto | null;
  bookmarkNotice: string | null;
  audioSettings: AudioSettings;
  readerContentFontSize: number;
  audioCacheStats: AudioCacheStatsDto | null;
  audioCacheNotice: string | null;
  exportNotice: string | null;
  onTabChange: (tab: InspectorTab) => void;
  onSaveWord: (insight: WordInsight) => void;
  onForgetWord: (surface: string) => void;
  onSelectSavedWord: (word: SavedDictionaryEntry) => void;
  onReaderSearchQueryChange: (query: string) => void;
  onReaderSearchResult: (result: ReaderSearchResult<ReaderSentenceView>) => void;
  onReaderSearchInputReady: (input: HTMLInputElement) => void;
  onToggleBookmark: () => void;
  onOpenBookmark: (bookmark: LibraryBookmarkDto) => void;
  onDeleteBookmark: (bookmarkId: string) => void;
  onAudioSettingsChange: (settings: Partial<AudioSettings>) => void;
  onReaderContentFontSizeChange: (fontSize: number) => void;
  onRefreshCache: () => void;
  onClearCache: () => void;
  onExportBook: () => void;
}

function ReaderInspector(props: ReaderInspectorProps) {
  const tabs: Array<{ id: InspectorTab; label: string; icon: () => JSX.Element }> = [
    { id: "word", label: "Word", icon: WordIcon },
    { id: "search", label: "Search", icon: SearchIcon },
    { id: "bookmarks", label: "Notes", icon: BookmarkIcon },
    { id: "settings", label: "Tools", icon: SettingsIcon }
  ];

  return (
    <aside class="inspector" aria-label="Reader tools">
      <header class="inspector-header">
        <span>Inspector</span>
        <strong>Contextual Tools</strong>
      </header>
      <div class="inspector-tabs" role="tablist" aria-label="Reader tool tabs">
        <For each={tabs}>
          {(tab) => {
            const Icon = tab.icon;

            return (
              <button
                classList={{ active: props.tab === tab.id }}
                type="button"
                role="tab"
                aria-selected={props.tab === tab.id}
                onClick={() => props.onTabChange(tab.id)}
              >
                <Icon />
                <span>{tab.label}</span>
              </button>
            );
          }}
        </For>
      </div>

      <div class="inspector-content">
        {props.tab === "word" ? (
          <WordPanel
            insight={props.insight}
            savedWords={props.savedWords}
            onSave={props.onSaveWord}
            onForget={props.onForgetWord}
            onSelectSavedWord={props.onSelectSavedWord}
          />
        ) : props.tab === "search" ? (
          <SearchPanel
            query={props.readerSearchQuery}
            results={props.readerSearchResults}
            onQueryChange={props.onReaderSearchQueryChange}
            onOpenResult={props.onReaderSearchResult}
            onInputReady={props.onReaderSearchInputReady}
          />
        ) : props.tab === "bookmarks" ? (
          <BookmarkPanel
            bookmarks={props.bookmarks}
            activeBookmark={props.activeBookmark}
            notice={props.bookmarkNotice}
            onToggleActive={props.onToggleBookmark}
            onOpenBookmark={props.onOpenBookmark}
            onDeleteBookmark={props.onDeleteBookmark}
          />
        ) : (
          <SettingsPanel
            audioSettings={props.audioSettings}
            readerContentFontSize={props.readerContentFontSize}
            audioCacheStats={props.audioCacheStats}
            audioCacheNotice={props.audioCacheNotice}
            exportNotice={props.exportNotice}
            onAudioSettingsChange={props.onAudioSettingsChange}
            onReaderContentFontSizeChange={props.onReaderContentFontSizeChange}
            onResetAudioSettings={() => props.onAudioSettingsChange(DEFAULT_AUDIO_SETTINGS)}
            onRefreshCache={props.onRefreshCache}
            onClearCache={props.onClearCache}
            onExportBook={props.onExportBook}
          />
        )}
      </div>

      <footer class="inspector-footer-tools" aria-label="Reader tool actions">
        <button type="button" aria-label="Reader controls">
          <SlidersIcon />
        </button>
        <button type="button" aria-label="Share">
          <ShareIcon />
        </button>
        <button type="button" aria-label="Print">
          <PrintIcon />
        </button>
      </footer>
    </aside>
  );
}

interface WordPanelProps {
  insight: WordInsight | null;
  savedWords: SavedDictionaryEntry[];
  onSave: (insight: WordInsight) => void;
  onForget: (surface: string) => void;
  onSelectSavedWord: (word: SavedDictionaryEntry) => void;
}

function WordPanel(props: WordPanelProps) {
  return (
    <Show
      when={props.insight}
      fallback={
        <>
          <StateBlock
            title="No word selected"
            body="Definitions and saved-word actions appear here."
          />
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
  );
}

interface SearchPanelProps {
  query: string;
  results: ReaderSearchResult<ReaderSentenceView>[];
  onQueryChange: (query: string) => void;
  onOpenResult: (result: ReaderSearchResult<ReaderSentenceView>) => void;
  onInputReady: (input: HTMLInputElement) => void;
}

function SearchPanel(props: SearchPanelProps) {
  const hasQuery = () => props.query.trim().length > 0;

  return (
    <section class="inspector-panel" aria-label="Search this chapter">
      <input
        ref={props.onInputReady}
        aria-label="Search this chapter"
        type="search"
        value={props.query}
        placeholder="Search chapter"
        onInput={(event) => props.onQueryChange(event.currentTarget.value)}
      />
      <Show
        when={props.results.length > 0}
        fallback={
          <StateBlock
            title={hasQuery() ? "No matches" : "Search this chapter"}
            body={
              hasQuery() ? "Try a different word or phrase." : "Matching sentences appear here."
            }
          />
        }
      >
        <div class="result-list" role="list">
          <For each={props.results}>
            {(result) => (
              <button type="button" onClick={() => props.onOpenResult(result)}>
                <span>Sentence {result.sentence.index + 1}</span>
                <small>{result.excerpt}</small>
              </button>
            )}
          </For>
        </div>
      </Show>
    </section>
  );
}

interface BookmarkPanelProps {
  bookmarks: LibraryBookmarkDto[];
  activeBookmark: LibraryBookmarkDto | null;
  notice: string | null;
  onToggleActive: () => void;
  onOpenBookmark: (bookmark: LibraryBookmarkDto) => void;
  onDeleteBookmark: (bookmarkId: string) => void;
}

function BookmarkPanel(props: BookmarkPanelProps) {
  return (
    <section class="inspector-panel bookmark-panel" aria-label="Bookmarks">
      <div class="panel-title-row">
        <strong>Saved Passages ({props.bookmarks.length})</strong>
        <button type="button" onClick={props.onToggleActive}>
          {props.activeBookmark == null ? "Save current" : "Remove current"}
        </button>
      </div>
      <Show when={props.notice}>{(notice) => <p class="library-notice">{notice()}</p>}</Show>
      <Show
        when={props.bookmarks.length > 0}
        fallback={
          <StateBlock title="No bookmarks in this book" body="Saved sentences appear here." />
        }
      >
        <div class="result-list" role="list">
          <For each={props.bookmarks}>
            {(bookmark) => (
              <div class="bookmark-row">
                <button type="button" onClick={() => props.onOpenBookmark(bookmark)}>
                  <span>Sentence {bookmark.sentenceIndex + 1}</span>
                  <small>{bookmark.text}</small>
                </button>
                <button
                  class="mini-danger"
                  type="button"
                  aria-label="Delete bookmark"
                  onClick={() => props.onDeleteBookmark(bookmark.id)}
                >
                  Delete
                </button>
              </div>
            )}
          </For>
        </div>
      </Show>
    </section>
  );
}

interface SettingsPanelProps {
  audioSettings: AudioSettings;
  readerContentFontSize: number;
  audioCacheStats: AudioCacheStatsDto | null;
  audioCacheNotice: string | null;
  exportNotice: string | null;
  onAudioSettingsChange: (settings: Partial<AudioSettings>) => void;
  onReaderContentFontSizeChange: (fontSize: number) => void;
  onResetAudioSettings: () => void;
  onRefreshCache: () => void;
  onClearCache: () => void;
  onExportBook: () => void;
}

function SettingsPanel(props: SettingsPanelProps) {
  const speedOptions = [0.75, 0.9, 1, 1.25, 1.5];
  const voiceDescription = (voiceId: string) => {
    if (voiceId.includes("en_US")) return "Soft, narrative American accent";
    if (voiceId.includes("en_GB")) return "Deep, scholarly British accent";

    return "Standard synthesized voice";
  };

  return (
    <section class="inspector-panel settings-panel" aria-label="Settings">
      <label class="setting-field">
        <span class="inspector-section-title">Narration speed</span>
        <select
          aria-label="Narration speed"
          value={props.audioSettings.playbackRate.toString()}
          onChange={(event) =>
            props.onAudioSettingsChange({ playbackRate: Number(event.currentTarget.value) })
          }
        >
          <For each={speedOptions}>
            {(speed) => (
              <option value={speed.toString()}>{speed.toFixed(speed % 1 === 0 ? 1 : 2)}x</option>
            )}
          </For>
        </select>
      </label>
      <div class="settings-action-row">
        <button class="secondary-tool-button" type="button" onClick={props.onResetAudioSettings}>
          Reset audio settings
        </button>
      </div>
      <div class="setting-field">
        <span class="inspector-section-title">Book text size</span>
        <div class="font-size-control">
          <input
            aria-label="Book text size"
            type="range"
            min="14"
            max="24"
            step="1"
            value={props.readerContentFontSize}
            onInput={(event) =>
              props.onReaderContentFontSizeChange(Number(event.currentTarget.value))
            }
          />
          <output>{props.readerContentFontSize}px</output>
        </div>
      </div>
      <label class="toggle-row settings-toggle">
        <span>
          <strong>Auto-advance</strong>
          <small>Turn pages automatically while narrating</small>
        </span>
        <input
          type="checkbox"
          checked={props.audioSettings.autoAdvance}
          onChange={(event) =>
            props.onAudioSettingsChange({ autoAdvance: event.currentTarget.checked })
          }
        />
      </label>
      <span class="inspector-section-title">Voice selection</span>
      <div class="voice-list" role="group" aria-label="Voice selection">
        <For each={SUPPORTED_NARRATION_VOICES}>
          {(voice) => (
            <button
              classList={{ active: props.audioSettings.voiceId === voice.id }}
              type="button"
              onClick={() => props.onAudioSettingsChange({ voiceId: voice.id })}
            >
              <span aria-hidden="true">
                <HeadphonesIcon />
              </span>
              <strong>{voice.label}</strong>
              <small>{voiceDescription(voice.id)}</small>
            </button>
          )}
        </For>
      </div>
      <div class="tool-card">
        <span class="inspector-section-title">Prepared audio</span>
        <p>
          {props.audioCacheStats == null
            ? "Checking cache"
            : `${props.audioCacheStats.sentenceCount} sentence${props.audioCacheStats.sentenceCount === 1 ? "" : "s"} · ${formatBytes(props.audioCacheStats.sizeBytes)}`}
        </p>
        <div class="dictionary-actions">
          <button type="button" onClick={props.onRefreshCache}>
            Refresh
          </button>
          <button type="button" onClick={props.onClearCache}>
            Clear
          </button>
        </div>
        <Show when={props.audioCacheNotice}>
          {(notice) => <p class="library-notice">{notice()}</p>}
        </Show>
      </div>
      <div class="tool-card">
        <span class="inspector-section-title">Data management</span>
        <button class="primary-tool-button" type="button" onClick={props.onExportBook}>
          Export book data
        </button>
        <Show when={props.exportNotice}>
          {(notice) => <p class="library-notice">{notice()}</p>}
        </Show>
      </div>
    </section>
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
      fallback={<StateBlock title="No saved words" body="Saved definitions appear here." />}
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
  bookTitle: string;
  author: string;
  coverImageSrc: string | null;
  chapterTitle: string;
  progress: ReaderProgress;
  sentenceCount: number;
  status: PlaybackStatus;
  narrationStatus: string;
  narrationNotice: string | null;
  playbackRate: number;
  onPrevious: () => void;
  onToggle: () => void;
  onNext: () => void;
}

function PlaybackRail(props: PlaybackRailProps) {
  return (
    <footer class="audio-rail" aria-label="Playback controls">
      <div class="track-info">
        <BookCover className="cover-art" title={props.bookTitle} src={props.coverImageSrc} />
        <div>
          <strong>{props.chapterTitle}</strong>
          <span>{props.author || props.bookTitle}</span>
        </div>
      </div>
      <div class="transport-stack">
        <div class="transport-controls">
          <button
            class="icon-button"
            type="button"
            aria-label="Previous sentence"
            disabled={props.sentenceCount === 0}
            onClick={props.onPrevious}
          >
            <PreviousIcon />
          </button>
          <button
            class="play"
            type="button"
            aria-label={props.status === "playing" ? "Pause" : "Play"}
            disabled={props.sentenceCount === 0}
            onClick={props.onToggle}
          >
            <Show when={props.status === "playing"} fallback={<PlayIcon />}>
              <PauseIcon />
            </Show>
          </button>
          <button
            class="icon-button"
            type="button"
            aria-label="Next sentence"
            disabled={props.sentenceCount === 0}
            onClick={props.onNext}
          >
            <NextIcon />
          </button>
        </div>
        <div class="audio-progress" aria-label="Reading progress">
          <span>{props.progress.chapterSentenceNumber}</span>
          <div class="progress-track" aria-hidden="true">
            <span style={{ width: `${props.progress.chapterPercent}%` }} />
          </div>
          <span>{props.progress.chapterSentenceCount}</span>
        </div>
      </div>
      <div class="essential-actions">
        <span classList={{ "narration-status": true, attention: props.narrationNotice != null }}>
          {props.narrationStatus}
        </span>
        <button type="button" aria-label="Bookmark sentence">
          <BookmarkIcon />
        </button>
        <button type="button" aria-label="Volume">
          <SpeakerIcon />
        </button>
        <div class="volume-meter" aria-hidden="true">
          <SpeakerIcon />
          <span />
        </div>
        <span class="speed-label">{props.playbackRate.toFixed(1)}x</span>
      </div>
    </footer>
  );
}

function createSampleExport(
  currentReader: ReaderView,
  activeSentenceIndex: number,
  currentBookmarks: LibraryBookmarkDto[]
): BookExportDataDto {
  return {
    exportedAt: new Date().toISOString(),
    book: currentReader.book,
    chapters: [
      {
        id: currentReader.chapter.id,
        title: currentReader.chapter.title,
        index: 0,
        sentenceCount: currentReader.sentences.length,
        sentences: currentReader.sentences.map((sentence) => ({
          id: sentence.id,
          index: sentence.index,
          text: sentence.text
        }))
      }
    ],
    position: {
      bookId: currentReader.book.id,
      chapterId: currentReader.chapter.id,
      sentenceIndex: activeSentenceIndex,
      updatedAt: new Date().toISOString()
    },
    bookmarks: currentBookmarks
  };
}

function createSentenceNarrationRequest(
  currentReader: ReaderView,
  sentence: ReaderSentenceView,
  voiceId: string
): SentenceNarrationRequest {
  return {
    bookId: currentReader.book.id,
    chapterId: currentReader.chapter.id,
    sentenceId: sentence.id,
    sentenceIndex: sentence.index,
    voiceId,
    text: sentence.text
  };
}

function downloadJson(fileName: string, data: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function slugify(value: string): string {
  return (
    value
      .normalize("NFKC")
      .toLocaleLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "readex-book"
  );
}

function bookInitials(title: string): string {
  const words = title
    .trim()
    .split(/\s+/)
    .filter((word) => !/^(a|an|the)$/i.test(word));
  const initials = (words.length > 0 ? words : title.trim().split(/\s+/))
    .slice(0, 2)
    .map((word) => word[0])
    .filter(Boolean)
    .join("");

  return initials.toLocaleUpperCase() || "R";
}

function BookCover(props: { title: string; src?: string | null; className: string }) {
  return (
    <span class={`book-cover ${props.className}`} aria-hidden="true">
      <Show when={props.src} fallback={bookInitials(props.title)}>
        {(src) => <img src={src()} alt="" loading="lazy" />}
      </Show>
    </span>
  );
}

function libraryProgressPercent(book: LibraryBookSummary): number {
  if (book.sentenceCount <= 0) return 0;

  const completedSentences = Math.max(0, Math.min(book.sentenceCount, book.lastSentenceIndex + 1));
  return Math.round((completedSentences / book.sentenceCount) * 100);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}

function ReaderIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M4.75 5.75A2.75 2.75 0 0 1 7.5 3h11.75v14.5H7.5a1.25 1.25 0 0 0 0 2.5h11.75v1.5H7.5A2.75 2.75 0 0 1 4.75 18.75v-13Zm2.75-1.25c-.69 0-1.25.56-1.25 1.25v10.56c.38-.2.8-.31 1.25-.31h10.25V4.5H7.5Zm1.25 3h6.5V9h-6.5V7.5Z" />
    </svg>
  );
}

function LibraryIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M5.5 4.5h3.75v15H5.5a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2Zm5.25 0h7.75a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-7.75v-15Zm-5.25 1.5a.5.5 0 0 0-.5.5v11a.5.5 0 0 0 .5.5h2.25v-12H5.5Zm6.75 0v12h6.25a.5.5 0 0 0 .5-.5v-11a.5.5 0 0 0-.5-.5h-6.25Z" />
    </svg>
  );
}

function BookmarkIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M7 4.75A2.25 2.25 0 0 1 9.25 2.5h5.5A2.25 2.25 0 0 1 17 4.75v15a.75.75 0 0 1-1.13.65L12 18.13 8.13 20.4A.75.75 0 0 1 7 19.75v-15Zm2.25-.75a.75.75 0 0 0-.75.75v13.69l3.12-1.84a.75.75 0 0 1 .76 0l3.12 1.84V4.75a.75.75 0 0 0-.75-.75h-5.5Z" />
    </svg>
  );
}

function WordIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="m5.88 18 4.1-12h1.67l4.1 12h-1.58l-1.03-3.16H8.45L7.43 18H5.88Zm3.02-4.55h3.79l-1.9-5.86-1.89 5.86ZM17.7 18V8.9h1.45V18H17.7Zm-.17-11.35c0-.28.1-.52.3-.7.2-.19.45-.28.74-.28.3 0 .54.09.74.28.2.18.3.42.3.7s-.1.51-.3.7c-.2.18-.45.27-.74.27-.29 0-.54-.09-.74-.27-.2-.19-.3-.42-.3-.7Z" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M10.75 4a6.75 6.75 0 1 1-4.27 11.98l-2.75 2.75-1.06-1.06 2.75-2.75A6.75 6.75 0 0 1 10.75 4Zm0 1.5a5.25 5.25 0 1 0 0 10.5 5.25 5.25 0 0 0 0-10.5Z" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M12 8.25a3.75 3.75 0 1 1 0 7.5 3.75 3.75 0 0 1 0-7.5Zm0 1.5a2.25 2.25 0 1 0 0 4.5 2.25 2.25 0 0 0 0-4.5Z" />
      <path d="M10.96 2.75h2.08l.5 2.22c.49.15.96.34 1.4.58l1.93-1.22 1.47 1.47-1.22 1.93c.24.44.43.91.58 1.4l2.22.5v2.08l-2.22.5c-.15.49-.34.96-.58 1.4l1.22 1.93-1.47 1.47-1.93-1.22c-.44.24-.91.43-1.4.58l-.5 2.22h-2.08l-.5-2.22a7.38 7.38 0 0 1-1.4-.58l-1.93 1.22-1.47-1.47 1.22-1.93a7.38 7.38 0 0 1-.58-1.4l-2.22-.5V9.63l2.22-.5c.15-.49.34-.96.58-1.4L5.66 5.8l1.47-1.47 1.93 1.22c.44-.24.91-.43 1.4-.58l.5-2.22Zm.58 1.5-.42 1.86-.44.11a5.92 5.92 0 0 0-1.35.56l-.39.23-1.62-1.02-.44.44 1.02 1.62-.23.39a5.92 5.92 0 0 0-.56 1.35l-.11.44-1.86.42v.7l1.86.42.11.44c.13.47.32.92.56 1.35l.23.39-1.02 1.62.44.44 1.62-1.02.39.23c.43.24.88.43 1.35.56l.44.11.42 1.86h.7l.42-1.86.44-.11a5.92 5.92 0 0 0 1.35-.56l.39-.23 1.62 1.02.44-.44-1.02-1.62.23-.39c.24-.43.43-.88.56-1.35l.11-.44 1.86-.42v-.7l-1.86-.42-.11-.44a5.92 5.92 0 0 0-.56-1.35l-.23-.39 1.02-1.62-.44-.44-1.62 1.02-.39-.23a5.92 5.92 0 0 0-1.35-.56l-.44-.11-.42-1.86h-.7Z" />
    </svg>
  );
}

function HelpIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17ZM5 12a7 7 0 1 1 14 0 7 7 0 0 1-14 0Z" />
      <path d="M11.2 14.25h1.5c0-.95.34-1.38 1.12-1.9.84-.55 1.68-1.25 1.68-2.68 0-1.71-1.33-2.92-3.25-2.92-1.8 0-3.17 1.02-3.25 2.79h1.5c.07-.92.73-1.45 1.72-1.45 1.08 0 1.74.64 1.74 1.6 0 .8-.45 1.22-1.18 1.72-.94.63-1.58 1.27-1.58 2.84Zm.75 3.1a.98.98 0 1 0 0-1.96.98.98 0 0 0 0 1.96Z" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M11.25 5.25h1.5v6h6v1.5h-6v6h-1.5v-6h-6v-1.5h6v-6Z" />
    </svg>
  );
}

function HeadphonesIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M12 4.5a6.5 6.5 0 0 0-6.5 6.5v5.5A2.5 2.5 0 0 0 8 19h1.25v-6.5H6.98V11a5.02 5.02 0 0 1 10.04 0v1.5h-2.27V19H16a2.5 2.5 0 0 0 2.5-2.5V11A6.5 6.5 0 0 0 12 4.5ZM7.75 14h.0v3.5H8V14h-.25Zm8.25 0h-.25v3.5H16a1 1 0 0 0 1-1V14h-1Z" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M12 8a1.25 1.25 0 1 0 0-2.5A1.25 1.25 0 0 0 12 8Zm0 5.25a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5Zm0 5.25a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5Z" />
    </svg>
  );
}

function SpeakerIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M4.5 9.25h3.04l4.46-3.3v12.1l-4.46-3.3H4.5v-5.5Zm5.99-.34-2.46 1.84H6v2.5h2.03l2.46 1.84V8.91Zm4.1.1 1.06-1.06a5.73 5.73 0 0 1 0 8.1l-1.06-1.06a4.23 4.23 0 0 0 0-5.98Zm2.3-2.3 1.06-1.06a8.97 8.97 0 0 1 0 12.7l-1.06-1.06a7.47 7.47 0 0 0 0-10.58Z" />
    </svg>
  );
}

function SlidersIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M5 7.25h8.25a2.75 2.75 0 0 1 5.3 0H19v1.5h-.45a2.75 2.75 0 0 1-5.3 0H5v-1.5Zm10.9-1.25a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5ZM5 15.25h.45a2.75 2.75 0 0 1 5.3 0H19v1.5h-8.25a2.75 2.75 0 0 1-5.3 0H5v-1.5ZM8.1 14a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5Z" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M16.5 4.5a3 3 0 1 1-2.83 4l-4.52 2.26a3.05 3.05 0 0 1 0 2.48l4.52 2.26a3 3 0 1 1-.67 1.34l-4.52-2.26a3 3 0 1 1 0-5.16L13 7.16a3 3 0 0 1 3.5-2.66Zm0 1.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3ZM6.5 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm10 4.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z" />
    </svg>
  );
}

function PrintIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M7 3.5h10v5H7v-5Zm1.5 1.5v2h7V5h-7ZM6.5 10h11A2.5 2.5 0 0 1 20 12.5V17h-3v3.5H7V17H4v-4.5A2.5 2.5 0 0 1 6.5 10Zm2 6v3h7v-3h-7Zm-3-3.5v3h1.5v-1h10v1h1.5v-3a1 1 0 0 0-1-1h-11a1 1 0 0 0-1 1Zm11.5.25a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5Z" />
    </svg>
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
