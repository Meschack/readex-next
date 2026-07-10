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
  resolveNarrationVoiceForLanguage,
  type AudioSettings,
  type SentenceNarration,
  type SentenceNarrationRequest
} from "@sonelle/audio";
import { createDomainEvent, type AnyDomainEvent, type DomainEvent } from "@sonelle/domain";
import {
  bookmarkedBookIds,
  filterLibraryBooks,
  libraryImportNotice,
  resolveLibraryBookListState,
  type LibraryBookFilter
} from "@sonelle/library";
import {
  calculateReaderProgressFromIndex,
  calculateSentenceRenderWindow,
  createPlaybackState,
  createReaderProgressIndex,
  createReaderPreferences,
  createReadingPositionScheduler,
  finishSentencePlayback,
  highlightSentence,
  movePlayback,
  pausePlayback,
  playPlayback,
  searchReaderSentences,
  selectPlaybackSentence,
  type PlaybackStatus,
  type ReaderPlaybackState,
  type ReaderSearchResult
} from "@sonelle/reader";
import {
  createWordInsight,
  forgetDictionaryEntry,
  listSavedDictionaryEntries,
  loadingDictionaryLookup,
  normalizeInsightKey,
  saveDictionaryEntry,
  type DictionaryLookupResult,
  type SavedDictionary,
  type SavedDictionaryEntry,
  type WordInsight
} from "@sonelle/learning";
import type { ReaderTextToken } from "@sonelle/text";
import type { AudioCacheStatsDto } from "../audio/audio-cache-repository";
import {
  reportNarrationDevelopmentError,
  toFriendlyNarrationError
} from "../audio/narration-repository";
import {
  resolveDroppedEpubPath,
  toFriendlyLibraryError,
  type BookDropEvent,
  type LibraryBookmarkDto,
  type LibrarySearchResultDto,
  type SaveReadingPositionInput
} from "../library/book-repository";
import { ChapterNavigator, PlaybackRail, ProductBar, ReaderTopAppBar } from "./reader-chrome";
import { nextReaderChapter } from "./reader-chapter-flow";
import { ReaderParagraph } from "./reader-content";
import { createSampleExport, downloadJson } from "./reader-export";
import type { LibraryBookSummary } from "./reader-document";
import type {
  AppView,
  InspectorTab,
  OpenBookOptions,
  SelectedWord
} from "./reader-experience-types";
import { isTypingTarget, slugify } from "./reader-formatting";
import { ReaderInspector } from "./reader-inspector";
import {
  clampSidebarWidth,
  getSidebarResizeBounds,
  sidebarDefaultWidths,
  SidebarResizeHandle,
  type ResizableSidebar
} from "./sidebar-resize";
import {
  createLibraryRailMode,
  transitionLibraryRailMode,
  type LibraryRailEvent
} from "./library-rail-state";
import { createSentenceNarrationRequest } from "./reader-narration";
import { lookupReaderWord } from "./reader-word-lookup";
import { createReaderLibraryWorkflows } from "./reader-library-workflows";
import {
  createReaderExperienceDependencies,
  type ReaderExperienceDependencies
} from "./reader-dependencies";
import { LibraryRail, LibraryWorkspace } from "./library-surfaces";
import {
  buildFixtureReaderView,
  buildReaderViewFromDocument,
  paragraphsInSentenceRange,
  type ReaderSentenceView,
  type ReaderView
} from "./reader-view";

const renderedSentenceLead = 24;
const renderedSentenceTrail = 48;
const librarySearchDelayMs = 180;
const playbackPositionSaveDelayMs = 2_500;
const chapterTransitionDelayMs = 5_000;
const narrationPlaybackFailureMessage = "We couldn't play this narration. Please try again.";

type PositionSaveIntent = "immediate" | "playback";

export interface ReaderExperienceProps {
  dependencies?: ReaderExperienceDependencies;
}

