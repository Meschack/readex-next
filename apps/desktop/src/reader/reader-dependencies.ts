import { createDomainEventDispatcher, type DomainEventDispatcher } from "@sonelle/domain";
import {
  activateAudioSettingsForLanguage,
  activateHybridAudioSettingsForLanguage,
  hybridNarrationVoicesForLanguage,
  SUPPORTED_NARRATION_VOICES,
  type AudioSettings,
  type NarrationVoice
} from "@sonelle/audio";
import {
  createNarrationSession as createManifestNarrationSession,
  type NarrationRoutingMode,
  type NarrationPreparationAdapter
} from "@sonelle/audio/narration";
import {
  createPrefetchingNarrationGateway,
  PiperCompatibilityAdapter,
  type PrefetchingNarrationGateway
} from "@sonelle/audio/compatibility";
import {
  createAudioCacheRepository,
  type AudioCacheRepository
} from "../audio/audio-cache-repository";
import {
  createAudioSettingsRepository,
  type AudioSettingsRepository
} from "../audio/audio-settings-repository";
import { createHtmlAudioPlayer } from "../audio/html-audio-player";
import { createHtmlManifestNarrationPlayer } from "../audio/html-manifest-narration-player";
import { reportAppError } from "../platform/error-reporting";
import {
  createEngineInstallationRepository,
  type EngineInstallationRepository,
  type EngineInstallationState,
  type NarrationEngineId
} from "../audio/engine-installation-repository";
import { createNativeManifestNarrationAdapter } from "../audio/native-manifest-narration-adapter";
import { createNarrationRepository } from "../audio/narration-repository";
import {
  createVoiceInstallationRepository,
  type VoiceInstallationRepository
} from "../audio/voice-installation-repository";
import {
  createDictionaryRepository,
  type DictionaryRepository
} from "../learning/dictionary-repository";
import {
  type BookCatalog,
  type BookDropAdapter,
  type BookOpenRequestAdapter,
  type BookExporter,
  type BookImporter,
  type BookmarkStore,
  type LibrarySearch,
  type ReadingPositionStore
} from "../library/library-contracts";
import { createBookCatalog } from "../library/book-catalog";
import { createBookDropAdapter } from "../library/book-drop-adapter";
import { createBookOpenRequestAdapter } from "../library/book-open-request-adapter";
import { createBookExporter } from "../library/book-exporter";
import { createBookImporter } from "../library/book-importer";
import { createBookmarkStore } from "../library/bookmark-store";
import { createLibrarySearch } from "../library/library-search";
import { createReadingPositionStore } from "../library/reading-position-store";
import { isTauriRuntime } from "../platform/tauri-runtime";
import { createSystemFontCatalog, type SystemFontCatalog } from "../platform/system-font-catalog";
import {
  createParagraphImageExporter,
  type ParagraphImageExporter
} from "./reader-paragraph-image";
import {
  createReaderPreferencesRepository,
  type ReaderPreferencesRepository
} from "./reader-preferences-repository";
import {
  createReaderNarrationWorkflow,
  type ReaderNarrationWorkflow,
  type ReaderNarrationWorkflowOptions
} from "./reader-narration-workflow";
import { createReaderNarrationPrefetchWorkflow } from "./reader-narration-prefetch-workflow";

export interface ReaderNarrationService {
  capabilities: {
    offlineLibrary: "individual-voice" | "language-pack";
    preparesAcrossChapters: boolean;
  };
  activateSettings(settings: AudioSettings, language: string | null): AudioSettings;
  voices(language: string | null): readonly NarrationVoice[];
  observeEngineInstallation(installation: EngineInstallationState): void;
  createWorkflow(
    options: Omit<ReaderNarrationWorkflowOptions, "engineInstallations">
  ): ReaderNarrationWorkflow;
}

export interface ReaderExperienceDependencies {
  audioCacheRepository: AudioCacheRepository;
  audioSettingsRepository: AudioSettingsRepository;
  bookCatalog: BookCatalog;
  bookDropAdapter: BookDropAdapter;
  bookOpenRequestAdapter: BookOpenRequestAdapter;
  bookExporter: BookExporter;
  bookImporter: BookImporter;
  bookmarkStore: BookmarkStore;
  dictionaryRepository: DictionaryRepository;
  engineInstallationRepository: EngineInstallationRepository;
  eventDispatcher: DomainEventDispatcher;
  fontCatalog: SystemFontCatalog;
  librarySearch: LibrarySearch;
  narration: ReaderNarrationService;
  paragraphImageExporter: ParagraphImageExporter;
  readerPreferencesRepository: ReaderPreferencesRepository;
  readingPositionStore: ReadingPositionStore;
  voiceInstallationRepository: VoiceInstallationRepository;
}

