import { createDomainEvent, type DomainEvent, type DomainEventDispatcher } from "@sonelle/domain";
import type { EventSink } from "@sonelle/storage";
import {
  failedVoiceInstallation,
  type VoiceInstallationRepository,
  type VoiceInstallationState
} from "../audio/voice-installation-repository";

interface ReaderVoiceInstallationWorkflowDependencies {
  eventDispatcher: DomainEventDispatcher;
  eventSink: EventSink;
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
    if (isSelected(voiceId)) {
      dependencies.projectInstallation(preparingVoiceInstallation(voiceId));
      dependencies.projectNotice(null);
    }

    let installation: VoiceInstallationState;
    try {
      installation = await dependencies.repository.install(voiceId);
    } catch (error) {
      const reason = dependencies.friendlyError(error);
      if (isSelected(voiceId)) {
        dependencies.projectInstallation(failedVoiceInstallation(voiceId, reason));
      }
      await dependencies.eventDispatcher.dispatch(
        createDomainEvent("VoiceInstallationFailed", { voiceId, reason })
      );
      return;
    }

    if (isSelected(voiceId)) dependencies.projectInstallation(installation);
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
        dependencies.eventDispatcher.subscribe("VoiceInstallationRequested", (event) =>
          dependencies.eventSink.append(event)
        ),
        dependencies.eventDispatcher.subscribe("VoiceInstallationRequested", handleRequested),
        dependencies.eventDispatcher.subscribe("VoiceInstallationReady", (event) =>
          dependencies.eventSink.append(event)
        ),
        dependencies.eventDispatcher.subscribe("VoiceInstallationReady", () => {
          dependencies.projectNotice(null);
        }),
        dependencies.eventDispatcher.subscribe("VoiceInstallationFailed", (event) =>
          dependencies.eventSink.append(event)
        ),
        dependencies.eventDispatcher.subscribe("VoiceInstallationFailed", (event) => {
          dependencies.projectNotice(event.payload.reason);
        })
      ];
      let unlisten: () => void;
      try {
        unlisten = await dependencies.repository.listen((installation) => {
          if (isSelected(installation.voiceId)) {
            dependencies.projectInstallation(installation);
          }
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
  if (import.meta.env.DEV) {
    console.error("[sonelle][events] Voice installation reaction failed.", error);
  }
}
