import { createDomainEvent, type DomainEvent, type DomainEventDispatcher } from "@sonelle/domain";
import type {
  NarrationEngineId,
  NarrationPreparationAdapter,
  NarrationRoutingMode
} from "@sonelle/audio/narration";
import type { BookCatalog } from "../library/library-contracts";
import { createReaderNarrationPreparationRequests } from "./reader-narration";
import { buildReaderViewFromDocument } from "./reader-view";

const contextualLookaheadPassages = 3;
const resourceIntensiveLookaheadPassages = 2;

export interface UpcomingNarrationRequest {
  bookId: string;
  chapterId: string;
  nextChapterId: string;
  voiceId: string;
}

interface ReaderNarrationPrefetchWorkflowDependencies {
  adapter: NarrationPreparationAdapter;
  eventDispatcher: DomainEventDispatcher;
  repository: BookCatalog;
  routingMode: NarrationRoutingMode;
  engineInstallations(): Partial<Record<NarrationEngineId, { modelRevision: string }>>;
}

export interface ReaderNarrationPrefetchWorkflow {
  request(input: UpcomingNarrationRequest): void;
  reset(): void;
  start(): () => void;
}

export function createReaderNarrationPrefetchWorkflow(
  dependencies: ReaderNarrationPrefetchWorkflowDependencies
): ReaderNarrationPrefetchWorkflow {
  const requested = new Set<string>();
  let generation = 0;
  let controllers = new Set<AbortController>();

  const handleRequested = async (event: DomainEvent<"UpcomingNarrationPreparationRequested">) => {
    const run = generation;
    const key = requestKey(event.payload);
    try {
      const document = await dependencies.repository.open(
        event.payload.bookId,
        event.payload.nextChapterId
      );
      if (run !== generation) return;

      const reader = buildReaderViewFromDocument(document, {
        chapterId: event.payload.nextChapterId,
        sentenceIndex: 0
      });
      const requests = createReaderNarrationPreparationRequests(
        reader,
        event.payload.voiceId,
        dependencies.routingMode,
        dependencies.engineInstallations(),
        contextualLookaheadPassages
      );
      const selected =
        requests[0]?.engineId === "supertonic"
          ? requests.slice(0, resourceIntensiveLookaheadPassages)
          : requests;
      const controller = new AbortController();
      controllers.add(controller);
      try {
        await Promise.all(
          selected.map((request) => dependencies.adapter.prepare(request, controller.signal))
        );
      } finally {
        controllers.delete(controller);
      }
      if (run !== generation) return;

      await dependencies.eventDispatcher.dispatch(
        createDomainEvent("UpcomingNarrationPreparationReady", {
          bookId: event.payload.bookId,
          chapterId: event.payload.chapterId,
          nextChapterId: event.payload.nextChapterId,
          voiceId: event.payload.voiceId
        })
      );
    } catch (error) {
      if (run !== generation) return;
      requested.delete(key);
      await dependencies.eventDispatcher.dispatch(
        createDomainEvent("UpcomingNarrationPreparationFailed", {
          bookId: event.payload.bookId,
          chapterId: event.payload.chapterId,
          nextChapterId: event.payload.nextChapterId,
          voiceId: event.payload.voiceId,
          reason: error instanceof Error ? error.message : "Upcoming narration needs attention."
        })
      );
    }
  };

  const reset = () => {
    generation += 1;
    requested.clear();
    for (const controller of controllers) controller.abort();
    controllers = new Set();
  };

  return {
    request(input) {
      const key = requestKey(input);
      if (requested.has(key)) return;
      requested.add(key);
      void dependencies.eventDispatcher
        .dispatch(createDomainEvent("UpcomingNarrationPreparationRequested", input))
        .catch(() => requested.delete(key));
    },
    reset,
    start() {
      const subscriptions = [
        dependencies.eventDispatcher.subscribe(
          "UpcomingNarrationPreparationRequested",
          handleRequested
        )
      ];
      return () => {
        reset();
        subscriptions.forEach((unsubscribe) => unsubscribe());
      };
    }
  };
}

function requestKey(input: UpcomingNarrationRequest): string {
  return [input.bookId, input.chapterId, input.nextChapterId, input.voiceId].join(":");
}
