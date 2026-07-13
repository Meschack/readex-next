import { createDomainEvent, type DomainEvent, type DomainEventDispatcher } from "@sonelle/domain";
import type { EventSink } from "@sonelle/storage";
import {
  failedEngineInstallation,
  type EngineInstallationRepository,
  type EngineInstallationState,
  type NarrationEngineId
} from "../audio/engine-installation-repository";

interface ReaderEngineInstallationWorkflowDependencies {
  eventDispatcher: DomainEventDispatcher;
  eventSink: EventSink;
  repository: EngineInstallationRepository;
  projectInstallation(state: EngineInstallationState): void;
  projectNotice(message: string | null): void;
  friendlyError(error: unknown): string;
}

export interface ReaderEngineInstallationWorkflow {
  request(engineId: NarrationEngineId): void;
  refresh(engineId: NarrationEngineId): Promise<void>;
  start(): Promise<() => void>;
}

export function createReaderEngineInstallationWorkflow(
  dependencies: ReaderEngineInstallationWorkflowDependencies
): ReaderEngineInstallationWorkflow {
  const statusRuns = new Map<NarrationEngineId, number>();

  const nextStatusRun = (engineId: NarrationEngineId) => {
    const runId = (statusRuns.get(engineId) ?? 0) + 1;
    statusRuns.set(engineId, runId);
    return runId;
  };

  const isCurrentRun = (engineId: NarrationEngineId, runId: number) =>
    statusRuns.get(engineId) === runId;

  const handleRequested = async (
    event: DomainEvent<"OfflineNarrationFilesInstallationRequested">
  ) => {
    const engineId = event.payload.engineId as NarrationEngineId;
    dependencies.projectInstallation(preparingEngineInstallation(engineId));
    dependencies.projectNotice(null);

    let installation: EngineInstallationState;
    try {
      installation = await dependencies.repository.install(engineId);
    } catch (error) {
      const reason = dependencies.friendlyError(error);
      dependencies.projectInstallation(failedEngineInstallation(engineId, reason));
      await dependencies.eventDispatcher.dispatch(
        createDomainEvent("OfflineNarrationFilesInstallationFailed", { engineId, reason })
      );
      return;
    }

    dependencies.projectInstallation(installation);
    await dependencies.eventDispatcher.dispatch(
      createDomainEvent("OfflineNarrationFilesInstallationReady", { engineId })
    );
  };

  return {
    request(engineId) {
      void dependencies.eventDispatcher
        .dispatch(createDomainEvent("OfflineNarrationFilesInstallationRequested", { engineId }))
        .catch(reportReactionFailure);
    },

    async refresh(engineId) {
      const runId = nextStatusRun(engineId);
      try {
        const installation = await dependencies.repository.getStatus(engineId);
        if (isCurrentRun(engineId, runId)) dependencies.projectInstallation(installation);
      } catch (error) {
        if (isCurrentRun(engineId, runId)) {
          dependencies.projectInstallation(
            failedEngineInstallation(engineId, dependencies.friendlyError(error))
          );
        }
      }
    },

    async start() {
      const subscriptions = [
        dependencies.eventDispatcher.subscribe(
          "OfflineNarrationFilesInstallationRequested",
          (event) => dependencies.eventSink.append(event)
        ),
        dependencies.eventDispatcher.subscribe(
          "OfflineNarrationFilesInstallationRequested",
          handleRequested
        ),
        dependencies.eventDispatcher.subscribe("OfflineNarrationFilesInstallationReady", (event) =>
          dependencies.eventSink.append(event)
        ),
        dependencies.eventDispatcher.subscribe("OfflineNarrationFilesInstallationReady", () => {
          dependencies.projectNotice(null);
        }),
        dependencies.eventDispatcher.subscribe("OfflineNarrationFilesInstallationFailed", (event) =>
          dependencies.eventSink.append(event)
        ),
        dependencies.eventDispatcher.subscribe("OfflineNarrationFilesInstallationFailed", (event) =>
          dependencies.projectNotice(event.payload.reason)
        )
      ];
      let unlisten: () => void;
      try {
        unlisten = await dependencies.repository.listen((installation) => {
          dependencies.projectInstallation(installation);
        });
      } catch (error) {
        subscriptions.forEach((unsubscribe) => unsubscribe());
        throw error;
      }

      return () => {
        statusRuns.clear();
        subscriptions.forEach((unsubscribe) => unsubscribe());
        unlisten();
      };
    }
  };
}

function preparingEngineInstallation(engineId: NarrationEngineId): EngineInstallationState {
  return {
    engineId,
    status: "preparing",
    downloadSizeBytes: 0,
    downloadedBytes: 0,
    progress: 0,
    message: "Preparing offline narration files"
  };
}

function reportReactionFailure(error: unknown) {
  if (import.meta.env.DEV) {
    console.error("[sonelle][events] Offline narration files reaction failed.", error);
  }
}
