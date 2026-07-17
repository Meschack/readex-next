import { createDomainEvent, type DomainEvent, type DomainEventDispatcher } from "@sonelle/domain";
import {
  failedVoiceInstallation,
  type VoiceInstallationRepository,
  type VoiceInstallationState
} from "../audio/voice-installation-repository";
import { reportAppError } from "../platform/error-reporting";

interface ReaderVoiceInstallationWorkflowDependencies {
  eventDispatcher: DomainEventDispatcher;
  repository: VoiceInstallationRepository;
  selectedVoiceId(): string;
  projectInstallation(state: VoiceInstallationState): void;
  projectNotice(message: string | null): void;
  friendlyError(error: unknown): string;
}

export interface ReaderVoiceInstallationWorkflow {
  request(voiceId: string): void;
  refresh(voiceId: string): Promise<void>;
  start(): Promise<() => void>;
}

export function createReaderVoiceInstallationWorkflow(
  dependencies: ReaderVoiceInstallationWorkflowDependencies
): ReaderVoiceInstallationWorkflow {
  let statusRun = 0;

  const isSelected = (voiceId: string) => voiceId === dependencies.selectedVoiceId();

  const handleRequested = async (event: DomainEvent<"VoiceInstallationRequested">) => {
    const { voiceId } = event.payload;
    try {
      await dependencies.repository.install(voiceId);
    } catch (error) {
      const reason = dependencies.friendlyError(error);
      await dependencies.eventDispatcher.dispatch(
        createDomainEvent("VoiceInstallationFailed", { voiceId, reason })
      );
      return;
    }

    await dependencies.eventDispatcher.dispatch(
      createDomainEvent("VoiceInstallationReady", { voiceId })
    );
  };

  return {
    request(voiceId) {
      void dependencies.eventDispatcher
        .dispatch(createDomainEvent("VoiceInstallationRequested", { voiceId }))
        .catch(reportReactionFailure);
    },

    async refresh(voiceId) {
      const runId = ++statusRun;
      try {
        const installation = await dependencies.repository.getStatus(voiceId);
        if (runId === statusRun && isSelected(voiceId)) {
          dependencies.projectInstallation(installation);
        }
      } catch (error) {
        if (runId === statusRun && isSelected(voiceId)) {
          dependencies.projectInstallation(
            failedVoiceInstallation(voiceId, dependencies.friendlyError(error))
          );
        }
      }
    },

    async start() {
      const subscriptions = [
        dependencies.eventDispatcher.subscribe("VoiceInstallationRequested", (event) => {
          if (!isSelected(event.payload.voiceId)) return;
          dependencies.projectInstallation(preparingVoiceInstallation(event.payload.voiceId));
          dependencies.projectNotice(null);
        }),
        dependencies.eventDispatcher.subscribe("VoiceInstallationRequested", handleRequested),
        dependencies.eventDispatcher.subscribe("VoiceInstallationProgressed", (event) => {
          if (isSelected(event.payload.voiceId)) {
            dependencies.projectInstallation(event.payload);
          }
        }),
        dependencies.eventDispatcher.subscribe("VoiceInstallationReady", (event) => {
          dependencies.projectNotice(null);
          return dependencies.repository.getStatus(event.payload.voiceId).then((installation) => {
            if (isSelected(event.payload.voiceId)) dependencies.projectInstallation(installation);
          });
        }),
        dependencies.eventDispatcher.subscribe("VoiceInstallationFailed", (event) => {
          if (isSelected(event.payload.voiceId)) {
            dependencies.projectInstallation(
              failedVoiceInstallation(event.payload.voiceId, event.payload.reason)
            );
          }
          dependencies.projectNotice(event.payload.reason);
        })
      ];
      let unlisten: () => void;
      try {
        unlisten = await dependencies.repository.listen((installation) => {
          void dependencies.eventDispatcher
            .dispatch(
              createDomainEvent("VoiceInstallationProgressed", {
                ...installation,
                status: installation.status === "ready" ? "ready" : "preparing"
              })
            )
            .catch(reportReactionFailure);
        });
      } catch (error) {
        subscriptions.forEach((unsubscribe) => unsubscribe());
        throw error;
      }

      return () => {
        statusRun += 1;
        subscriptions.forEach((unsubscribe) => unsubscribe());
        unlisten();
      };
    }
  };
}

function preparingVoiceInstallation(voiceId: string): VoiceInstallationState {
  return {
    voiceId,
    status: "preparing",
    downloadSizeBytes: 0,
    downloadedBytes: 0,
    progress: 0,
    message: "Preparing this voice"
  };
}

function reportReactionFailure(error: unknown) {
  void reportAppError("events.voice-installation-reaction", error);
}
