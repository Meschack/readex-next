import { describe, expect, it, vi } from "vitest";
import { createDomainEventDispatcher, type AnyDomainEvent } from "@sonelle/domain";
import { FakePassageNarrationAdapter } from "@sonelle/audio/testing";
import type { ReaderDocumentDto } from "../library/library-models";
import { createReaderNarrationPrefetchWorkflow } from "./reader-narration-prefetch-workflow";

describe("reader narration prefetch workflow", () => {
  it("turns an upcoming-chapter request into published lifecycle facts", async () => {
    const dispatcher = createDomainEventDispatcher();
    const events: AnyDomainEvent[] = [];
    observePrefetchEvents(dispatcher, events);
    const adapter = new FakePassageNarrationAdapter();
    const prepare = vi.fn(adapter.prepare.bind(adapter));
    const workflow = createReaderNarrationPrefetchWorkflow({
      adapter: { prepare },
      eventDispatcher: dispatcher,
      repository: { list: async () => [], open: async () => nextChapterDocument() },
      routingMode: "hybrid-v1",
      engineInstallations: () => ({ kokoro: { modelRevision: "kokoro-test" } })
    });
    const stop = workflow.start();

    workflow.request(request());
    await vi.waitFor(() =>
      expect(events.map((event) => event.name)).toEqual([
        "UpcomingNarrationPreparationRequested",
        "UpcomingNarrationPreparationReady"
      ])
    );

    expect(prepare).toHaveBeenCalledOnce();
    stop();
  });

  it("publishes failures and permits an explicit retry", async () => {
    const dispatcher = createDomainEventDispatcher();
    const events: AnyDomainEvent[] = [];
    observePrefetchEvents(dispatcher, events);
    const prepare = vi.fn().mockRejectedValueOnce(new Error("render failed"));
    const workflow = createReaderNarrationPrefetchWorkflow({
      adapter: { prepare },
      eventDispatcher: dispatcher,
      repository: { list: async () => [], open: async () => nextChapterDocument() },
      routingMode: "hybrid-v1",
      engineInstallations: () => ({ kokoro: { modelRevision: "kokoro-test" } })
    });
    const stop = workflow.start();

    workflow.request(request());
    await vi.waitFor(() =>
      expect(events[events.length - 1]?.name).toBe("UpcomingNarrationPreparationFailed")
    );
    workflow.request(request());
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(2));

    stop();
  });
});

function observePrefetchEvents(
  dispatcher: ReturnType<typeof createDomainEventDispatcher>,
  events: AnyDomainEvent[]
) {
  for (const name of [
    "UpcomingNarrationPreparationRequested",
    "UpcomingNarrationPreparationReady",
    "UpcomingNarrationPreparationFailed"
  ] as const) {
    dispatcher.subscribe(name, (event) => {
      events.push(event as AnyDomainEvent);
    });
  }
}

function request() {
  return {
    bookId: "book-1",
    chapterId: "chapter-1",
    nextChapterId: "chapter-2",
    voiceId: "kokoro:af-heart"
  };
}

function nextChapterDocument(): ReaderDocumentDto {
  return {
    book: { id: "book-1", title: "Book", author: "Author", language: "en" },
    activeChapterId: "chapter-2",
    chapters: [
      { id: "chapter-1", title: "One", index: 0, sentenceCount: 1, sentences: [] },
      {
        id: "chapter-2",
        title: "Two",
        index: 1,
        sentenceCount: 1,
        sentences: [{ id: "sentence-2", index: 0, text: "The next chapter begins here." }],
        paragraphs: [{ id: "paragraph-2", index: 0, startSentenceIndex: 0, sentenceCount: 1 }]
      }
    ],
    position: null
  };
}
