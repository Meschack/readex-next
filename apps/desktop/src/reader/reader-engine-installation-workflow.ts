import { createDomainEvent, type DomainEvent, type DomainEventDispatcher } from "@sonelle/domain";
import {
  failedEngineInstallation,
  type EngineInstallationRepository,
  type EngineInstallationState,
  type NarrationEngineId
} from "../audio/engine-installation-repository";
import { reportAppError } from "../platform/error-reporting";

interface ReaderEngineInstallationWorkflowDependencies {
  eventDispatcher: DomainEventDispatcher;
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
    try {
      await dependencies.repository.install(engineId);
    } catch (error) {
      const reason = dependencies.friendlyError(error);
      await dependencies.eventDispatcher.dispatch(
        createDomainEvent("OfflineNarrationFilesInstallationFailed", { engineId, reason })
      );
      return;
    }

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
          (event) => {
            const engineId = event.payload.engineId as NarrationEngineId;
            dependencies.projectInstallation(preparingEngineInstallation(engineId));
            dependencies.projectNotice(null);
          }
        ),
        dependencies.eventDispatcher.subscribe(
          "OfflineNarrationFilesInstallationRequested",
          handleRequested
        ),
        dependencies.eventDispatcher.subscribe(
          "OfflineNarrationFilesInstallationProgressed",
          (event) =>
            dependencies.projectInstallation({
              ...event.payload,
              engineId: event.payload.engineId as NarrationEngineId
            })
        ),
        dependencies.eventDispatcher.subscribe(
          "OfflineNarrationFilesInstallationReady",
          (event) => {
            dependencies.projectNotice(null);
            const engineId = event.payload.engineId as NarrationEngineId;
            return dependencies.repository
              .getStatus(engineId)
              .then(dependencies.projectInstallation);
          }
        ),
        dependencies.eventDispatcher.subscribe(
          "OfflineNarrationFilesInstallationFailed",
          (event) => {
            dependencies.projectInstallation(
              failedEngineInstallation(
                event.payload.engineId as NarrationEngineId,
                event.payload.reason
              )
            );
            dependencies.projectNotice(event.payload.reason);
          }
        )
      ];
      let unlisten: () => void;
      try {
        unlisten = await dependencies.repository.listen((installation) => {
          void dependencies.eventDispatcher
            .dispatch(
              createDomainEvent("OfflineNarrationFilesInstallationProgressed", {
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
    modelRevision: "",
    downloadSizeBytes: 0,
    downloadedBytes: 0,
    progress: 0,
    message: "Preparing offline narration files"
  };
}

function reportReactionFailure(error: unknown) {
  void reportAppError("events.offline-narration-reaction", error);
}