export function createReaderExperienceDependencies(): ReaderExperienceDependencies {
  const eventDispatcher = createDomainEventDispatcher();
  const htmlAudioPlayer = createHtmlAudioPlayer();
  const narrationRepository = createPrefetchingNarrationGateway(createNarrationRepository());
  const narrationSessionRoutingMode = resolveDevelopmentNarrationSessionRoutingMode(
    import.meta.env.VITE_SONELLE_NARRATION_SESSION
  );
  const narrationPreparationAdapter = createNarrationPreparationAdapterForMode(
    narrationSessionRoutingMode,
    narrationRepository
  );
  const bookCatalog = createBookCatalog();
  const usesLanguagePacks = narrationSessionRoutingMode === "hybrid-v1";
  const engineInstallations: Partial<Record<NarrationEngineId, EngineInstallationState>> = {};

  return {
    audioCacheRepository: createAudioCacheRepository(),
    audioSettingsRepository: createAudioSettingsRepository(),
    bookCatalog,
    bookDropAdapter: createBookDropAdapter(),
    bookOpenRequestAdapter: createBookOpenRequestAdapter({
      reportError: (error) => void reportAppError("book-open-request.delivery", error)
    }),
    bookExporter: createBookExporter(),
    bookImporter: createBookImporter(),
    bookmarkStore: createBookmarkStore(),
    dictionaryRepository: createDictionaryRepository(),
    engineInstallationRepository: createEngineInstallationRepository(),
    eventDispatcher,
    fontCatalog: createSystemFontCatalog(),
    librarySearch: createLibrarySearch(),
    narration: {
      capabilities: {
        offlineLibrary: usesLanguagePacks ? "language-pack" : "individual-voice",
        preparesAcrossChapters: usesLanguagePacks
      },
      activateSettings(settings, language) {
        return usesLanguagePacks
          ? activateHybridAudioSettingsForLanguage(settings, language)
          : activateAudioSettingsForLanguage(settings, language);
      },
      voices(language) {
        return usesLanguagePacks
          ? availableHybridNarrationVoicesForLanguage(language, engineInstallations)
          : SUPPORTED_NARRATION_VOICES;
      },
      observeEngineInstallation(installation) {
        engineInstallations[installation.engineId] = installation;
      },
      createWorkflow(options) {
        const session = createManifestNarrationSession({
          adapter: narrationPreparationAdapter,
          player: createHtmlManifestNarrationPlayer(htmlAudioPlayer),
          eventDispatcher,
          onEventError: reportEventFailure,
          onError: (error) => options.reportError(error, "playback", "unknown")
        });
        const prefetchWorkflow = createReaderNarrationPrefetchWorkflow({
          adapter: narrationPreparationAdapter,
          eventDispatcher,
          repository: bookCatalog,
          routingMode: narrationSessionRoutingMode,
          engineInstallations: () => engineInstallations
        });
        return createReaderNarrationWorkflow(
          {
            eventDispatcher,
            prefetchWorkflow,
            routingMode: narrationSessionRoutingMode,
            session
          },
          { ...options, engineInstallations: () => engineInstallations }
        );
      }
    },
    paragraphImageExporter: createParagraphImageExporter(),
    readerPreferencesRepository: createReaderPreferencesRepository(),
    readingPositionStore: createReadingPositionStore(),
    voiceInstallationRepository: createVoiceInstallationRepository()
  };
}

export function availableHybridNarrationVoicesForLanguage(
  language: string | null,
  installations: Partial<Record<NarrationEngineId, EngineInstallationState>>
): readonly NarrationVoice[] {
  const voices = hybridNarrationVoicesForLanguage(language);
  const engineId = voices[0]?.id.split(":", 1)[0] as NarrationEngineId | undefined;
  return engineId != null && installations[engineId]?.status === "ready" ? voices : [];
}

export function resolveDevelopmentNarrationSessionRoutingMode(mode: unknown): NarrationRoutingMode {
  return mode === "legacy-piper" ? mode : "hybrid-v1";
}

export function createNarrationPreparationAdapterForMode(
  routingMode: NarrationRoutingMode,
  narrationRepository: PrefetchingNarrationGateway,
  options: {
    nativeRuntime?: boolean;
    createNativeAdapter?: () => NarrationPreparationAdapter;
    createBrowserFallbackAdapter?: () => NarrationPreparationAdapter;
  } = {}
): NarrationPreparationAdapter {
  if (routingMode === "legacy-piper") return new PiperCompatibilityAdapter(narrationRepository);
  if (routingMode === "hybrid-v1") {
    const nativeRuntime = options.nativeRuntime ?? isTauriRuntime();
    if (nativeRuntime)
      return (options.createNativeAdapter ?? createNativeManifestNarrationAdapter)();
    return options.createBrowserFallbackAdapter?.() ?? unavailableNarrationPreparationAdapter;
  }
  return unavailableNarrationPreparationAdapter;
}

const unavailableNarrationPreparationAdapter: NarrationPreparationAdapter = {
  async prepare() {
    throw new Error("Narration is available in the desktop app.");
  }
};

function reportEventFailure(error: unknown) {
  void reportAppError("events.narration-reaction", error);
}