export function ReaderExperience(props: ReaderExperienceProps) {
  const dependencies = props.dependencies ?? createReaderExperienceDependencies();
  const repository = dependencies.bookRepository;
  const narrationRepository = dependencies.narrationRepository;
  const dictionaryRepository = dependencies.dictionaryRepository;
  const audioCacheRepository = dependencies.audioCacheRepository;
  const audioSettingsRepository = dependencies.audioSettingsRepository;
  const readerPreferencesRepository = dependencies.readerPreferencesRepository;
  const eventDispatcher = dependencies.eventDispatcher;
  const eventSink = dependencies.eventSink;
  const htmlAudioPlayer = dependencies.htmlAudioPlayer;
  const libraryWorkflows = createReaderLibraryWorkflows({
    eventDispatcher,
    repository
  });
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
  const [libraryRailWidth, setLibraryRailWidth] = createSignal(sidebarDefaultWidths.library);
  const [inspectorRailWidth, setInspectorRailWidth] = createSignal(sidebarDefaultWidths.inspector);
  const [activeView, setActiveView] = createSignal<AppView>("reader");
  const [libraryRailMode, setLibraryRailMode] = createSignal(
    createLibraryRailMode(sampleReader.book.id)
  );
  const [isLibraryLoading, setIsLibraryLoading] = createSignal(false);
  const [isLibrarySearching, setIsLibrarySearching] = createSignal(false);
  const [isImporting, setIsImporting] = createSignal(false);
  const [isLibraryDropTarget, setIsLibraryDropTarget] = createSignal(false);
  const [playback, setPlayback] = createSignal(createPlaybackState());
  const [activeNarration, setActiveNarration] = createSignal<SentenceNarration | null>(null);
  const [isPreparingNarration, setIsPreparingNarration] = createSignal(false);
  const [isChapterTransitionPending, setIsChapterTransitionPending] = createSignal(false);
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

  let narrationRun = 0;
  let chapterTransitionRun = 0;
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

    return paragraphsInSentenceRange(reader().paragraphs, range.start, range.end);
  });
  const readerProgressIndex = createMemo(() => createReaderProgressIndex(reader().chapters));
  const readerProgress = createMemo(() =>
    calculateReaderProgressFromIndex(
      readerProgressIndex(),
      reader().chapter.id,
      playback().activeSentenceIndex
    )
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
  const readerSearchHitIds = createMemo(
    () => new Set(readerSearchResults().map((result) => result.sentence.id))
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
    if (isChapterTransitionPending()) return "Next chapter soon";
    if (isPreparingNarration()) return "Preparing audio";
    if (narrationNotice() != null) return "Needs attention";
    if (activeNarration()?.readiness === "ready") return "Ready to listen";

    return reader().source === "sample" ? "Sample narration" : "Ready to listen";
  });

  const dispatchEvent = (event: AnyDomainEvent) => {
    void eventDispatcher.dispatch(event).catch((error) => {
      if (import.meta.env.DEV) console.error("[sonelle][events] Event reaction failed.", error);
    });
  };

  const getSidebarBounds = (sidebar: ResizableSidebar) =>
    getSidebarResizeBounds({
      sidebar,
      viewportWidth: window.innerWidth,
      oppositeSidebarWidth: sidebar === "library" ? inspectorRailWidth() : libraryRailWidth()
    });

  const clampSidebarWidthsToViewport = () => {
    setLibraryRailWidth((width) => clampSidebarWidth(width, getSidebarBounds("library")));
    setInspectorRailWidth((width) => clampSidebarWidth(width, getSidebarBounds("inspector")));
  };

  onMount(() => {
    let disposed = false;
    let unlistenBookDrops: (() => void) | undefined;
    void refreshLibrary();
    void refreshAllBookmarks();
    void refreshAudioCacheStats();
    clampSidebarWidthsToViewport();
    void dependencies.listenForBookDrops(handleBookDropEvent).then((unlisten) => {
      if (disposed) {
        unlisten();
      } else {
        unlistenBookDrops = unlisten;
      }
    });

    window.addEventListener("keydown", handleShortcut);
    window.addEventListener("resize", clampSidebarWidthsToViewport);
    onCleanup(() => {
      disposed = true;
      window.removeEventListener("keydown", handleShortcut);
      window.removeEventListener("resize", clampSidebarWidthsToViewport);
      unlistenBookDrops?.();
    });
  });
  onCleanup(() => readingPositionScheduler.flush());

  createEffect(() => {
    const settings = audioSettings();
    htmlAudioPlayer.setPlaybackRate(settings.playbackRate);
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
    const timeoutId = window.setTimeout(() => {
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
    }, librarySearchDelayMs);

    onCleanup(() => window.clearTimeout(timeoutId));
  });

  createEffect(() => {
    const currentPlayback = playback();
    const sentence = activeSentence();
    const currentReader = reader();

    if (currentPlayback.status !== "playing" || sentence == null) return;

    narrationRun += 1;
    const request = createSentenceNarrationRequest(
      currentReader,
      sentence,
      audioSettings().voiceId
    );

    dispatchEvent(
      createDomainEvent("AudioPreparationRequested", {
        bookId: request.bookId,
        chapterId: request.chapterId,
        sentenceId: request.sentenceId,
        voiceId: request.voiceId
      })
    );

    onCleanup(() => {
      narrationRun += 1;
      setIsPreparingNarration(false);
      stopActiveHtmlAudio();
      if (activeNarration()?.playbackMode === "native-speech") {
        void narrationRepository.stopPreparedSentenceAudio().catch((error) => {
          reportNarrationDevelopmentError(error, {
            stage: "stop",
            sentenceId: request.sentenceId,
            voiceId: request.voiceId,
            playbackMode: "native-speech"
          });
        });
      }
    });
  });

  createEffect(() => {
    const currentPlayback = playback();
    const currentReader = reader();
    const nextChapter = nextReaderChapter(currentReader.chapters, currentReader.chapter.id);

    if (currentPlayback.status !== "ended" || !audioSettings().autoAdvance || nextChapter == null) {
      setIsChapterTransitionPending(false);
      return;
    }

    const runId = ++chapterTransitionRun;
    setIsChapterTransitionPending(true);

    const timeoutId = window.setTimeout(() => {
      void openNextChapterAfterBreak(currentReader, nextChapter.id, runId);
    }, chapterTransitionDelayMs);

    onCleanup(() => {
      window.clearTimeout(timeoutId);
      chapterTransitionRun += 1;
      setIsChapterTransitionPending(false);
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
    if (event.defaultPrevented || isTypingTarget(event.target) || activeView() !== "reader") return;

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
    const currentReader = reader();
    dispatchEvent(
      createDomainEvent("WordInspected", {
        bookId: currentReader.book.id,
        chapterId: currentReader.chapter.id,
        sentenceId: sentence.id,
        surface: token.text,
        language: currentReader.book.language
      })
    );
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

  const lookupDictionaryWord = async (event: DomainEvent<"WordInspected">) => {
    const { surface } = event.payload;
    const key = normalizeInsightKey(surface);
    if (key.length === 0 || savedDictionary().entries[key] != null) return;

    setDictionaryLookups((current) => ({
      ...current,
      [key]: loadingDictionaryLookup()
    }));

    const result = await lookupReaderWord(event, { dictionaryRepository });
    setDictionaryLookups((current) => ({ ...current, [key]: result }));
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
      stopActiveHtmlAudio();
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

  const sendLibraryRailEvent = (event: LibraryRailEvent) => {
    setLibraryRailMode((current) => transitionLibraryRailMode(current, event));
  };

  const openAppView = (view: AppView) => {
    if (view === "library") {
      const sentence = activeSentence();
      dispatchEvent(
        createDomainEvent("ReaderClosed", {
          bookId: reader().book.id,
          chapterId: reader().chapter.id,
          sentenceId: sentence?.id ?? ""
        })
      );
      return;
    }

    setActiveView(view);
    sendLibraryRailEvent({ type: "reader-opened", bookId: reader().book.id });
  };

  const stopReaderPlayback = async () => {
    const narration = activeNarration();
    narrationRun += 1;
    chapterTransitionRun += 1;
    stopActiveHtmlAudio();
    setIsPreparingNarration(false);
    setIsChapterTransitionPending(false);
    setActiveNarration(null);
    setPlayback((current) => pausePlayback(current));

    try {
      await narrationRepository.stopPreparedSentenceAudio();
    } catch (error) {
      reportNarrationDevelopmentError(error, {
        stage: "stop",
        sentenceId: activeSentence()?.id ?? "unknown",
        voiceId: audioSettings().voiceId,
        playbackMode: narration?.playbackMode ?? null
      });
    }
  };

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
    const previousReader = reader();
    const currentAudioSettings = audioSettings();
    const switchingBooks =
      nextReader.book.id !== previousReader.book.id || nextReader.source !== previousReader.source;
    const nextVoiceId = switchingBooks
      ? resolveNarrationVoiceForLanguage(nextReader.book.language, currentAudioSettings.voiceId)
      : currentAudioSettings.voiceId;
    const nextAudioSettings = createAudioSettings({
      ...currentAudioSettings,
      voiceId: nextVoiceId
    });

    readingPositionScheduler.flush();
    nextPositionSaveIntent = "immediate";
    sentenceElements.clear();

    if (nextAudioSettings.voiceId !== currentAudioSettings.voiceId) {
      stopActiveHtmlAudio();
      narrationRepository.clearPrefetchedNarrations();
    }

    batch(() => {
      if (nextAudioSettings.voiceId !== currentAudioSettings.voiceId) {
        setAudioSettings(nextAudioSettings);
      }
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
    let failureStage: "prepare" | "playback" = "prepare";

    try {
      const narration = await narrationRepository.prepareSentenceAudio(request);
      if (runId !== narrationRun) return;

      setActiveNarration(narration);

      if (narration.readiness !== "ready") {
        const message = narration.message ?? "Narration needs attention.";
        dispatchEvent(
          createDomainEvent("AudioPreparationFailed", {
            bookId: request.bookId,
            chapterId: request.chapterId,
            sentenceId: request.sentenceId,
            voiceId: request.voiceId,
            reason: message
          })
        );
        reportNarrationDevelopmentError(message, {
          stage: "prepare",
          sentenceId: request.sentenceId,
          voiceId: request.voiceId,
          playbackMode: narration.playbackMode
        });
        return;
      }

      dispatchEvent(
        createDomainEvent("SentenceAudioReady", {
          bookId: request.bookId,
          chapterId: request.chapterId,
          sentenceId: request.sentenceId,
          voiceId: request.voiceId,
          source: narration.cached ? "cache" : "prepared"
        })
      );

      failureStage = "playback";
      prefetchNextSentenceNarration(currentReader, activeSentenceIndex);

      if (narration.playbackMode === "html-audio") {
        if (narration.sourceUrl == null) {
          throw new Error("Ready HTML narration did not include an audio source URL.");
        }
        await htmlAudioPlayer.play(narration.sourceUrl);
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

      const failureMessage =
        failureStage === "prepare"
          ? toFriendlyNarrationError(error)
          : narrationPlaybackFailureMessage;
      dispatchEvent(
        createDomainEvent("AudioPreparationFailed", {
          bookId: request.bookId,
          chapterId: request.chapterId,
          sentenceId: request.sentenceId,
          voiceId: request.voiceId,
          reason: failureMessage
        })
      );

      reportNarrationDevelopmentError(error, {
        stage: failureStage,
        sentenceId: request.sentenceId,
        voiceId: request.voiceId,
        playbackMode: activeNarration()?.playbackMode ?? null
      });
    }
  };

  const prepareRequestedNarration = async (event: DomainEvent<"AudioPreparationRequested">) => {
    const currentReader = reader();
    if (
      currentReader.book.id !== event.payload.bookId ||
      currentReader.chapter.id !== event.payload.chapterId
    ) {
      return;
    }

    const activeSentenceIndex = currentReader.sentences.findIndex(
      (sentence) => sentence.id === event.payload.sentenceId
    );
    const sentence = currentReader.sentences[activeSentenceIndex];
    if (sentence == null) return;

    const request = createSentenceNarrationRequest(currentReader, sentence, event.payload.voiceId);
    const runId = narrationRun;
    setIsPreparingNarration(true);
    setNarrationNotice(null);
    await playSentenceNarration(request, runId, currentReader, activeSentenceIndex);
  };

  function stopActiveHtmlAudio() {
    htmlAudioPlayer.stop();
  }

  const prefetchNextSentenceNarration = (
    currentReader: ReaderView,
    activeSentenceIndex: number
  ) => {
    const nextSentence = currentReader.sentences[activeSentenceIndex + 1];
    if (nextSentence == null) return;

    const request = createSentenceNarrationRequest(
      currentReader,
      nextSentence,
      audioSettings().voiceId
    );

    void narrationRepository.prefetchSentenceAudio(request).catch((error) => {
      reportNarrationDevelopmentError(error, {
        stage: "prefetch",
        sentenceId: request.sentenceId,
        voiceId: request.voiceId
      });
    });
  };

  const refreshLibraryProjection = async () => {
    const books = await repository.listBooks();
    setLibraryBooks(books);
    return books;
  };

  const refreshLibrary = async () => {
    setIsLibraryLoading(true);
    try {
      const books = await refreshLibraryProjection();

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
    const nextReader = buildFixtureReaderView();
    activateReader(nextReader);
    setActiveView("reader");
    sendLibraryRailEvent({ type: "reader-opened", bookId: nextReader.book.id });
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

  async function openNextChapterAfterBreak(
    previousReader: ReaderView,
    nextChapterId: string,
    runId: number
  ) {
    if (runId !== chapterTransitionRun) return;
    if (
      reader().book.id !== previousReader.book.id ||
      reader().chapter.id !== previousReader.chapter.id
    ) {
      return;
    }

    setIsChapterTransitionPending(false);

    if (previousReader.source === "sample") {
      const nextReader = buildFixtureReaderView({ chapterId: nextChapterId, sentenceIndex: 0 });
      activateReader(nextReader, 0, "playing");
      setActiveView("reader");
      sendLibraryRailEvent({ type: "reader-opened", bookId: nextReader.book.id });
      setLibraryNotice(null);
      void refreshBookmarks(nextReader.book.id);
      return;
    }

    await openLibraryBook(previousReader.book.id, {
      chapterId: nextChapterId,
      sentenceIndex: 0,
      playbackStatus: "playing"
    });
  }

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
      sendLibraryRailEvent({ type: "reader-opened", bookId: nextReader.book.id });
      setLibraryNotice(null);
    } catch (error) {
      setLibraryNotice(toFriendlyLibraryError(error));
    }
  };

  const handleBookDropEvent = (event: BookDropEvent) => {
    if (activeView() !== "library") return;

    if (event.type === "leave") {
      setIsLibraryDropTarget(false);
      return;
    }

    if (event.type === "enter" || event.type === "over") {
      setIsLibraryDropTarget(true);
      return;
    }

    setIsLibraryDropTarget(false);
    const path = resolveDroppedEpubPath(event.paths);
    if (path == null) {
      setLibraryNotice("Drop an EPUB file to add it to your library.");
      return;
    }

    void importBookFromPath(path);
  };

  const handleBrowserDrop = (files: File[]) => {
    setIsLibraryDropTarget(false);
    const paths = files
      .map((file) => (file as File & { path?: unknown }).path)
      .filter((value): value is string => typeof value === "string");
    const path = resolveDroppedEpubPath(paths);

    if (path == null) {
      setLibraryNotice("Drop an EPUB file into the desktop app to add it to your library.");
      return;
    }

    void importBookFromPath(path);
  };

  const importBook = async () => {
    if (isImporting()) return;

    const existingBookIds = new Set(libraryBooks().map((book) => book.id));
    setIsImporting(true);
    setLibraryNotice(null);

    try {
      await libraryWorkflows.importFromDialog(existingBookIds);
    } catch (error) {
      setLibraryNotice(toFriendlyLibraryError(error));
    } finally {
      setIsImporting(false);
    }
  };

  const importBookFromPath = async (path: string) => {
    if (isImporting()) return;

    const existingBookIds = new Set(libraryBooks().map((book) => book.id));
    setIsImporting(true);
    setLibraryNotice(null);

    try {
      await libraryWorkflows.importFromPath(path, existingBookIds);
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
      await libraryWorkflows.saveBookmark({
        bookId: reader().book.id,
        bookTitle: reader().book.title,
        chapterId: reader().chapter.id,
        chapterTitle: reader().chapter.title,
        sentenceId: sentence.id,
        sentenceIndex: sentence.index,
        text: sentence.text,
        note: null
      });
    } catch (error) {
      setBookmarkNotice(toFriendlyLibraryError(error));
    }
  };

  const deleteBookmark = async (bookmarkId: string) => {
    try {
      const bookId = bookmarks().find((bookmark) => bookmark.id === bookmarkId)?.bookId;
      await libraryWorkflows.deleteBookmark(bookmarkId, bookId ?? reader().book.id);
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

  const prepareRequestedBookExport = async (event: DomainEvent<"BookExportRequested">) => {
    if (event.payload.bookId !== reader().book.id) return;

    const currentReader = reader();
    const currentBookmarks = currentBookBookmarks();
    const data =
      currentReader.source === "library"
        ? await repository.exportBookData(currentReader.book.id)
        : createSampleExport(currentReader, playback().activeSentenceIndex, currentBookmarks);
    const fileName = `${slugify(currentReader.book.title)}-sonelle-export.json`;
    downloadJson(fileName, data);
    await eventDispatcher.dispatch(
      createDomainEvent("BookExported", {
        bookId: currentReader.book.id,
        exportedAt: new Date().toISOString(),
        bookmarkCount: currentBookmarks.length,
        fileName
      })
    );
  };

  const exportCurrentBook = async () => {
    try {
      await eventDispatcher.dispatch(
        createDomainEvent("BookExportRequested", { bookId: reader().book.id })
      );
    } catch (error) {
      setExportNotice(toFriendlyLibraryError(error));
    }
  };

  const subscriptions = [
    eventDispatcher.subscribe("AudioPreparationRequested", (event) => eventSink.append(event)),
    eventDispatcher.subscribe("AudioPreparationRequested", prepareRequestedNarration),
    eventDispatcher.subscribe("SentenceAudioReady", (event) => eventSink.append(event)),
    eventDispatcher.subscribe("SentenceAudioReady", () => {
      setIsPreparingNarration(false);
    }),
    eventDispatcher.subscribe("AudioPreparationFailed", (event) => eventSink.append(event)),
    eventDispatcher.subscribe("AudioPreparationFailed", (event) => {
      setIsPreparingNarration(false);
      setNarrationNotice(event.payload.reason);
      setPlayback((current) => pausePlayback(current));
    }),
    eventDispatcher.subscribe("WordInspected", (event) => eventSink.append(event)),
    eventDispatcher.subscribe("WordInspected", lookupDictionaryWord),
    eventDispatcher.subscribe("BookImported", () =>
      refreshLibraryProjection().then(() => undefined)
    ),
    eventDispatcher.subscribe("BookImported", (event) => openLibraryBook(event.payload.bookId)),
    eventDispatcher.subscribe("BookImported", (event) => {
      setLibraryNotice(libraryImportNotice(event.payload.replacedExisting ? "reopened" : "added"));
    }),
    eventDispatcher.subscribe("BookImported", (event) => refreshBookmarks(event.payload.bookId)),
    eventDispatcher.subscribe("BookmarkCreated", (event) => refreshBookmarks(event.payload.bookId)),
    eventDispatcher.subscribe("BookmarkCreated", () => {
      setBookmarkNotice("Bookmark saved.");
      setInspectorTab("bookmarks");
    }),
    eventDispatcher.subscribe("BookmarkDeleted", (event) => refreshBookmarks(event.payload.bookId)),
    eventDispatcher.subscribe("BookmarkDeleted", () => {
      setBookmarkNotice("Bookmark removed.");
    }),
    eventDispatcher.subscribe("BookExportRequested", prepareRequestedBookExport),
    eventDispatcher.subscribe("BookExported", (event) => {
      if (event.payload.fileName != null) {
        setExportNotice(`Downloaded ${event.payload.fileName}. Check your Downloads folder.`);
      }
    }),
    eventDispatcher.subscribe("ReaderClosed", () => {
      setActiveView("library");
      sendLibraryRailEvent({ type: "library-opened" });
    }),
    eventDispatcher.subscribe("ReaderClosed", stopReaderPlayback)
  ];
  onCleanup(() => subscriptions.forEach((unsubscribe) => unsubscribe()));

  return (
    <main
      class="sonelle-shell"
      style={{
        "--library-rail-width": `${libraryRailWidth()}px`,
        "--inspector-rail-width": `${inspectorRailWidth()}px`
      }}
    >
      <ProductBar />
      <LibraryRail
        mode={libraryRailMode()}
        activeView={activeView()}
        activeBook={reader().book}
        activeChapterId={reader().chapter.id}
        chapters={reader().chapters}
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
        onOpenView={openAppView}
        onOpenToolTab={setInspectorTab}
        onOpenChapter={openChapter}
        onReturnToLibrary={() => openAppView("library")}
      />
      <SidebarResizeHandle
        sidebar="library"
        edge="right"
        width={libraryRailWidth()}
        defaultWidth={sidebarDefaultWidths.library}
        getBounds={() => getSidebarBounds("library")}
        onWidthChange={setLibraryRailWidth}
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
            dropActive={isLibraryDropTarget()}
            notice={libraryNotice()}
            onQueryChange={setLibraryQuery}
            onFilterChange={setLibraryFilter}
            onImport={importBook}
            onDragEnter={() => setIsLibraryDropTarget(true)}
            onDragLeave={() => setIsLibraryDropTarget(false)}
            onDropFiles={handleBrowserDrop}
            onOpenBook={openLibraryBook}
            onRetryLibrary={refreshLibrary}
            onOpenSample={openSampleReader}
          />
        }
      >
        <section class="reader-surface" aria-label="Reader">
          <ReaderTopAppBar
            chapterTitle={reader().chapter.title}
            activeChapterId={reader().chapter.id}
            chapters={reader().chapters}
            sentenceCount={reader().sentences.length}
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
              <h1 class="article-title">{reader().chapter.title}</h1>
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
                    visibleStartIndex={visibleSentenceRange().start}
                    visibleEndIndex={visibleSentenceRange().end}
                    activeSentenceId={highlight().activeSentenceId}
                    bookmarkedSentenceIds={bookmarkedSentenceIds()}
                    readerSearchHitIds={readerSearchHitIds()}
                    selectedWord={selectedWord()}
                    activeWordInsight={activeWordInsight()}
                    onRegisterSentence={(sentenceId, element) => {
                      sentenceElements.set(sentenceId, element);
                    }}
                    onUnregisterSentence={(sentenceId) => {
                      sentenceElements.delete(sentenceId);
                    }}
                    onSelectSentence={(sentenceIndex) => {
                      selectSentence(sentenceIndex);
                      setInspectorTab("bookmarks");
                    }}
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
          activeSentence={activeSentence() ?? null}
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
        <SidebarResizeHandle
          sidebar="inspector"
          edge="left"
          width={inspectorRailWidth()}
          defaultWidth={sidebarDefaultWidths.inspector}
          getBounds={() => getSidebarBounds("inspector")}
          onWidthChange={setInspectorRailWidth}
        />

        <PlaybackRail
          chapterNumber={Math.max(
            1,
            reader().chapters.findIndex((chapter) => chapter.id === reader().chapter.id) + 1
          )}
          chapterTitle={reader().chapter.title}
          progress={readerProgress()}
          sentenceCount={reader().sentences.length}
          status={playback().status}
          narrationStatus={narrationStatusLabel()}
          narrationNotice={narrationNotice()}
          bookmarked={activeBookmark() != null}
          playbackRate={audioSettings().playbackRate}
          onPrevious={() => moveSentence(-1)}
          onToggle={togglePlayback}
          onNext={() => moveSentence(1)}
          onToggleBookmark={() => void toggleActiveBookmark()}
        />
      </Show>
    </main>
  );
}
