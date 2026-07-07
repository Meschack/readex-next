import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  For,
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
  type ReaderSentenceView,
  type ReaderView
} from "./reader-view";
import { createReaderPreferencesRepository } from "./reader-preferences-repository";

type InspectorTab = ReaderToolTab;

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

  let activeHtmlAudio: HTMLAudioElement | null = null;
  let narrationRun = 0;
  let librarySearchRun = 0;
  let readerSearchInput: HTMLInputElement | undefined;
  const sentenceElements = new Map<string, HTMLParagraphElement>();

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
    void refreshAllBookmarks();
    void refreshAudioCacheStats();

    window.addEventListener("keydown", handleShortcut);
    onCleanup(() => window.removeEventListener("keydown", handleShortcut));
  });

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
      libraryFilter: libraryFilter()
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

  const jumpPlaybackStatus = (): PlaybackStatus =>
    playback().status === "ended" ? "paused" : playback().status;

  const commitPlaybackJump = (
    resolvePlayback: (current: ReaderPlaybackState) => ReaderPlaybackState
  ) => {
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
      const document = await repository.openBook(bookId);
      const nextReader = buildReaderViewFromDocument(document, options);
      activateReader(
        nextReader,
        options.sentenceIndex ?? nextReader.initialSentenceIndex,
        options.playbackStatus ?? "idle"
      );
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

      downloadJson(`${slugify(reader().book.title)}-readex-export.json`, data);
      setExportNotice("Export ready.");
    } catch (error) {
      setExportNotice(toFriendlyLibraryError(error));
    }
  };

  return (
    <main class="readex-shell">
      <LibraryRail
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
        onOpenToolTab={setInspectorTab}
      />

      <section class="reader-surface" aria-label="Reader">
        <header class="reader-header">
          <p>{statusLabel()}</p>
          <h1>{reader().book.title}</h1>
          <span>{reader().book.author}</span>
        </header>

        <ChapterNavigator
          chapters={reader().chapters}
          activeChapterId={reader().chapter.id}
          onOpenChapter={openChapter}
        />
        <ReaderProgressStrip progress={readerProgress()} />

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

          <article class="page" aria-label={`${reader().chapter.title} text`}>
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
            <For each={visibleSentences()}>
              {(sentence) => {
                onCleanup(() => sentenceElements.delete(sentence.id));

                return (
                  <p
                    ref={(element) => {
                      sentenceElements.set(sentence.id, element);
                    }}
                    classList={{
                      sentence: true,
                      active: highlight().activeSentenceId === sentence.id,
                      bookmarked: bookmarkedSentenceIds().has(sentence.id),
                      "search-hit": sentenceMatchesQuery(sentence, readerSearchQuery())
                    }}
                    onClick={() => selectSentence(sentence.index)}
                  >
                    <For each={tokenizeReaderText(sentence.text)}>
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
                );
              }}
            </For>
            <Show when={visibleSentenceRange().hiddenAfter > 0}>
              <button
                class="sentence-window-jump"
                type="button"
                onClick={() => selectSentence(visibleSentenceRange().end)}
              >
                Next {Math.min(renderedSentenceTrail, visibleSentenceRange().hiddenAfter)} sentences
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
        onRefreshCache={refreshAudioCacheStats}
        onClearCache={clearAudioCache}
        onExportBook={exportCurrentBook}
      />

      <PlaybackRail
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
    </main>
  );
}

interface ReaderProgressStripProps {
  progress: ReaderProgress;
}

