import { createDomainEvent, type DomainEvent, type DomainEventDispatcher } from "@sonelle/domain";
import type { BookExporter, LibraryBookmarkDto } from "../library/library-contracts";
import { createSampleExport, downloadJson } from "./reader-export";
import { slugify } from "./reader-formatting";
import type { ReaderView } from "./reader-view";

interface ReaderBookExportWorkflowDependencies {
  eventDispatcher: DomainEventDispatcher;
  exporter: BookExporter;
  download?(fileName: string, data: unknown): void;
  friendlyError(error: unknown): string;
  onEventError?(error: unknown): void;
}

interface ReaderBookExportWorkflowOptions {
  currentReader(): ReaderView;
  currentSentenceIndex(): number;
  currentBookmarks(): LibraryBookmarkDto[];
  projectNotice(message: string | null): void;
}

export interface ReaderBookExportWorkflow {
  request(): void;
  start(): () => void;
}

export function createReaderBookExportWorkflow(
  dependencies: ReaderBookExportWorkflowDependencies,
  options: ReaderBookExportWorkflowOptions
): ReaderBookExportWorkflow {
  const download = dependencies.download ?? downloadJson;
  const publish = async (event: Parameters<DomainEventDispatcher["dispatch"]>[0]) => {
    try {
      await dependencies.eventDispatcher.dispatch(event);
    } catch (error) {
      try {
        dependencies.onEventError?.(error);
      } catch {
        // Event diagnostics must not alter a completed export.
      }
    }
  };

  const exportBook = async (event: DomainEvent<"BookExportRequested">) => {
    const reader = options.currentReader();
    if (event.payload.bookId !== reader.book.id) return;
    try {
      const bookmarks = options.currentBookmarks();
      const data =
        reader.source === "library"
          ? await dependencies.exporter.exportData(reader.book.id)
          : createSampleExport(reader, options.currentSentenceIndex(), bookmarks);
      const fileName = `${slugify(reader.book.title)}-sonelle-export.json`;
      download(fileName, data);
      await publish(
        createDomainEvent("BookExported", {
          bookId: reader.book.id,
          exportedAt: new Date().toISOString(),
          bookmarkCount: bookmarks.length,
          fileName
        })
      );
    } catch (error) {
      await publish(
        createDomainEvent("BookExportFailed", {
          bookId: reader.book.id,
          reason: dependencies.friendlyError(error)
        })
      );
    }
  };

  return {
    request() {
      void publish(
        createDomainEvent("BookExportRequested", { bookId: options.currentReader().book.id })
      );
    },
    start() {
      const subscriptions = [
        dependencies.eventDispatcher.subscribe("BookExportRequested", exportBook),
        dependencies.eventDispatcher.subscribe("BookExported", (event) => {
          if (event.payload.fileName != null) {
            options.projectNotice(
              `Downloaded ${event.payload.fileName}. Check your Downloads folder.`
            );
          }
        }),
        dependencies.eventDispatcher.subscribe("BookExportFailed", (event) =>
          options.projectNotice(event.payload.reason)
        )
      ];
      return () => subscriptions.forEach((unsubscribe) => unsubscribe());
    }
  };
}
