import type {
  NarrationEngineId,
  NarrationRoutingMode,
  NarrationSession
} from "@sonelle/audio/narration";
import type { AudioSettings } from "@sonelle/audio";
import { createDomainEvent, type DomainEvent, type DomainEventDispatcher } from "@sonelle/domain";
import type { ReaderView } from "./reader-view";
import { createReaderNarrationSessionChapter } from "./reader-narration";
import type {
  ReaderNarrationPrefetchWorkflow,
  UpcomingNarrationRequest
} from "./reader-narration-prefetch-workflow";

export type ReaderNarrationProjectionEvent =
  | DomainEvent<"NarrationSentenceEntered">
  | DomainEvent<"NarrationPlaybackPaused">
  | DomainEvent<"NarrationPlaybackEnded">
  | DomainEvent<"NarrationPlaybackFailed">;

export interface ReaderNarrationWorkflowOptions {
  currentReader(): ReaderView;
  currentSettings(): AudioSettings;
  engineInstallations(): Partial<Record<NarrationEngineId, { modelRevision: string }>>;
  projectPlayback(event: ReaderNarrationProjectionEvent): void;
  projectPreparing(preparing: boolean): void;
  projectAudible(audible: boolean): void;
  projectNotice(message: string | null): void;
  reportError(error: unknown, stage: "playback" | "prefetch", sentenceId: string): void;
}

interface ReaderNarrationWorkflowDependencies {
  eventDispatcher: DomainEventDispatcher;
  prefetchWorkflow: ReaderNarrationPrefetchWorkflow;
  routingMode: NarrationRoutingMode;
  session: NarrationSession;
}

export interface ReaderNarrationWorkflow {
  requestPlayback(sentenceId: string): void;
  pause(): Promise<void>;
  setOutput(settings: AudioSettings): void;
  prefetchUpcoming(input: UpcomingNarrationRequest): void;
  reset(): Promise<void>;
  start(): () => void;
}

export function createReaderNarrationWorkflow(
  dependencies: ReaderNarrationWorkflowDependencies,
  options: ReaderNarrationWorkflowOptions
): ReaderNarrationWorkflow {
  const publish = async (event: Parameters<DomainEventDispatcher["dispatch"]>[0]) => {
    try {
      await dependencies.eventDispatcher.dispatch(event);
    } catch (error) {
      reportErrorSafely(options, error, "playback", "unknown");
    }
  };

  const handlePlaybackRequested = async (event: DomainEvent<"NarrationPlaybackRequested">) => {
    const reader = options.currentReader();
    if (reader.book.id !== event.payload.bookId || reader.chapter.id !== event.payload.chapterId) {
      return;
    }
    const sentence = reader.sentences.find(
      (candidate) => candidate.id === event.payload.sentenceId
    );
    if (sentence == null) return;

    dependencies.session.open(
      createReaderNarrationSessionChapter(
        reader,
        event.payload.voiceId,
        dependencies.routingMode,
        options.engineInstallations()
      )
    );
    dependencies.session.setOutput(options.currentSettings());
    try {
      await dependencies.session.play(sentence.id);
    } catch (error) {
      reportErrorSafely(options, error, "playback", sentence.id);
      await publish(
        createDomainEvent("NarrationPlaybackFailed", {
          bookId: reader.book.id,
          chapterId: reader.chapter.id,
          passageId: `${reader.chapter.id}:unavailable-passage`,
          sentenceId: sentence.id,
          reason: "Narration needs attention. Please try again."
        })
      );
    }
  };

  return {
    requestPlayback(sentenceId) {
      const reader = options.currentReader();
      void publish(
        createDomainEvent("NarrationPlaybackRequested", {
          bookId: reader.book.id,
          chapterId: reader.chapter.id,
          sentenceId,
          voiceId: options.currentSettings().voiceId
        })
      );
    },
    pause() {
      return dependencies.session.pause();
    },
    setOutput(settings) {
      dependencies.session.setOutput(settings);
    },
    prefetchUpcoming(input) {
      dependencies.prefetchWorkflow.request(input);
    },
    reset() {
      const reader = options.currentReader();
      return publish(
        createDomainEvent("NarrationResetRequested", {
          bookId: reader.book.id,
          chapterId: reader.chapter.id
        })
      );
    },
    start() {
      const stopPrefetch = dependencies.prefetchWorkflow.start();
      const subscriptions = [
        dependencies.eventDispatcher.subscribe("NarrationPlaybackRequested", () => {
          options.projectNotice(null);
        }),
        dependencies.eventDispatcher.subscribe(
          "NarrationPlaybackRequested",
          handlePlaybackRequested
        ),
        dependencies.eventDispatcher.subscribe("NarrationPreparationStarted", (event) => {
          const reader = options.currentReader();
          if (
            reader.book.id === event.payload.bookId &&
            reader.chapter.id === event.payload.chapterId
          ) {
            options.projectPreparing(true);
          }
        }),
        dependencies.eventDispatcher.subscribe("PassageNarrationReady", () =>
          options.projectPreparing(false)
        ),
        dependencies.eventDispatcher.subscribe("NarrationSentenceEntered", (event) => {
          options.projectPreparing(false);
          options.projectAudible(true);
          options.projectPlayback(event);
        }),
        dependencies.eventDispatcher.subscribe("PassageNarrationPlaybackEnded", () => {
          options.projectPreparing(false);
          options.projectAudible(false);
        }),
        dependencies.eventDispatcher.subscribe("NarrationPlaybackPaused", (event) => {
          options.projectPreparing(false);
          options.projectAudible(false);
          options.projectPlayback(event);
        }),
        dependencies.eventDispatcher.subscribe("NarrationPlaybackEnded", (event) => {
          options.projectPreparing(false);
          options.projectAudible(false);
          options.projectPlayback(event);
        }),
        dependencies.eventDispatcher.subscribe("NarrationPlaybackFailed", (event) => {
          options.projectPreparing(false);
          options.projectAudible(false);
          options.projectPlayback(event);
        }),
        dependencies.eventDispatcher.subscribe("NarrationResetRequested", () => {
          dependencies.prefetchWorkflow.reset();
        }),
        dependencies.eventDispatcher.subscribe("NarrationResetRequested", () => {
          dependencies.session.close();
        }),
        dependencies.eventDispatcher.subscribe("NarrationResetRequested", () => {
          options.projectAudible(false);
        }),
        dependencies.eventDispatcher.subscribe("NarrationResetRequested", () => {
          options.projectPreparing(false);
        }),
        dependencies.eventDispatcher.subscribe("UpcomingNarrationPreparationFailed", (event) => {
          reportErrorSafely(
            options,
            event.payload.reason,
            "prefetch",
            `${event.payload.nextChapterId}:sentence-1`
          );
        })
      ];

      return () => {
        dependencies.session.close();
        stopPrefetch();
        subscriptions.forEach((unsubscribe) => unsubscribe());
      };
    }
  };
}

function reportErrorSafely(
  options: ReaderNarrationWorkflowOptions,
  error: unknown,
  stage: "playback" | "prefetch",
  sentenceId: string
) {
  try {
    options.reportError(error, stage, sentenceId);
  } catch {
    // Development diagnostics must not alter reader behavior.
  }
}