function ReaderProgressStrip(props: ReaderProgressStripProps) {
  const chapterNumber = () =>
    props.progress.chapterCount === 0 ? 0 : props.progress.chapterIndex + 1;

  return (
    <section class="reading-progress-summary" aria-label="Reading progress">
      <div class="reading-progress-item">
        <span>
          <strong>Book</strong>
          <small>
            {props.progress.bookSentenceNumber} / {props.progress.bookSentenceCount}
          </small>
        </span>
        <div class="progress-track" aria-hidden="true">
          <span style={{ width: `${props.progress.bookPercent}%` }} />
        </div>
      </div>
      <div class="reading-progress-item">
        <span>
          <strong>
            Chapter {chapterNumber()} / {props.progress.chapterCount}
          </strong>
          <small>
            {props.progress.chapterSentenceNumber} / {props.progress.chapterSentenceCount}
          </small>
        </span>
        <div class="progress-track chapter" aria-hidden="true">
          <span style={{ width: `${props.progress.chapterPercent}%` }} />
        </div>
      </div>
    </section>
  );
}

interface ChapterNavigatorProps {
  chapters: ReaderChapterNavigationItem[];
  activeChapterId: string;
  onOpenChapter: (chapterId: string) => void;
}

function ChapterNavigator(props: ChapterNavigatorProps) {
  return (
    <nav class="chapter-navigation" aria-label="Table of contents">
      <span class="chapter-navigation-label">Chapters</span>
      <div class="chapter-navigation-list" role="list">
        <For each={props.chapters}>
          {(chapter) => (
            <button
              classList={{
                active: chapter.id === props.activeChapterId
              }}
              type="button"
              aria-current={chapter.id === props.activeChapterId ? "page" : undefined}
              disabled={chapter.id === props.activeChapterId}
              onClick={() => props.onOpenChapter(chapter.id)}
            >
              <span>{chapter.title}</span>
              <small>
                {chapter.sentenceCount} sentence{chapter.sentenceCount === 1 ? "" : "s"}
              </small>
            </button>
          )}
        </For>
      </div>
    </nav>
  );
}

interface LibraryRailProps {
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
  onOpenToolTab: (tab: InspectorTab) => void;
}

function LibraryRail(props: LibraryRailProps) {
  let librarySearchInput: HTMLInputElement | undefined;
  const hasSearchQuery = () => hasLibrarySearchQuery(props.query);

  return (
    <aside class="library-rail" aria-label="Library">
      <strong class="brand">Readex</strong>
      <nav class="nav-list">
        <button class="active" type="button">
          Reader
        </button>
        <button type="button" onClick={() => librarySearchInput?.focus()}>
          Library
        </button>
        <button type="button" onClick={() => props.onOpenToolTab("bookmarks")}>
          Bookmarks
        </button>
        <button type="button" onClick={() => props.onOpenToolTab("word")}>
          Words
        </button>
      </nav>
      <section class="library-actions" aria-label="Book library">
        <button
          class="import-button"
          type="button"
          disabled={props.importing}
          onClick={props.onImport}
        >
          {props.importing ? "Adding book..." : "Add EPUB"}
        </button>
        <div class="library-controls">
          <input
            ref={(input) => {
              librarySearchInput = input;
            }}
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
          {(notice) => <StateNotice message={notice()} onRetry={props.onRetryLibrary} compact />}
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
                  {book.author} · {book.chapterCount} chapter{book.chapterCount === 1 ? "" : "s"}
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
    </aside>
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
  onRefreshCache: () => void;
  onClearCache: () => void;
  onExportBook: () => void;
}

function ReaderInspector(props: ReaderInspectorProps) {
  return (
    <aside class="inspector" aria-label="Reader tools">
      <span class="inspector-label">Reader tools</span>
      <div class="inspector-tabs" role="tablist" aria-label="Reader tool tabs">
        <For each={["word", "search", "bookmarks", "settings"] as InspectorTab[]}>
          {(tab) => (
            <button
              classList={{ active: props.tab === tab }}
              type="button"
              role="tab"
              aria-selected={props.tab === tab}
              onClick={() => props.onTabChange(tab)}
            >
              {tab[0].toLocaleUpperCase() + tab.slice(1)}
            </button>
          )}
        </For>
      </div>

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
          audioCacheStats={props.audioCacheStats}
          audioCacheNotice={props.audioCacheNotice}
          exportNotice={props.exportNotice}
          onAudioSettingsChange={props.onAudioSettingsChange}
          onResetAudioSettings={() => props.onAudioSettingsChange(DEFAULT_AUDIO_SETTINGS)}
          onRefreshCache={props.onRefreshCache}
          onClearCache={props.onClearCache}
          onExportBook={props.onExportBook}
        />
      )}
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
    <section class="inspector-panel" aria-label="Bookmarks">
      <button class="primary-tool-button" type="button" onClick={props.onToggleActive}>
        {props.activeBookmark == null ? "Add bookmark" : "Remove bookmark"}
      </button>
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
  audioCacheStats: AudioCacheStatsDto | null;
  audioCacheNotice: string | null;
  exportNotice: string | null;
  onAudioSettingsChange: (settings: Partial<AudioSettings>) => void;
  onResetAudioSettings: () => void;
  onRefreshCache: () => void;
  onClearCache: () => void;
  onExportBook: () => void;
}

