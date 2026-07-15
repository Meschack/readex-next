import { createDomainEvent, type DomainEvent, type DomainEventDispatcher } from "@sonelle/domain";
import { routeNarrationEngine } from "@sonelle/audio/narration";
import type { EventSink } from "@sonelle/storage";
import type { AudioCacheRepository, AudioCacheStatsDto } from "../audio/audio-cache-repository";
import type {
  EngineInstallationRepository,
  EngineInstallationState,
  NarrationEngineId
} from "../audio/engine-installation-repository";
import type {
  VoiceInstallationRepository,
  VoiceInstallationState
} from "../audio/voice-installation-repository";
import { createReaderEngineInstallationWorkflow } from "./reader-engine-installation-workflow";
import type { ReaderNarrationWorkflow } from "./reader-narration-workflow";
import { createReaderVoiceInstallationWorkflow } from "./reader-voice-installation-workflow";

const narrationEngineIds: readonly NarrationEngineId[] = ["kokoro", "supertonic"];

export type OfflineNarrationProfileId = "english" | "multilingual";
export type OfflineNarrationReadiness = "not-installed" | "preparing" | "ready" | "failed";

export interface OfflineNarrationProfileView {
  id: OfflineNarrationProfileId;
  label: string;
  description: string;
  status: OfflineNarrationReadiness;
  modelRevision: string;
  downloadSizeBytes: number;
  downloadedBytes: number;
  progress: number | null;
  message: string;
}

export interface OfflineVoiceView {
  voiceId: string;
  status: OfflineNarrationReadiness;
  downloadSizeBytes: number;
  downloadedBytes: number;
  progress: number | null;
  message: string;
}

export interface PreparedAudioView {
  sentenceCount: number;
  sizeBytes: number;
}

const offlineNarrationProfiles: Readonly<
  Record<
    OfflineNarrationProfileId,
    { engineId: NarrationEngineId; label: string; description: string }
  >
> = {
  english: {
    engineId: "kokoro",
    label: "English narration",
    description: "Best voice quality for English books"
  },
  multilingual: {
    engineId: "supertonic",
    label: "Multilingual narration",
    description: "Fallback voices for non-English books"
  }
};

interface ReaderOfflineNarrationDependencies {
  audioCache: AudioCacheRepository;
  engineInstallations: EngineInstallationRepository;
  eventDispatcher: DomainEventDispatcher;
  eventSink: EventSink;
  narration: ReaderNarrationWorkflow;
  offlineLibrary: "individual-voice" | "language-pack";
  voiceInstallations: VoiceInstallationRepository;
  friendlyError(error: unknown): string;
}

interface ReaderOfflineNarrationOptions {
  currentBookId(): string;
  selectedVoiceId(): string;
  projectAudioCache(stats: AudioCacheStatsDto): void;
  projectAudioCacheNotice(message: string | null): void;
  projectEngineInstallation(state: EngineInstallationState): void;
  projectNarrationProfile(profile: OfflineNarrationProfileView): void;
  projectNarrationNotice(message: string | null): void;
  projectVoiceInstallation(state: VoiceInstallationState): void;
}

export interface ReaderOfflineNarrationApplication {
  start(): Promise<() => void>;
  requestSelectedVoice(): void;
  requestNarrationProfile(profileId: OfflineNarrationProfileId): void;
  refreshNarrationFiles(): Promise<void>;
  refreshPreparedAudio(): Promise<void>;
  clearPreparedAudio(): void;
}

