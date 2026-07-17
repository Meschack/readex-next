import {
  batch,
  createEffect,
  createMemo,
  createSelector,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
  untrack
} from "solid-js";
import type { AudioSettings } from "@sonelle/audio";
import { createDomainEvent, type AnyDomainEvent } from "@sonelle/domain";
import {
  bookmarkedBookIds,
  filterLibraryBooks,
  resolveLibraryBookListState,
  type LibraryBookFilter
} from "@sonelle/library";
import {
  calculateReaderProgressFromIndex,
  calculateSentenceRenderWindow,
  createPlaybackState,
  createReaderProgressIndex,
  createReaderPreferences,
  highlightSentence,
  readableInkForColor,
  searchReaderSentences
} from "@sonelle/reader";
import {
  createWordInsight,
  listSavedDictionaryEntries,
  normalizeInsightKey,
  type DictionaryLookupResult,
  type SavedDictionary,
  type SavedDictionaryEntry
} from "@sonelle/learning";
import type { ReaderTextToken } from "@sonelle/text";
import { reportNarrationError, toFriendlyNarrationError } from "../audio/narration-repository";
import { reportAppError } from "../platform/error-reporting";
import { toFriendlyLibraryError } from "../library/library-errors";
import type { LibraryBookmarkDto, LibrarySearchResultDto } from "../library/library-contracts";
import { ChapterNavigator, PlaybackRail, ProductBar, ReaderTopAppBar } from "./reader-chrome";
import {
  ReaderContentProvider,
  ReaderParagraph,
  type ReaderContentInteractions
} from "./reader-content";
import { ReaderToast } from "./reader-feedback";
import type { LibraryBookSummary } from "../library/library-models";
import type { AppView, InspectorTab, SelectedWord } from "./reader-experience-types";
import { cssFontFamilyStack, isTypingTarget } from "./reader-formatting";
import { ReaderInspector, type ReaderInspectorModel } from "./reader-inspector";
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
import { createReaderWordInsightWorkflow } from "./reader-word-insight-workflow";
import { createReaderBookExportWorkflow } from "./reader-book-export-workflow";
import { observeReaderErrors } from "./reader-error-reporting";
import {
  createReaderParagraphImageWorkflow,
  type ParagraphImageNotice
} from "./reader-paragraph-image-workflow";
import { createReaderLibraryApplication } from "./reader-library-application";
import { createReaderLibrarySearchWorkflow } from "./reader-library-search-workflow";
import {
  createCheckingOfflineNarrationProfiles,
  offlineNarrationReadinessMessage,
  createReaderOfflineNarrationApplication,
  type OfflineVoiceView,
  type PreparedAudioView
} from "./reader-offline-narration-application";
import { createReaderNavigationApplication } from "./reader-navigation-application";
import { createReaderOpeningWorkflow } from "./reader-opening-workflow";
import { createReaderPlaybackApplication } from "./reader-playback-application";
import { createReaderNarrationSettingsWorkflow } from "./reader-narration-settings-workflow";
import { createReaderAppearanceWorkflow } from "./reader-appearance-workflow";
import { createReaderTypographyWorkflow } from "./reader-typography-workflow";
import {
  createReaderExperienceDependencies,
  type ReaderExperienceDependencies
} from "./reader-dependencies";
import {
  LibraryRail,
  LibraryWorkspace,
  type LibraryCollectionModel,
  type LibraryRailModel,
  type LibraryWorkspaceModel
} from "./library-surfaces";
import {
  buildFixtureReaderView,
  buildReaderViewFromDocument,
  paragraphsInSentenceRange,
  type ReaderSentenceView,
  type ReaderView
} from "./reader-view";

const renderedSentenceLead = 24;
const renderedSentenceTrail = 48;
const narrationPreparationToastDelayMs = 300;
const defaultReaderFontStack =
  '"SpaceMono Nerd Font Propo", "Space Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace';
const defaultUiFontStack =
  'Satoshi, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

export interface ReaderExperienceProps {
  dependencies?: ReaderExperienceDependencies;
}

