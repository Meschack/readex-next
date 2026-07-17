import { createDomainEvent, type DomainEvent, type DomainEventDispatcher } from "@sonelle/domain";
import type { ParagraphImageExporter } from "./reader-paragraph-image";
import { paragraphAtSentenceIndex, type ReaderView } from "./reader-view";

export interface ParagraphImageNotice {
  title: string;
  message: string;
  tone: "pending" | "success" | "error";
}

interface ReaderParagraphImageWorkflowDependencies {
  eventDispatcher: DomainEventDispatcher;
  exporter: ParagraphImageExporter;
  onError?(error: unknown): void;
}

interface ReaderParagraphImageWorkflowOptions {
  currentReader(): ReaderView;
  currentSentenceIndex(): number;
  projectNotice(notice: ParagraphImageNotice | null): void;
}

export interface ReaderParagraphImageWorkflow {
  request(): void;
  start(): () => void;
}

export function createReaderParagraphImageWorkflow(
  dependencies: ReaderParagraphImageWorkflowDependencies,
  options: ReaderParagraphImageWorkflowOptions
): ReaderParagraphImageWorkflow {
  const publish = async (event: Parameters<DomainEventDispatcher["dispatch"]>[0]) => {
    try {
      await dependencies.eventDispatcher.dispatch(event);
    } catch (error) {
      reportSafely(dependencies.onError, error);
    }
  };

  const createImage = async (event: DomainEvent<"ParagraphImageRequested">) => {
    const reader = options.currentReader();
    const paragraph = reader.paragraphs.find((entry) => entry.id === event.payload.paragraphId);
    if (
      paragraph == null ||
      reader.book.id !== event.payload.bookId ||
      reader.chapter.id !== event.payload.chapterId
    ) {
      await publish(
        createDomainEvent("ParagraphImageFailed", {
          ...event.payload,
          reason: "That paragraph is no longer open. Select it and try again."
        })
      );
      return;
    }

    try {
      const fileName = await dependencies.exporter.export({
        paragraphText: paragraph.sentences.map((sentence) => sentence.text).join(" "),
        bookTitle: reader.book.title,
        author: reader.book.author,
        chapterTitle: reader.chapter.title
      });
      await publish(createDomainEvent("ParagraphImageCreated", { ...event.payload, fileName }));
    } catch (error) {
      reportSafely(dependencies.onError, error);
      await publish(
        createDomainEvent("ParagraphImageFailed", {
          ...event.payload,
          reason:
            error instanceof Error
              ? error.message
              : "Sonelle could not create this paragraph image."
        })
      );
    }
  };

  return {
    request() {
      const reader = options.currentReader();
      const paragraph = paragraphAtSentenceIndex(reader.paragraphs, options.currentSentenceIndex());
      if (paragraph == null) {
        const error = new Error("Select a paragraph before saving an image.");
        reportSafely(dependencies.onError, error);
        options.projectNotice({
          title: "No paragraph selected",
          message: error.message,
          tone: "error"
        });
        return;
      }

      void publish(
        createDomainEvent("ParagraphImageRequested", {
          bookId: reader.book.id,
          chapterId: reader.chapter.id,
          paragraphId: paragraph.id
        })
      );
    },
    start() {
      const subscriptions = [
        dependencies.eventDispatcher.subscribe("ParagraphImageRequested", () => {
          options.projectNotice({
            title: "Creating paragraph image",
            message: "Laying out the current paragraph.",
            tone: "pending"
          });
        }),
        dependencies.eventDispatcher.subscribe("ParagraphImageRequested", createImage),
        dependencies.eventDispatcher.subscribe("ParagraphImageCreated", (event) => {
          options.projectNotice({
            title: "Paragraph image ready",
            message: `${event.payload.fileName} was saved to your Downloads folder.`,
            tone: "success"
          });
        }),
        dependencies.eventDispatcher.subscribe("ParagraphImageFailed", (event) => {
          options.projectNotice({
            title: "Paragraph image needs attention",
            message: event.payload.reason,
            tone: "error"
          });
        })
      ];
      return () => subscriptions.forEach((unsubscribe) => unsubscribe());
    }
  };
}

function reportSafely(reporter: ((error: unknown) => void) | undefined, error: unknown) {
  try {
    reporter?.(error);
  } catch {
    // Diagnostics observe image export failures without changing the workflow.
  }
}
