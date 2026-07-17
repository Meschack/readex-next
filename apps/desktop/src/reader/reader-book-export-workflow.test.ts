import { describe, expect, it, vi } from "vitest";
import { createDomainEventDispatcher, type AnyDomainEvent } from "@sonelle/domain";
import { buildFixtureReaderView } from "./reader-view";
import { createReaderBookExportWorkflow } from "./reader-book-export-workflow";

describe("reader book export workflow", () => {
  it("keeps a completed download successful when another event reaction fails", async () => {
    const dispatcher = createDomainEventDispatcher();
    const events: AnyDomainEvent[] = [];
    const download = vi.fn();
    const notices: Array<string | null> = [];
    const reader = buildFixtureReaderView();
    dispatcher.subscribe("BookExportRequested", (event) => {
      events.push(event);
    });
    dispatcher.subscribe("BookExported", (event) => {
      events.push(event);
    });
    dispatcher.subscribe("BookExported", () => {
      throw new Error("unrelated projection failed");
    });
    const workflow = createReaderBookExportWorkflow(
      {
        eventDispatcher: dispatcher,
        exporter: { exportData: vi.fn() },
        download,
        friendlyError: () => "Export failed",
        onEventError: vi.fn()
      },
      {
        currentReader: () => reader,
        currentSentenceIndex: () => 0,
        currentBookmarks: () => [],
        projectNotice: (message) => notices.push(message)
      }
    );
    const stop = workflow.start();

    workflow.request();
    await vi.waitFor(() => expect(download).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(events.map((event) => event.name)).toContain("BookExported"));

    expect(events.map((event) => event.name)).toEqual(["BookExportRequested", "BookExported"]);
    expect(notices[notices.length - 1]).toContain("Downloaded");
    stop();
  });
});