export function ReaderExperience(props: ReaderExperienceProps) {
  const dependencies = props.dependencies ?? createReaderExperienceDependencies();
  const bookCatalog = dependencies.bookCatalog;
  const bookmarkStore = dependencies.bookmarkStore;
  const narrationService = dependencies.narration;
  const usesLanguagePacks = narrationService.capabilities.offlineLibrary === "language-pack";
  const dictionaryRepository = dependencies.dictionaryRepository;
  const audioSettingsRepository = dependencies.audioSettingsRepository;
  const readerPreferencesRepository = dependencies.readerPreferencesRepository;
  const eventDispatcher = dependencies.eventDispatcher;
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
  const [readerContentFontFamily, setReaderContentFontFamily] = createSignal(
    readerPreferences.contentFontFamily
  );
  const [uiFontFamily, setUiFontFamily] = createSignal(readerPreferences.uiFontFamily);
  const [narrationHighlightColor, setNarrationHighlightColor] = createSignal(
    readerPreferences.narrationHighlightColor
  );
  const [bookmarkHighlightColor, setBookmarkHighlightColor] = createSignal(
    readerPreferences.bookmarkHighlightColor
  );
  const [systemFontFamilies, setSystemFontFamilies] = createSignal<readonly string[]>([]);
  const [preferredLibraryRailWidth, setPreferredLibraryRailWidth] = createSignal(
    readerPreferences.libraryRailWidth
  );
  const [preferredInspectorRailWidth, setPreferredInspectorRailWidth] = createSignal(
    readerPreferences.inspectorRailWidth
  );
  const currentReaderPreferences = () =>
    createReaderPreferences({
      toolTab: inspectorTab(),
      libraryFilter: libraryFilter(),
      libraryRailWidth: preferredLibraryRailWidth(),
      inspectorRailWidth: preferredInspectorRailWidth(),
      contentFontSize: readerContentFontSize(),
      contentFontFamily: readerContentFontFamily(),
      uiFontFamily: uiFontFamily(),
      narrationHighlightColor: narrationHighlightColor(),
      bookmarkHighlightColor: bookmarkHighlightColor()
    });
  const [libraryRailWidth, setLibraryRailWidth] = createSignal(readerPreferences.libraryRailWidth);
  const [inspectorRailWidth, setInspectorRailWidth] = createSignal(
    readerPreferences.inspectorRailWidth
  );
  const [activeView, setActiveView] = createSignal<AppView>("reader");
  const [libraryRailMode, setLibraryRailMode] = createSignal(
    createLibraryRailMode(sampleReader.book.id)
  );
  const sendLibraryRailEvent = (event: LibraryRailEvent) => {
    setLibraryRailMode((current) => transitionLibraryRailMode(current, event));
  };
  const [isLibraryLoading, setIsLibraryLoading] = createSignal(false);
  const [isLibrarySearching, setIsLibrarySearching] = createSignal(false);
  const [isImporting, setIsImporting] = createSignal(false);
  const [isLibraryDropTarget, setIsLibraryDropTarget] = createSignal(false);
  const [playback, setPlayback] = createSignal(createPlaybackState());
  const [narrationNotice, setNarrationNotice] = createSignal<string | null>(null);
  const [narrationPreparing, setNarrationPreparing] = createSignal(false);
  const [showNarrationPreparation, setShowNarrationPreparation] = createSignal(false);
  const [narrationAudible, setNarrationAudible] = createSignal(false);
  const persistedAudioSettings = audioSettingsRepository.load();
  const [audioSettings, setAudioSettings] = createSignal<AudioSettings>(
    narrationService.activateSettings(persistedAudioSettings, sampleReader.book.language)
  );
  const [voiceInstallation, setVoiceInstallation] = createSignal<OfflineVoiceView>({
    voiceId: audioSettings().voiceId,
    status: "preparing",
    downloadSizeBytes: 0,
    downloadedBytes: 0,
    progress: null,
    message: "Checking offline voice"
  });
  const [offlineNarrationProfiles, setOfflineNarrationProfiles] = createSignal(
    createCheckingOfflineNarrationProfiles()
  );
  const [narrationVoices, setNarrationVoices] = createSignal(
    narrationService.voices(sampleReader.book.language)
  );
  const [audioCacheStats, setAudioCacheStats] = createSignal<PreparedAudioView | null>(null);
  const [audioCacheNotice, setAudioCacheNotice] = createSignal<string | null>(null);
  const [exportNotice, setExportNotice] = createSignal<string | null>(null);
  const [paragraphImageNotice, setParagraphImageNotice] = createSignal<ParagraphImageNotice | null>(
    null
  );
  const [savedDictionary, setSavedDictionary] = createSignal<SavedDictionary>(
    dictionaryRepository.loadSavedDictionary()
  );
  const [dictionaryLookups, setDictionaryLookups] = createSignal<
    Record<string, DictionaryLookupResult>
  >({});
  const [selectedWord, setSelectedWord] = createSignal<SelectedWord | null>(null);
  const wordInsightWorkflow = createReaderWordInsightWorkflow(
    {
      dictionary: dictionaryRepository,
      eventDispatcher,
      onEventError: reportEventReactionFailure
    },
    {
      savedDictionary,
      projectSelection: setSelectedWord,
      projectLookup(key, result) {
        setDictionaryLookups((current) => ({ ...current, [key]: result }));
      },
      projectSavedDictionary: setSavedDictionary,
      openWordInspector() {
        setInspectorTab("word");
      }
    }
  );
  let readerSearchInput: HTMLInputElement | undefined;
  const sentenceElements = new Map<string, HTMLElement>();
  const narrationWorkflow = narrationService.createWorkflow({
    currentReader: reader,
    currentSettings: audioSettings,
    projectPlayback: (event) => playbackApplication.projectNarration(event),
    projectPreparing: setNarrationPreparing,
    projectAudible: setNarrationAudible,
    projectNotice: setNarrationNotice,
    reportError(error, stage, sentenceId) {
      reportNarrationError(error, {
        stage,
        sentenceId,
        voiceId: audioSettings().voiceId,
        playbackMode: "manifest"
      });
    }
  });
  const narrationSettingsWorkflow = createReaderNarrationSettingsWorkflow(
    {
      eventDispatcher,
      repository: audioSettingsRepository,
      narration: narrationWorkflow,
      activateSettings: narrationService.activateSettings,
      reportEventError: reportEventReactionFailure
    },
    {
      currentSettings: audioSettings,
      currentLanguage: () => reader().book.language,
      projectSettings: setAudioSettings
    }
  );
  const typographyWorkflow = createReaderTypographyWorkflow(
    {
      eventDispatcher,
      repository: readerPreferencesRepository,
      reportEventError: reportEventReactionFailure
    },
    {
      currentPreferences: currentReaderPreferences,
      projectTypography(typography) {
        batch(() => {
          setReaderContentFontSize(typography.contentFontSize);
          setReaderContentFontFamily(typography.contentFontFamily);
          setUiFontFamily(typography.uiFontFamily);
        });
      }
    }
  );
  const appearanceWorkflow = createReaderAppearanceWorkflow(
    {
      eventDispatcher,
      repository: readerPreferencesRepository,
      reportEventError: reportEventReactionFailure
    },
    {
      currentPreferences: currentReaderPreferences,
      projectAppearance(appearance) {
        batch(() => {
          setNarrationHighlightColor(appearance.narrationHighlightColor);
          setBookmarkHighlightColor(appearance.bookmarkHighlightColor);
        });
      }
    }
  );
  const playbackApplication = createReaderPlaybackApplication(
    {
      narration: narrationWorkflow,
      settings: narrationSettingsWorkflow,
      eventDispatcher,
      positions: dependencies.readingPositionStore,
      preparesAcrossChapters: narrationService.capabilities.preparesAcrossChapters,
      reportEventError: reportEventReactionFailure,
      reportPlaybackError(event) {
        reportNarrationError(event.payload.reason, {
          stage: "playback",
          sentenceId: event.payload.sentenceId,
          voiceId: audioSettings().voiceId,
          playbackMode: "manifest"
        });
      }
    },
    {
      currentReader: reader,
      currentPlayback: playback,
      currentSettings: audioSettings,
      narrationAudible,
      narrationReadinessMessage: () =>
        usesLanguagePacks
          ? offlineNarrationReadinessMessage(offlineNarrationProfiles(), reader().book.language)
          : voiceInstallation().status === "ready"
            ? null
            : "Download this voice to listen offline.",
      projectPlayback: setPlayback,
      projectNotice: (message) => {
        if (message != null) setInspectorTab("settings");
        setNarrationNotice(message);
      },
      projectAudible: setNarrationAudible,
      projectPreparing: setNarrationPreparing,
      projectJump(update) {
        batch(() => {
          setPlayback(update);
          setNarrationNotice(null);
          setSelectedWord(null);
        });
      },
      projectReaderActivation(nextReader, nextPlayback) {
        batch(() => {
          setReader(nextReader);
          setPlayback(nextPlayback);
          setNarrationNotice(null);
          setNarrationAudible(false);
          setSelectedWord(null);
        });
      },
      clearSentenceElements: () => sentenceElements.clear(),
      advanceChapter: openNextChapterAfterBreak,
      reportPositionError: () => setLibraryNotice("We couldn't save your place just now.")
    }
  );
  const openingWorkflow = createReaderOpeningWorkflow(
    {
      eventDispatcher,
      playback: playbackApplication,
      reportEventError: reportEventReactionFailure
    },
    {
      projectReaderSurface: () => setActiveView("reader"),
      projectLibraryRail: (bookId) => sendLibraryRailEvent({ type: "reader-opened", bookId }),
      projectLibraryNotice: setLibraryNotice
    }
  );
  const offlineNarrationApplication = createReaderOfflineNarrationApplication(
    {
      audioCache: dependencies.audioCacheRepository,
      engineInstallations: dependencies.engineInstallationRepository,
      eventDispatcher,
      narration: narrationWorkflow,
      offlineLibrary: narrationService.capabilities.offlineLibrary,
      voiceInstallations: dependencies.voiceInstallationRepository,
      friendlyError: toFriendlyNarrationError,
      reportPreparedAudioError: (error, bookId) => {
        void reportAppError("prepared-audio.refresh", error, [bookId]);
      }
    },
    {
      currentBookId: () => reader().book.id,
      selectedVoiceId: () => audioSettings().voiceId,
      projectAudioCache: setAudioCacheStats,
      projectAudioCacheNotice: setAudioCacheNotice,
      projectEngineInstallation: (installation) => {
        narrationService.observeEngineInstallation(installation);
        setNarrationVoices(narrationService.voices(reader().book.language));
      },
      projectNarrationProfile: (profile) => {
        setOfflineNarrationProfiles((current) => ({ ...current, [profile.id]: profile }));
      },
      projectNarrationNotice: setNarrationNotice,
      projectVoiceInstallation: setVoiceInstallation
    }
  );

  const activeSentence = createMemo(() => reader().sentences[playback().activeSentenceIndex]);
  const highlight = createMemo(() => highlightSentence(activeSentence()?.id ?? null));
  const isActiveSentence = createSelector(() => highlight().activeSentenceId);
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
  const bookExportWorkflow = createReaderBookExportWorkflow(
    {
      eventDispatcher,
      exporter: dependencies.bookExporter,
      friendlyError: toFriendlyLibraryError,
      onEventError: reportEventReactionFailure
    },
    {
      currentReader: reader,
      currentSentenceIndex: () => playback().activeSentenceIndex,
      currentBookmarks: currentBookBookmarks,
      projectNotice: setExportNotice
    }
  );
  const paragraphImageWorkflow = createReaderParagraphImageWorkflow(
    {
      eventDispatcher,
      exporter: dependencies.paragraphImageExporter,
      onError(error) {
        void reportAppError("paragraph-image.export", error, [
          { bookId: reader().book.id, chapterId: reader().chapter.id }
        ]);
      }
    },
    {
      currentReader: reader,
      currentSentenceIndex: () => playback().activeSentenceIndex,
      projectNotice: setParagraphImageNotice
    }
  );
  const libraryApplication = createReaderLibraryApplication(
    {
      catalog: bookCatalog,
      drops: dependencies.bookDropAdapter,
      openRequests: dependencies.bookOpenRequestAdapter,
      importer: dependencies.bookImporter,
      bookmarks: bookmarkStore,
      eventDispatcher,
      friendlyError: toFriendlyLibraryError,
      onEventError: reportEventReactionFailure
    },
    {
      activeView,
      currentBookSource: () => reader().source,
      projectBooks: setLibraryBooks,
      projectBookmarks: (update) => setBookmarks(update),
      projectLoading: setIsLibraryLoading,
      projectImporting: setIsImporting,
      projectDropTarget: setIsLibraryDropTarget,
      projectLibraryNotice: setLibraryNotice,
      projectBookmarkNotice: setBookmarkNotice,
      async openDocument(document, options = {}) {
        const nextReader = buildReaderViewFromDocument(document, options);
        await openingWorkflow.open(
          nextReader,
          options.sentenceIndex ?? nextReader.initialSentenceIndex,
          options.playbackStatus ?? "idle"
        );
      },
      openBookmarkInspector() {
        setInspectorTab("bookmarks");
      }
    }
  );
  const librarySearchWorkflow = createReaderLibrarySearchWorkflow(
    { search: dependencies.librarySearch },
    {
      projectSearching: setIsLibrarySearching,
      projectResults: setLibrarySearchResults,
      projectNotice: setLibraryNotice
    }
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
  const navigationApplication = createReaderNavigationApplication(
    { library: libraryApplication, opening: openingWorkflow, playback: playbackApplication },
    {
      currentReader: reader,
      bookmarks,
      activeBookmark,
      activeSentence: () => activeSentence() ?? null,
      openBookmarkInspector: () => setInspectorTab("bookmarks")
    }
  );
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
  const publishDomainEvent = (event: AnyDomainEvent) => {
    void eventDispatcher.dispatch(event).catch(reportEventReactionFailure);
  };
  const getSidebarBounds = (sidebar: ResizableSidebar) =>
    getSidebarResizeBounds({
      sidebar,
      viewportWidth: window.innerWidth,
      oppositeSidebarWidth: sidebar === "library" ? inspectorRailWidth() : libraryRailWidth()
    });

  const clampSidebarWidthsToViewport = () => {
    const viewportWidth = window.innerWidth;
    const libraryWidth = clampSidebarWidth(
      preferredLibraryRailWidth(),
      getSidebarResizeBounds({
        sidebar: "library",
        viewportWidth,
        oppositeSidebarWidth: preferredInspectorRailWidth()
      })
    );
    const inspectorWidth = clampSidebarWidth(
      preferredInspectorRailWidth(),
      getSidebarResizeBounds({
        sidebar: "inspector",
        viewportWidth,
        oppositeSidebarWidth: libraryWidth
      })
    );
    const reconciledLibraryWidth = clampSidebarWidth(
      preferredLibraryRailWidth(),
      getSidebarResizeBounds({
        sidebar: "library",
        viewportWidth,
        oppositeSidebarWidth: inspectorWidth
      })
    );

    batch(() => {
      setLibraryRailWidth(reconciledLibraryWidth);
      setInspectorRailWidth(inspectorWidth);
    });
  };

  const updateLibraryRailWidth = (width: number) => {
    batch(() => {
      setPreferredLibraryRailWidth(width);
      setLibraryRailWidth(width);
    });
  };
  const updateInspectorRailWidth = (width: number) => {
    batch(() => {
      setPreferredInspectorRailWidth(width);
      setInspectorRailWidth(width);
    });
  };
  onMount(() => {
    let disposed = false;
    let stopLibraryApplication: (() => void) | undefined;
    let stopOfflineNarrationApplication: (() => void) | undefined;
    const stopNarrationWorkflow = narrationWorkflow.start();
    const stopNarrationSettingsWorkflow = narrationSettingsWorkflow.start();
    const stopTypographyWorkflow = typographyWorkflow.start();
    const stopAppearanceWorkflow = appearanceWorkflow.start();
    const stopPlaybackApplication = playbackApplication.start();
    const stopOpeningWorkflow = openingWorkflow.start();
    const stopWordInsightWorkflow = wordInsightWorkflow.start();
    const stopBookExportWorkflow = bookExportWorkflow.start();
    const stopParagraphImageWorkflow = paragraphImageWorkflow.start();
    const stopReaderErrorReporting = observeReaderErrors(
      eventDispatcher,
      (scope, error, details) => {
        void reportAppError(scope, error, details);
      }
    );
    void libraryApplication.start().then((stop) => {
      if (disposed) stop();
      else stopLibraryApplication = stop;
    });
    void libraryApplication.refresh();
    void libraryApplication.refreshBookmarks();
    void offlineNarrationApplication.start().then((stop) => {
      if (disposed) stop();
      else stopOfflineNarrationApplication = stop;
    });
    void dependencies.fontCatalog
      .listFamilies()
      .then((families) => {
        if (!disposed) setSystemFontFamilies(families);
      })
      .catch(reportEventReactionFailure);
    clampSidebarWidthsToViewport();

    window.addEventListener("keydown", handleShortcut);
    window.addEventListener("resize", clampSidebarWidthsToViewport);
    onCleanup(() => {
      disposed = true;
      window.removeEventListener("keydown", handleShortcut);
      window.removeEventListener("resize", clampSidebarWidthsToViewport);
      stopLibraryApplication?.();
      stopOfflineNarrationApplication?.();
      stopNarrationWorkflow();
      stopNarrationSettingsWorkflow();
      stopTypographyWorkflow();
      stopAppearanceWorkflow();
      stopPlaybackApplication();
      stopOpeningWorkflow();
      stopWordInsightWorkflow();
      stopBookExportWorkflow();
      stopParagraphImageWorkflow();
      stopReaderErrorReporting();
    });
  });
  onCleanup(() => {
    librarySearchWorkflow.stop();
    playbackApplication.dispose();
  });

  createEffect(() => {
    setShowNarrationPreparation(false);
    if (!narrationPreparing() || narrationAudible()) return;

    const timeoutId = window.setTimeout(() => {
      if (narrationPreparing() && !narrationAudible()) {
        setShowNarrationPreparation(true);
      }
    }, narrationPreparationToastDelayMs);
    onCleanup(() => window.clearTimeout(timeoutId));
  });

  createEffect(() => {
    const typography = untrack(() => ({
      contentFontSize: readerContentFontSize(),
      contentFontFamily: readerContentFontFamily(),
      uiFontFamily: uiFontFamily()
    }));
    const appearance = untrack(() => ({
      narrationHighlightColor: narrationHighlightColor(),
      bookmarkHighlightColor: bookmarkHighlightColor()
    }));
    readerPreferencesRepository.save(
      createReaderPreferences({
        toolTab: inspectorTab(),
        libraryFilter: libraryFilter(),
        libraryRailWidth: preferredLibraryRailWidth(),
        inspectorRailWidth: preferredInspectorRailWidth(),
        ...typography,
        ...appearance
      })
    );
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
    librarySearchWorkflow.queryChanged(libraryQuery());
  });

  createEffect(() => {
    const language = reader().book.language;
    setNarrationVoices(narrationService.voices(language));
  });

  createEffect(() => {
    const availableVoices = narrationVoices();
    if (
      availableVoices.length > 0 &&
      !availableVoices.some((voice) => voice.id === audioSettings().voiceId)
    ) {
      narrationSettingsWorkflow.change({ voiceId: availableVoices[0].id });
    }
  });

  createEffect(() => {
    onCleanup(playbackApplication.playbackChanged());
  });

  createEffect(() => {
    playbackApplication.autoAdvanceChanged();
  });

  createEffect(() => {
    playbackApplication.prefetchChanged();
  });

  createEffect(() => {
    playbackApplication.positionChanged();
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
      setNarrationNotice(null);
    }
  };

  const togglePlayback = playbackApplication.toggle;
  const moveSentence = playbackApplication.move;
  const selectSentence = playbackApplication.select;

  const selectWord = (
    sentence: ReaderSentenceView,
    token: Extract<ReaderTextToken, { kind: "word" }>
  ) => {
    const currentReader = reader();
    wordInsightWorkflow.inspect({
      bookId: currentReader.book.id,
      chapterId: currentReader.chapter.id,
      sentenceId: sentence.id,
      tokenIndex: token.index,
      surface: token.text,
      language: currentReader.book.language
    });
  };

  const selectSavedWord = (word: SavedDictionaryEntry) => {
    const currentReader = reader();
    wordInsightWorkflow.inspect({
      bookId: currentReader.book.id,
      chapterId: currentReader.chapter.id,
      sentenceId: "saved-words",
      tokenIndex: -1,
      surface: word.surface,
      language: currentReader.book.language
    });
  };

  const updateAudioSettings = narrationSettingsWorkflow.change;
  const updateVolume = narrationSettingsWorkflow.updateVolume;
  const toggleMute = narrationSettingsWorkflow.toggleMute;

  const updateReaderContentFontSize = (fontSize: number) => {
    typographyWorkflow.change({ contentFontSize: fontSize });
  };
  const updateReaderContentFontFamily = (fontFamily: string | null) => {
    typographyWorkflow.change({ contentFontFamily: fontFamily });
  };
  const updateUiFontFamily = (fontFamily: string | null) => {
    typographyWorkflow.change({ uiFontFamily: fontFamily });
  };
  const updateNarrationHighlightColor = (color: string) => {
    appearanceWorkflow.change({ narrationHighlightColor: color });
  };
  const updateBookmarkHighlightColor = (color: string) => {
    appearanceWorkflow.change({ bookmarkHighlightColor: color });
  };

  const openAppView = (view: AppView) => {
    if (view === "library") {
      const sentence = activeSentence();
      publishDomainEvent(
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

  const stopReaderPlayback = playbackApplication.stop;
  const openSampleReader = navigationApplication.openSample;
  const openChapter = navigationApplication.openChapter;

  async function openNextChapterAfterBreak(previousReader: ReaderView, nextChapterId: string) {
    if (previousReader.source === "sample") {
      const nextReader = buildFixtureReaderView({ chapterId: nextChapterId, sentenceIndex: 0 });
      await openingWorkflow.open(nextReader, 0, "playing");
      return;
    }

    await libraryApplication.open(previousReader.book.id, {
      chapterId: nextChapterId,
      sentenceIndex: 0,
      playbackStatus: "playing"
    });
  }

  const toggleActiveBookmark = navigationApplication.toggleActiveBookmark;
  const deleteBookmark = navigationApplication.deleteBookmark;
  const openBookmark = navigationApplication.openBookmark;
  const openLibrarySearchResult = navigationApplication.openLibrarySearchResult;
  const openReaderSearchResult = navigationApplication.openReaderSearchResult;

  const libraryCollectionModel = {
    get books() {
      return filteredBooks();
    },
    get totalBookCount() {
      return libraryBooks().length;
    },
    get bookListState() {
      return libraryBookListState();
    },
    get query() {
      return libraryQuery();
    },
    get filter() {
      return libraryFilter();
    },
    get importing() {
      return isImporting();
    },
    get notice() {
      return libraryNotice();
    },
    onQueryChange: setLibraryQuery,
    onFilterChange: setLibraryFilter,
    onImport: libraryApplication.importFromDialog,
    onOpenBook: libraryApplication.open,
    onRetryLibrary: libraryApplication.refresh,
    onOpenSample: openSampleReader
  } satisfies LibraryCollectionModel;

  const libraryRailModel = {
    get mode() {
      return libraryRailMode();
    },
    navigation: {
      collection: libraryCollectionModel,
      get activeView() {
        return activeView();
      },
      get activeBookId() {
        return reader().book.id;
      },
      get searching() {
        return isLibrarySearching();
      },
      get searchResults() {
        return librarySearchResults();
      },
      onOpenSearchResult: openLibrarySearchResult,
      onOpenView: openAppView,
      onOpenToolTab: setInspectorTab
    },
    focusedBook: {
      get book() {
        return reader().book;
      },
      get chapters() {
        return reader().chapters;
      },
      get activeChapterId() {
        return reader().chapter.id;
      },
      onOpenChapter: openChapter,
      onReturnToLibrary: () => openAppView("library")
    }
  } satisfies LibraryRailModel;

  const libraryWorkspaceModel = {
    collection: libraryCollectionModel,
    get dropActive() {
      return isLibraryDropTarget();
    },
    onDragEnter: () => setIsLibraryDropTarget(true),
    onDragLeave: () => setIsLibraryDropTarget(false),
    onDropFiles: libraryApplication.handleBrowserDrop
  } satisfies LibraryWorkspaceModel;

  const inspectorModel = {
    get tab() {
      return inspectorTab();
    },
    onTabChange: setInspectorTab,
    word: {
      get insight() {
        return activeWordInsight();
      },
      get savedWords() {
        return savedWords();
      },
      onSave: (insight) => void wordInsightWorkflow.save(insight),
      onForget: (surface) => void wordInsightWorkflow.forget(surface),
      onSelectSavedWord: selectSavedWord
    },
    search: {
      get query() {
        return readerSearchQuery();
      },
      get results() {
        return readerSearchResults();
      },
      onQueryChange: setReaderSearchQuery,
      onOpenResult: openReaderSearchResult,
      onInputReady(input) {
        readerSearchInput = input;
      }
    },
    bookmarks: {
      get bookmarks() {
        return currentBookBookmarks();
      },
      get activeBookmark() {
        return activeBookmark();
      },
      get activeSentence() {
        return activeSentence() ?? null;
      },
      get notice() {
        return bookmarkNotice();
      },
      onToggleActive: toggleActiveBookmark,
      onOpenBookmark: openBookmark,
      onDeleteBookmark: deleteBookmark
    },
    settings: {
      get audioSettings() {
        return audioSettings();
      },
      get voiceInstallation() {
        return voiceInstallation();
      },
      offlineLibrary: narrationService.capabilities.offlineLibrary,
      get narrationVoices() {
        return narrationVoices();
      },
      get offlineNarrationProfiles() {
        return offlineNarrationProfiles();
      },
      get readerContentFontSize() {
        return readerContentFontSize();
      },
      get readerContentFontFamily() {
        return readerContentFontFamily();
      },
      get uiFontFamily() {
        return uiFontFamily();
      },
      get narrationHighlightColor() {
        return narrationHighlightColor();
      },
      get bookmarkHighlightColor() {
        return bookmarkHighlightColor();
      },
      get systemFontFamilies() {
        return systemFontFamilies();
      },
      get audioCacheStats() {
        return audioCacheStats();
      },
      get audioCacheNotice() {
        return audioCacheNotice();
      },
      get exportNotice() {
        return exportNotice();
      },
      onAudioSettingsChange: updateAudioSettings,
      onInstallVoice: offlineNarrationApplication.requestSelectedVoice,
      onInstallNarrationProfile: offlineNarrationApplication.requestNarrationProfile,
      onRefreshEngines: offlineNarrationApplication.refreshNarrationFiles,
      onReaderContentFontSizeChange: updateReaderContentFontSize,
      onReaderContentFontFamilyChange: updateReaderContentFontFamily,
      onUiFontFamilyChange: updateUiFontFamily,
      onNarrationHighlightColorChange: updateNarrationHighlightColor,
      onBookmarkHighlightColorChange: updateBookmarkHighlightColor,
      onResetAudioSettings: narrationSettingsWorkflow.reset,
      onRefreshCache: offlineNarrationApplication.refreshPreparedAudio,
      onClearCache: offlineNarrationApplication.clearPreparedAudio,
      onExportBook: bookExportWorkflow.request
    }
  } satisfies ReaderInspectorModel;

  const readerContentInteractions = {
    isActiveSentence,
    isBookmarkedSentence: (sentenceId) => bookmarkedSentenceIds().has(sentenceId),
    isSearchHit: (sentenceId) => readerSearchHitIds().has(sentenceId),
    selectedWord,
    activeWordInsight,
    registerSentence(sentenceId, element) {
      sentenceElements.set(sentenceId, element);
    },
    unregisterSentence(sentenceId) {
      sentenceElements.delete(sentenceId);
    },
    selectSentence(sentenceIndex) {
      selectSentence(sentenceIndex);
      setInspectorTab("bookmarks");
    },
    selectWord,
    clearWord() {
      setSelectedWord(null);
    },
    saveWord(insight) {
      void wordInsightWorkflow.save(insight);
    }
  } satisfies ReaderContentInteractions;

  const subscriptions = [
    eventDispatcher.subscribe("ReaderOpened", (event) =>
      libraryApplication.refreshBookmarks(event.payload.bookId)
    ),
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
        "--inspector-rail-width": `${inspectorRailWidth()}px`,
        "--reader-font": cssFontFamilyStack(readerContentFontFamily(), defaultReaderFontStack),
        "--ui-font": cssFontFamilyStack(uiFontFamily(), defaultUiFontStack),
        "--narration-highlight": narrationHighlightColor(),
        "--narration-highlight-ink": readableInkForColor(narrationHighlightColor()),
        "--bookmark-highlight": bookmarkHighlightColor(),
        "--bookmark-highlight-ink": readableInkForColor(bookmarkHighlightColor())
      }}
    >
      <ProductBar
        showParagraphImageAction={activeView() === "reader"}
        canSaveParagraphImage={
          reader().paragraphs.length > 0 && paragraphImageNotice()?.tone !== "pending"
        }
        onSaveParagraphImage={paragraphImageWorkflow.request}
      />
      <LibraryRail model={libraryRailModel} />
      <SidebarResizeHandle
        sidebar="library"
        edge="right"
        width={libraryRailWidth()}
        defaultWidth={sidebarDefaultWidths.library}
        getBounds={() => getSidebarBounds("library")}
        onWidthChange={updateLibraryRailWidth}
      />

      <Show
        when={activeView() === "reader"}
        fallback={<LibraryWorkspace model={libraryWorkspaceModel} />}
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

          <ReaderContentProvider interactions={readerContentInteractions}>
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
          </ReaderContentProvider>
        </section>

        <ReaderInspector model={inspectorModel} />
        <SidebarResizeHandle
          sidebar="inspector"
          edge="left"
          width={inspectorRailWidth()}
          defaultWidth={sidebarDefaultWidths.inspector}
          getBounds={() => getSidebarBounds("inspector")}
          onWidthChange={updateInspectorRailWidth}
        />

        <Show
          when={narrationNotice()}
          fallback={
            <Show
              when={paragraphImageNotice()}
              fallback={
                <Show when={showNarrationPreparation()}>
                  <ReaderToast tone="pending" message="Getting the next part ready to play." />
                </Show>
              }
            >
              {(notice) => (
                <ReaderToast
                  title={notice().title}
                  tone={notice().tone}
                  message={notice().message}
                  onDismiss={() => setParagraphImageNotice(null)}
                />
              )}
            </Show>
          }
        >
          {(notice) => (
            <ReaderToast message={notice()} onDismiss={() => setNarrationNotice(null)} />
          )}
        </Show>

        <PlaybackRail
          bookTitle={reader().book.title}
          author={reader().book.author}
          coverImageSrc={reader().book.coverImageSrc}
          chapterTitle={reader().chapter.title}
          progress={readerProgress()}
          sentenceCount={reader().sentences.length}
          status={playback().status}
          bookmarked={activeBookmark() != null}
          volume={audioSettings().volume}
          onPrevious={() => moveSentence(-1)}
          onToggle={togglePlayback}
          onNext={() => moveSentence(1)}
          onToggleBookmark={() => void toggleActiveBookmark()}
          onVolumeChange={updateVolume}
          onToggleMute={toggleMute}
        />
      </Show>
    </main>
  );
}

function reportEventReactionFailure(error: unknown) {
  void reportAppError("events.reaction", error);
}