function SettingsPanel(props: SettingsPanelProps) {
  return (
    <section class="inspector-panel" aria-label="Settings">
      <label class="field-row">
        <span>Voice</span>
        <select
          value={props.audioSettings.voiceId}
          onChange={(event) => props.onAudioSettingsChange({ voiceId: event.currentTarget.value })}
        >
          <For each={SUPPORTED_NARRATION_VOICES}>
            {(voice) => <option value={voice.id}>{voice.label}</option>}
          </For>
        </select>
      </label>
      <label class="field-row">
        <span>Speed</span>
        <select
          value={props.audioSettings.playbackRate.toString()}
          onChange={(event) =>
            props.onAudioSettingsChange({ playbackRate: Number(event.currentTarget.value) })
          }
        >
          <option value="0.75">0.75x</option>
          <option value="0.9">0.90x</option>
          <option value="1">1.00x</option>
          <option value="1.15">1.15x</option>
          <option value="1.3">1.30x</option>
          <option value="1.5">1.50x</option>
        </select>
      </label>
      <label class="toggle-row">
        <input
          type="checkbox"
          checked={props.audioSettings.autoAdvance}
          onChange={(event) =>
            props.onAudioSettingsChange({ autoAdvance: event.currentTarget.checked })
          }
        />
        <span>Auto-advance</span>
      </label>
      <button class="primary-tool-button" type="button" onClick={props.onResetAudioSettings}>
        Reset narration
      </button>
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
        <span class="inspector-section-title">Export</span>
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
  const chapterNumber = () =>
    props.progress.chapterCount === 0 ? 0 : props.progress.chapterIndex + 1;

  return (
    <footer class="audio-rail" aria-label="Playback controls">
      <div class="chapter-status">
        <span>{props.chapterTitle}</span>
        <span class="mono">
          Chapter {chapterNumber()} / {props.progress.chapterCount}
        </span>
        <span classList={{ "narration-status": true, attention: props.narrationNotice != null }}>
          {props.narrationStatus}
        </span>
      </div>
      <div class="progress-stack" aria-label="Reading progress">
        <div class="progress-row">
          <span>Book</span>
          <div class="progress-track" aria-hidden="true">
            <span style={{ width: `${props.progress.bookPercent}%` }} />
          </div>
          <span class="mono">
            {props.progress.bookSentenceNumber} / {props.progress.bookSentenceCount}
          </span>
        </div>
        <div class="progress-row">
          <span>Chapter</span>
          <div class="progress-track chapter" aria-hidden="true">
            <span style={{ width: `${props.progress.chapterPercent}%` }} />
          </div>
          <span class="mono">
            {props.progress.chapterSentenceNumber} / {props.progress.chapterSentenceCount}
          </span>
        </div>
      </div>
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
        <span>{props.status === "playing" ? "Pause" : "Play"}</span>
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
      <span class="mono">{props.playbackRate.toFixed(2)}x</span>
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
