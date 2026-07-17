import { describe, expect, it, vi } from "vitest";
import type { AudioSettings } from "@sonelle/audio";
import type { NarrationSession } from "@sonelle/audio/narration";
import {
  createDomainEvent,
  createDomainEventDispatcher,
  type AnyDomainEvent
} from "@sonelle/domain";
import { buildFixtureReaderView } from "./reader-view";
import type { ReaderNarrationPrefetchWorkflow } from "./reader-narration-prefetch-workflow";
import { createReaderNarrationWorkflow } from "./reader-narration-workflow";

describe("reader narration workflow", () => {
  it("runs playback and publishes lifecycle facts through one application interface", async () => {
    const dispatcher = createDomainEventDispatcher();
    const events: AnyDomainEvent[] = [];
    for (const name of [
      "NarrationPlaybackRequested",
      "NarrationPreparationStarted",
      "PassageNarrationReady",
      "NarrationSentenceEntered",
      "PassageNarrationPlaybackEnded",
      "NarrationPlaybackEnded",
      "NarrationResetRequested"
    ] as const) {
      dispatcher.subscribe(name, (event) => {
        events.push(event as AnyDomainEvent);
      });
    }
    const projections: string[] = [];
    const reader = buildFixtureReaderView();
    const session = fakeSession(async (sentenceId) => {
      const base = {
        bookId: reader.book.id,
        chapterId: reader.chapter.id,
        sentenceId,
        passageId: `${reader.chapter.id}:passage-1`
      };
      await dispatcher.dispatch(createDomainEvent("NarrationPreparationStarted", base));
      await dispatcher.dispatch(
        createDomainEvent("PassageNarrationReady", {
          ...base,
          firstSentenceId: sentenceId,
          lastSentenceId: sentenceId,
          voiceId: "kokoro:af-heart",
          engineId: "kokoro",
          source: "prepared"
        })
      );
      await dispatcher.dispatch(createDomainEvent("NarrationSentenceEntered", base));
      await dispatcher.dispatch(
        createDomainEvent("PassageNarrationPlaybackEnded", {
          bookId: base.bookId,
          chapterId: base.chapterId,
          passageId: base.passageId,
          lastSentenceId: sentenceId
        })
      );
      await dispatcher.dispatch(
        createDomainEvent("NarrationPlaybackEnded", {
          bookId: base.bookId,
          chapterId: base.chapterId,
          passageId: base.passageId,
          lastSentenceId: sentenceId
        })
      );
    });
    const prefetch = fakePrefetchWorkflow();
    const projectPreparing = vi.fn();
    const projectAudible = vi.fn();
    const workflow = createReaderNarrationWorkflow(
      {
        eventDispatcher: dispatcher,
        prefetchWorkflow: prefetch,
        routingMode: "hybrid-v1",
        session
      },
      {
        currentReader: () => reader,
        currentSettings: settings,
        engineInstallations: () => ({ kokoro: { modelRevision: "kokoro-test" } }),
        projectPlayback: (event) => projections.push(event.name),
        projectPreparing,
        projectAudible,
        projectNotice: vi.fn(),
        reportError: vi.fn()
      }
    );
    const stop = workflow.start();

    workflow.requestPlayback(reader.sentences[0].id);
    await vi.waitFor(() => expect(session.play).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(projections).toContain("NarrationPlaybackEnded"));
    await vi.waitFor(() => expect(events).toHaveLength(6));

    expect(events.map((event) => event.name)).toEqual([
      "NarrationPlaybackRequested",
      "NarrationPreparationStarted",
      "PassageNarrationReady",
      "NarrationSentenceEntered",
      "PassageNarrationPlaybackEnded",
      "NarrationPlaybackEnded"
    ]);
    expect(session.open).toHaveBeenCalledOnce();
    await workflow.reset();
    await vi.waitFor(() => expect(events[events.length - 1]?.name).toBe("NarrationResetRequested"));
    expect(prefetch.reset).toHaveBeenCalledOnce();
    expect(session.close).toHaveBeenCalledOnce();
    expect(projectPreparing).toHaveBeenLastCalledWith(false);
    expect(projectAudible).toHaveBeenLastCalledWith(false);
    stop();
    expect(session.close).toHaveBeenCalledTimes(2);
  });

  it.each([
    "NarrationPlaybackPaused",
    "NarrationPlaybackEnded",
    "NarrationPlaybackFailed"
  ] as const)("clears pending preparation when %s is projected", async (eventName) => {
    const dispatcher = createDomainEventDispatcher();
    const reader = buildFixtureReaderView();
    const projectPreparing = vi.fn();
    const projectAudible = vi.fn();
    const workflow = createReaderNarrationWorkflow(
      {
        eventDispatcher: dispatcher,
        prefetchWorkflow: fakePrefetchWorkflow(),
        routingMode: "hybrid-v1",
        session: fakeSession(async () => undefined)
      },
      {
        currentReader: () => reader,
        currentSettings: settings,
        engineInstallations: () => ({}),
        projectPlayback: vi.fn(),
        projectPreparing,
        projectAudible,
        projectNotice: vi.fn(),
        reportError: vi.fn()
      }
    );
    const stop = workflow.start();
    const base = {
      bookId: reader.book.id,
      chapterId: reader.chapter.id,
      passageId: `${reader.chapter.id}:passage-1`
    };
    const event =
      eventName === "NarrationPlaybackEnded"
        ? createDomainEvent(eventName, { ...base, lastSentenceId: reader.sentences[0].id })
        : eventName === "NarrationPlaybackPaused"
          ? createDomainEvent(eventName, { ...base, sentenceId: reader.sentences[0].id })
          : createDomainEvent(eventName, {
              ...base,
              sentenceId: reader.sentences[0].id,
              reason: "Narration needs attention."
            });

    await dispatcher.dispatch(event);

    expect(projectPreparing).toHaveBeenLastCalledWith(false);
    expect(projectAudible).toHaveBeenLastCalledWith(false);
    stop();
  });
});

const settings = (): AudioSettings => ({
  playbackRate: 1,
  volume: 1,
  autoAdvance: true,
  voiceId: "kokoro:af-heart",
  voicePreferences: { en: "kokoro:af-heart" }
});

function fakeSession(onPlay: (sentenceId: string) => Promise<void>) {
  return {
    open: vi.fn(),
    play: vi.fn(onPlay),
    pause: vi.fn(async () => undefined),
    moveTo: vi.fn(async () => undefined),
    setOutput: vi.fn(),
    close: vi.fn()
  } satisfies NarrationSession;
}

function fakePrefetchWorkflow() {
  return {
    request: vi.fn(),
    reset: vi.fn(),
    start: vi.fn(() => () => undefined)
  } satisfies ReaderNarrationPrefetchWorkflow;
}
