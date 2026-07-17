import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_AUDIO_SETTINGS } from "@sonelle/audio";
import { createDomainEvent, createDomainEventDispatcher } from "@sonelle/domain";
import { createPlaybackState, type ReaderPlaybackState } from "@sonelle/reader";
import type { SaveReadingPositionInput } from "../library/library-contracts";
import type { ReaderNarrationWorkflow } from "./reader-narration-workflow";
import {
  createReaderPlaybackApplication,
  type ReaderPlaybackApplication
} from "./reader-playback-application";
import { buildFixtureReaderView, type ReaderView } from "./reader-view";

afterEach(() => vi.useRealTimers());

describe("reader playback application", () => {
  it("coordinates jumps, persisted position, and narration projections through its interface", async () => {
    const harness = createHarness();

    harness.application.select(1);
    harness.application.positionChanged();
    await vi.waitFor(() => expect(harness.savePosition).toHaveBeenCalledOnce());
    harness.application.projectNarration(
      createDomainEvent("NarrationSentenceEntered", {
        bookId: harness.reader().book.id,
        chapterId: harness.reader().chapter.id,
        sentenceId: harness.reader().sentences[1].id,
        passageId: "passage-1"
      })
    );

    expect(harness.reset).toHaveBeenCalledOnce();
    expect(harness.playback().activeSentenceIndex).toBe(1);
    expect(harness.playback().status).toBe("playing");
    expect(harness.audible()).toBe(true);
    expect(harness.savePosition).toHaveBeenCalledWith({
      bookId: harness.reader().book.id,
      chapterId: harness.reader().chapter.id,
      sentenceIndex: 1
    });
    harness.application.dispose();
  });

  it("bounds automatic chapter handoff and cancels it when playback changes", async () => {
    vi.useFakeTimers();
    const harness = createHarness();
    harness.setPlayback({ activeSentenceIndex: 0, status: "ended" });

    harness.application.autoAdvanceChanged();
    harness.setPlayback({ activeSentenceIndex: 0, status: "paused" });
    harness.application.autoAdvanceChanged();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(harness.advanceChapter).not.toHaveBeenCalled();

    harness.setPlayback({ activeSentenceIndex: 0, status: "ended" });
    harness.application.autoAdvanceChanged();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(harness.advanceChapter).toHaveBeenCalledOnce();
    harness.application.dispose();
  });

  it("resets old narration before continuing an automatic chapter handoff", async () => {
    vi.useFakeTimers();
    const harness = createHarness({ reactToReaderActivation: true });
    const nextReader: ReaderView = {
      ...buildFixtureReaderView({ chapterId: "chapter-2" }),
      source: "library"
    };
    harness.advanceChapter.mockImplementation(async () => {
      await harness.application.activate(nextReader, 0, "playing");
    });
    harness.setPlayback({ activeSentenceIndex: 0, status: "ended" });

    harness.application.autoAdvanceChanged();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(harness.advanceChapter).toHaveBeenCalledOnce();
    expect(harness.requestPlayback).toHaveBeenCalledWith(nextReader.sentences[0].id);
    expect(harness.operations).toEqual(["reset", `play:${nextReader.sentences[0].id}`]);
    harness.application.dispose();
  });

  it("reacts to a user voice change without duplicating book-activation resets", async () => {
    const harness = createHarness();
    const stop = harness.application.start();
    harness.setPlayback({ activeSentenceIndex: 0, status: "playing" });

    await harness.dispatcher.dispatch(
      createDomainEvent("NarrationSettingsChanged", {
        previousVoiceId: "kokoro:af-heart",
        source: "user",
        settings: { ...DEFAULT_AUDIO_SETTINGS, voiceId: "kokoro:bf-emma" }
      })
    );
    expect(harness.reset).toHaveBeenCalledOnce();
    expect(harness.playback().status).toBe("paused");

    await harness.dispatcher.dispatch(
      createDomainEvent("NarrationSettingsChanged", {
        previousVoiceId: "kokoro:bf-emma",
        source: "book",
        settings: { ...DEFAULT_AUDIO_SETTINGS, voiceId: "supertonic:F1" }
      })
    );
    expect(harness.reset).toHaveBeenCalledOnce();
    stop();
    harness.application.dispose();
  });

  it("flushes and awaits the latest reading position before stopping", async () => {
    let finishSave: (() => void) | undefined;
    const savePosition = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishSave = resolve;
        })
    );
    const harness = createHarness({ savePosition });
    harness.setPlayback({ activeSentenceIndex: 2, status: "playing" });
    harness.application.positionChanged();

    const stopping = harness.application.stop();
    await vi.waitFor(() => expect(savePosition).toHaveBeenCalledOnce());
    expect(harness.pause).not.toHaveBeenCalled();

    finishSave?.();
    await stopping;
    expect(harness.pause).toHaveBeenCalledOnce();
    harness.application.dispose();
  });
});

function createHarness(
  options: {
    reactToReaderActivation?: boolean;
    savePosition?: (position: SaveReadingPositionInput) => Promise<void>;
  } = {}
) {
  let currentReader: ReaderView = { ...buildFixtureReaderView(), source: "library" };
  let currentPlayback = createPlaybackState();
  let currentSettings = DEFAULT_AUDIO_SETTINGS;
  let currentAudible = false;
  const operations: string[] = [];
  const savePosition = vi.fn(options.savePosition ?? (() => Promise.resolve()));
  const reset = vi.fn(async () => void operations.push("reset"));
  const advanceChapter = vi.fn().mockResolvedValue(undefined);
  const dispatcher = createDomainEventDispatcher();
  const narration = {
    requestPlayback: vi.fn((sentenceId: string) => void operations.push(`play:${sentenceId}`)),
    pause: vi.fn().mockResolvedValue(undefined),
    setOutput: vi.fn(),
    prefetchUpcoming: vi.fn(),
    reset,
    start: vi.fn(() => () => undefined)
  } satisfies ReaderNarrationWorkflow;
  let application!: ReaderPlaybackApplication;
  application = createReaderPlaybackApplication(
    {
      narration,
      settings: { activate: vi.fn() },
      eventDispatcher: dispatcher,
      positions: { save: savePosition },
      preparesAcrossChapters: true,
      reportEventError: vi.fn(),
      reportPlaybackError: vi.fn()
    },
    {
      currentReader: () => currentReader,
      currentPlayback: () => currentPlayback,
      currentSettings: () => currentSettings,
      narrationAudible: () => currentAudible,
      narrationReadinessMessage: () => null,
      projectPlayback: (update) => {
        currentPlayback = update(currentPlayback);
      },
      projectNotice: vi.fn(),
      projectAudible: (audible) => {
        currentAudible = audible;
      },
      projectPreparing: vi.fn(),
      projectJump: (update) => {
        currentPlayback = update(currentPlayback);
      },
      projectReaderActivation: (reader, playback) => {
        currentReader = reader;
        currentPlayback = playback;
        if (options.reactToReaderActivation) application.playbackChanged();
      },
      clearSentenceElements: vi.fn(),
      advanceChapter,
      reportPositionError: vi.fn()
    }
  );

  return {
    application,
    reader: () => currentReader,
    playback: () => currentPlayback,
    audible: () => currentAudible,
    setPlayback: (playback: ReaderPlaybackState) => {
      currentPlayback = playback;
    },
    savePosition,
    pause: narration.pause,
    reset,
    requestPlayback: narration.requestPlayback,
    operations,
    advanceChapter,
    dispatcher
  };
}
