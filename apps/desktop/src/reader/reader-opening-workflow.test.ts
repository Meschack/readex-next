import { describe, expect, it, vi } from "vitest";
import { createDomainEventDispatcher, type AnyDomainEvent } from "@sonelle/domain";
import { createReaderOpeningWorkflow } from "./reader-opening-workflow";
import { buildFixtureReaderView } from "./reader-view";

describe("reader opening workflow", () => {
  it("publishes one fact and lets opening consequences react independently", async () => {
    const dispatcher = createDomainEventDispatcher();
    const events: AnyDomainEvent[] = [];
    dispatcher.subscribe("ReaderOpened", (event) => {
      events.push(event);
    });
    let finishActivation = () => {};
    const activate = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishActivation = resolve;
        })
    );
    const projectReaderSurface = vi.fn();
    const projectLibraryRail = vi.fn();
    const projectLibraryNotice = vi.fn();
    const workflow = createReaderOpeningWorkflow(
      {
        eventDispatcher: dispatcher,
        playback: { activate },
        reportEventError: vi.fn()
      },
      { projectReaderSurface, projectLibraryRail, projectLibraryNotice }
    );
    const stop = workflow.start();
    const reader = buildFixtureReaderView();

    const opening = workflow.open(reader, 1, "playing");
    await vi.waitFor(() => expect(activate).toHaveBeenCalledWith(reader, 1, "playing"));
    expect(projectReaderSurface).not.toHaveBeenCalled();
    finishActivation();
    await opening;

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      name: "ReaderOpened",
      payload: {
        bookId: reader.book.id,
        chapterId: reader.chapter.id,
        sentenceIndex: 1,
        playbackStatus: "playing"
      }
    });
    expect(projectReaderSurface).toHaveBeenCalledOnce();
    expect(projectLibraryRail).toHaveBeenCalledWith(reader.book.id);
    expect(projectLibraryNotice).toHaveBeenCalledWith(null);
    stop();
  });
});
