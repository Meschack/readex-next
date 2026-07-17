import { createDomainEvent, type DomainEventDispatcher } from "@sonelle/domain";
import type { PlaybackStatus } from "@sonelle/reader";
import type { ReaderPlaybackApplication } from "./reader-playback-application";
import type { ReaderView } from "./reader-view";

interface ReaderOpeningDependencies {
  eventDispatcher: DomainEventDispatcher;
  playback: Pick<ReaderPlaybackApplication, "activate">;
  reportEventError(error: unknown): void;
}

interface ReaderOpeningOptions {
  projectReaderSurface(): void;
  projectLibraryRail(bookId: string): void;
  projectLibraryNotice(message: string | null): void;
}

interface PendingReaderOpening {
  reader: ReaderView;
  sentenceIndex: number;
  playbackStatus: PlaybackStatus;
}

export interface ReaderOpeningWorkflow {
  open(reader: ReaderView, sentenceIndex?: number, playbackStatus?: PlaybackStatus): Promise<void>;
  start(): () => void;
}

export function createReaderOpeningWorkflow(
  dependencies: ReaderOpeningDependencies,
  options: ReaderOpeningOptions
): ReaderOpeningWorkflow {
  const pending = new Map<string, PendingReaderOpening>();

  return {
    async open(reader, sentenceIndex = reader.initialSentenceIndex, playbackStatus = "idle") {
      const sentence = reader.sentences[sentenceIndex] ?? reader.sentences[0];
      const event = createDomainEvent("ReaderOpened", {
        bookId: reader.book.id,
        chapterId: reader.chapter.id,
        sentenceId: sentence?.id ?? "",
        sentenceIndex,
        playbackStatus,
        source: reader.source
      });
      pending.set(event.id, { reader, sentenceIndex, playbackStatus });
      try {
        await dependencies.eventDispatcher.dispatch(event);
      } catch (error) {
        dependencies.reportEventError(error);
      } finally {
        pending.delete(event.id);
      }
    },
    start() {
      const subscriptions = [
        dependencies.eventDispatcher.subscribe("ReaderOpened", (event) => {
          const opening = pending.get(event.id);
          if (opening != null) {
            return dependencies.playback.activate(
              opening.reader,
              opening.sentenceIndex,
              opening.playbackStatus
            );
          }
        }),
        dependencies.eventDispatcher.subscribe("ReaderOpened", () => {
          options.projectReaderSurface();
        }),
        dependencies.eventDispatcher.subscribe("ReaderOpened", (event) => {
          options.projectLibraryRail(event.payload.bookId);
        }),
        dependencies.eventDispatcher.subscribe("ReaderOpened", () => {
          options.projectLibraryNotice(null);
        })
      ];
      return () => subscriptions.forEach((unsubscribe) => unsubscribe());
    }
  };
}
