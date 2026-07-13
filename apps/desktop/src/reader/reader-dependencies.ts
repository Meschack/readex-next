import {
  createDomainEventDispatcher,
  type AnyDomainEvent,
  type DomainEventDispatcher
} from "@sonelle/domain";
import {
  createNarrationSession as createManifestNarrationSession,
  createPrefetchingNarrationGateway,
  FakePassageNarrationAdapter,
  PiperCompatibilityAdapter,
  type NarrationRoutingMode,
  type NarrationSession,
  type NarrationPreparationAdapter,
  type PrefetchingNarrationGateway
} from "@sonelle/audio";
import type { EventSink } from "@sonelle/storage";
import {
  createAudioCacheRepository,
  type AudioCacheRepository
} from "../audio/audio-cache-repository";
import {
  createAudioSettingsRepository,
  type AudioSettingsRepository
} from "../audio/audio-settings-repository";
import { createHtmlAudioPlayer, type HtmlAudioPlayer } from "../audio/html-audio-player";
import { createHtmlManifestNarrationPlayer } from "../audio/html-manifest-narration-player";
import {
  createEngineInstallationRepository,
  type EngineInstallationRepository
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
  createBookRepository,
  listenForBookDrops,
  type BookDropEvent,
  type BookRepository
} from "../library/book-repository";
import {
  createReaderPreferencesRepository,
  type ReaderPreferencesRepository
} from "./reader-preferences-repository";
import { createDomainEventSink } from "./domain-event-sink";

export interface ReaderExperienceDependencies {
  audioCacheRepository: AudioCacheRepository;
  audioSettingsRepository: AudioSettingsRepository;
  bookRepository: BookRepository;
  dictionaryRepository: DictionaryRepository;
  engineInstallationRepository: EngineInstallationRepository;
  eventDispatcher: DomainEventDispatcher;
  eventSink: EventSink;
  htmlAudioPlayer: HtmlAudioPlayer;
  listenForBookDrops(onEvent: (event: BookDropEvent) => void): Promise<() => void>;
  narrationSessionFactory?: (onEvent: (event: AnyDomainEvent) => void) => NarrationSession;
  narrationSessionRoutingMode?: NarrationRoutingMode;
  narrationRepository: PrefetchingNarrationGateway;
  readerPreferencesRepository: ReaderPreferencesRepository;
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

  return {
    audioCacheRepository: createAudioCacheRepository(),
    audioSettingsRepository: createAudioSettingsRepository(),
    bookRepository: createBookRepository(),
    dictionaryRepository: createDictionaryRepository(),
    engineInstallationRepository: createEngineInstallationRepository(),
    eventDispatcher,
    eventSink: createDomainEventSink(),
    htmlAudioPlayer,
    listenForBookDrops,
    narrationRepository,
    narrationSessionFactory:
      narrationPreparationAdapter == null
        ? undefined
        : (onEvent) =>
            createManifestNarrationSession({
              adapter: narrationPreparationAdapter,
              player: createHtmlManifestNarrationPlayer(htmlAudioPlayer),
              onEvent
            }),
    narrationSessionRoutingMode,
    readerPreferencesRepository: createReaderPreferencesRepository(),
    voiceInstallationRepository: createVoiceInstallationRepository()
  };
}

export function resolveDevelopmentNarrationSessionRoutingMode(
  mode: unknown
): NarrationRoutingMode | undefined {
  return mode === "legacy-piper" || mode === "hybrid-v1" ? mode : undefined;
}

export function createNarrationPreparationAdapterForMode(
  routingMode: NarrationRoutingMode | undefined,
  narrationRepository: PrefetchingNarrationGateway,
  options: {
    nativeRuntime?: boolean;
    createNativeAdapter?: () => NarrationPreparationAdapter;
    createBrowserFallbackAdapter?: () => NarrationPreparationAdapter;
  } = {}
): NarrationPreparationAdapter | null {
  if (routingMode === "legacy-piper") return new PiperCompatibilityAdapter(narrationRepository);
  if (routingMode === "hybrid-v1") {
    const nativeRuntime = options.nativeRuntime ?? isTauriRuntime();
    if (nativeRuntime)
      return (options.createNativeAdapter ?? createNativeManifestNarrationAdapter)();
    return (options.createBrowserFallbackAdapter ?? (() => new FakePassageNarrationAdapter()))();
  }

  return null;
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
