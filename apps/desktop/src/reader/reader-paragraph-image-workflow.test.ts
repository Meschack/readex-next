import { describe, expect, it, vi } from "vitest";
import { createDomainEventDispatcher, type AnyDomainEvent } from "@sonelle/domain";
import { buildFixtureReaderView } from "./reader-view";
import { createReaderParagraphImageWorkflow } from "./reader-paragraph-image-workflow";

describe("reader paragraph image workflow", () => {
  it("exports the paragraph containing the active sentence through domain events", async () => {
    const dispatcher = createDomainEventDispatcher();
    const reader = buildFixtureReaderView();
    const exporter = { export: vi.fn().mockResolvedValue("passage.png") };
    const projectNotice = vi.fn();
    const events: AnyDomainEvent[] = [];
    dispatcher.subscribe("ParagraphImageRequested", (event) => {
      events.push(event);
    });
    dispatcher.subscribe("ParagraphImageCreated", (event) => {
      events.push(event);
    });
    const workflow = createReaderParagraphImageWorkflow(
      { eventDispatcher: dispatcher, exporter },
      {
        currentReader: () => reader,
        currentSentenceIndex: () => 1,
        projectNotice
      }
    );
    const stop = workflow.start();

    workflow.request();

    await vi.waitFor(() => expect(exporter.export).toHaveBeenCalledOnce());
    await vi.waitFor(() =>
      expect(events.map((event) => event.name)).toEqual([
        "ParagraphImageRequested",
        "ParagraphImageCreated"
      ])
    );
    expect(exporter.export).toHaveBeenCalledWith(
      expect.objectContaining({
        paragraphText: reader.paragraphs[0]?.sentences.map((sentence) => sentence.text).join(" "),
        bookTitle: reader.book.title,
        author: reader.book.author,
        chapterTitle: reader.chapter.title
      })
    );
    expect(projectNotice).toHaveBeenLastCalledWith(
      expect.objectContaining({ tone: "success", message: expect.stringContaining("passage.png") })
    );
    stop();
  });

  it("reports renderer failures and projects an actionable error", async () => {
    const dispatcher = createDomainEventDispatcher();
    const error = new Error("Canvas refused to cooperate.");
    const onError = vi.fn();
    const projectNotice = vi.fn();
    const workflow = createReaderParagraphImageWorkflow(
      {
        eventDispatcher: dispatcher,
        exporter: { export: vi.fn().mockRejectedValue(error) },
        onError
      },
      {
        currentReader: buildFixtureReaderView,
        currentSentenceIndex: () => 0,
        projectNotice
      }
    );
    const stop = workflow.start();

    workflow.request();

    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(error));
    await vi.waitFor(() =>
      expect(projectNotice).toHaveBeenLastCalledWith({
        title: "Paragraph image needs attention",
        message: error.message,
        tone: "error"
      })
    );
    stop();
  });
});