export function createReaderOfflineNarrationApplication(
  dependencies: ReaderOfflineNarrationDependencies,
  options: ReaderOfflineNarrationOptions
): ReaderOfflineNarrationApplication {
  const voiceWorkflow = createReaderVoiceInstallationWorkflow({
    eventDispatcher: dependencies.eventDispatcher,
    eventSink: dependencies.eventSink,
    repository: dependencies.voiceInstallations,
    selectedVoiceId: options.selectedVoiceId,
    projectInstallation: options.projectVoiceInstallation,
    projectNotice: options.projectNarrationNotice,
    friendlyError: dependencies.friendlyError
  });
  const engineWorkflow = createReaderEngineInstallationWorkflow({
    eventDispatcher: dependencies.eventDispatcher,
    eventSink: dependencies.eventSink,
    repository: dependencies.engineInstallations,
    projectInstallation: (installation) => {
      options.projectEngineInstallation(installation);
      options.projectNarrationProfile(projectOfflineNarrationProfile(installation));
    },
    projectNotice: options.projectNarrationNotice,
    friendlyError: dependencies.friendlyError
  });

  const refreshPreparedAudio = async (bookId = options.currentBookId()) => {
    try {
      const stats = await dependencies.audioCache.getStats(bookId);
      if (bookId === options.currentBookId()) {
        options.projectAudioCache(stats);
      }
    } catch (error) {
      options.projectAudioCacheNotice(dependencies.friendlyError(error));
    }
  };

  const refreshNarrationFiles = () =>
    Promise.all(narrationEngineIds.map((engineId) => engineWorkflow.refresh(engineId))).then(
      () => undefined
    );

  const handleClearRequested = async (event: DomainEvent<"PreparedNarrationClearingRequested">) => {
    try {
      await dependencies.narration.reset();
      const stats = await dependencies.audioCache.clear(event.payload.bookId);
      await dependencies.eventDispatcher.dispatch(
        createDomainEvent("PreparedNarrationCleared", { bookId: event.payload.bookId, ...stats })
      );
    } catch (error) {
      await dependencies.eventDispatcher.dispatch(
        createDomainEvent("PreparedNarrationClearingFailed", {
          bookId: event.payload.bookId,
          reason: dependencies.friendlyError(error)
        })
      );
    }
  };

  return {
    async start() {
      const subscriptions = [
        dependencies.eventDispatcher.subscribe("NarrationSettingsChanged", (event) => {
          if (dependencies.offlineLibrary === "individual-voice") {
            return voiceWorkflow.refresh(event.payload.settings.voiceId);
          }
        }),
        dependencies.eventDispatcher.subscribe("PreparedNarrationClearingRequested", (event) =>
          dependencies.eventSink.append(event)
        ),
        dependencies.eventDispatcher.subscribe(
          "PreparedNarrationClearingRequested",
          handleClearRequested
        ),
        dependencies.eventDispatcher.subscribe("PreparedNarrationCleared", (event) =>
          dependencies.eventSink.append(event)
        ),
        dependencies.eventDispatcher.subscribe("PreparedNarrationCleared", (event) => {
          if (event.payload.bookId === options.currentBookId()) {
            options.projectAudioCache(event.payload);
            options.projectAudioCacheNotice("Prepared audio cleared for this book.");
          }
        }),
        dependencies.eventDispatcher.subscribe("PreparedNarrationClearingFailed", (event) =>
          dependencies.eventSink.append(event)
        ),
        dependencies.eventDispatcher.subscribe("PreparedNarrationClearingFailed", (event) => {
          if (event.payload.bookId === options.currentBookId()) {
            options.projectAudioCacheNotice(event.payload.reason);
          }
        }),
        dependencies.eventDispatcher.subscribe("ReaderOpened", (event) => {
          void refreshPreparedAudio(event.payload.bookId);
        })
      ];
      await refreshPreparedAudio();
      try {
        if (dependencies.offlineLibrary === "individual-voice") {
          const stop = await voiceWorkflow.start();
          await voiceWorkflow.refresh(options.selectedVoiceId());
          return () => {
            stop();
            subscriptions.forEach((unsubscribe) => unsubscribe());
          };
        }

        const stop = await engineWorkflow.start();
        await refreshNarrationFiles();
        return () => {
          stop();
          subscriptions.forEach((unsubscribe) => unsubscribe());
        };
      } catch (error) {
        subscriptions.forEach((unsubscribe) => unsubscribe());
        options.projectNarrationNotice(dependencies.friendlyError(error));
        return () => undefined;
      }
    },
    requestSelectedVoice() {
      voiceWorkflow.request(options.selectedVoiceId());
    },
    requestNarrationProfile(profileId) {
      engineWorkflow.request(offlineNarrationProfiles[profileId].engineId);
    },
    refreshNarrationFiles,
    refreshPreparedAudio,
    clearPreparedAudio() {
      void dependencies.eventDispatcher
        .dispatch(
          createDomainEvent("PreparedNarrationClearingRequested", {
            bookId: options.currentBookId()
          })
        )
        .catch((error) => options.projectAudioCacheNotice(dependencies.friendlyError(error)));
    }
  };
}

export function createCheckingOfflineNarrationProfiles(): Record<
  OfflineNarrationProfileId,
  OfflineNarrationProfileView
> {
  return {
    english: checkingOfflineNarrationProfile("english"),
    multilingual: checkingOfflineNarrationProfile("multilingual")
  };
}

export function offlineNarrationReadinessMessage(
  profiles: Readonly<Record<OfflineNarrationProfileId, OfflineNarrationProfileView>>,
  language: string | null
): string | null {
  const engineId = routeNarrationEngine(language, { mode: "hybrid-v1" }).engineId;
  const profile = profiles[engineId === "kokoro" ? "english" : "multilingual"];
  if (profile.status === "ready") return null;

  if (profile.status === "preparing") {
    return `${profile.label} is still being prepared.`;
  }
  if (profile.status === "failed") {
    return `${profile.label} needs attention. Retry the download.`;
  }
  return `Download ${profile.label} to listen offline.`;
}

function checkingOfflineNarrationProfile(
  profileId: OfflineNarrationProfileId
): OfflineNarrationProfileView {
  const profile = offlineNarrationProfiles[profileId];
  return {
    id: profileId,
    label: profile.label,
    description: profile.description,
    status: "preparing",
    modelRevision: "",
    downloadSizeBytes: 0,
    downloadedBytes: 0,
    progress: null,
    message: "Checking offline narration files"
  };
}

function projectOfflineNarrationProfile(
  installation: EngineInstallationState
): OfflineNarrationProfileView {
  const id = installation.engineId === "kokoro" ? "english" : "multilingual";
  const profile = offlineNarrationProfiles[id];
  return {
    id,
    label: profile.label,
    description: profile.description,
    status: installation.status,
    modelRevision: installation.modelRevision,
    downloadSizeBytes: installation.downloadSizeBytes,
    downloadedBytes: installation.downloadedBytes,
    progress: installation.progress,
    message: installation.message
  };
}
