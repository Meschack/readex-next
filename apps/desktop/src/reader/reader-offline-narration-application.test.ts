import { describe, expect, it, vi } from "vitest";
import {
  createDomainEvent,
  createDomainEventDispatcher,
  type AnyDomainEvent
} from "@sonelle/domain";
import type { ReaderNarrationWorkflow } from "./reader-narration-workflow";
import { createReaderOfflineNarrationApplication } from "./reader-offline-narration-application";

describe("reader offline narration application", () => {
  it("owns selected-voice installation and event-driven prepared audio maintenance", async () => {
    const install = vi.fn().mockResolvedValue(undefined);
    const getStatus = vi.fn().mockResolvedValue({
      voiceId: "voice-1",
      status: "ready",
      downloadSizeBytes: 10,
      downloadedBytes: 10,
      progress: 100,
      message: "Ready"
    });
    const setOutput = vi.fn();
    const reset = vi.fn().mockResolvedValue(undefined);
    const clear = vi.fn().mockResolvedValue({ sentenceCount: 0, sizeBytes: 0 });
    const getStats = vi.fn().mockResolvedValue({ sentenceCount: 2, sizeBytes: 20 });
    const projectAudioCacheNotice = vi.fn();
    const reportPreparedAudioError = vi.fn();
    const stopListening = vi.fn();
    const dispatcher = createDomainEventDispatcher();
    const events: AnyDomainEvent[] = [];
    for (const name of [
      "VoiceInstallationRequested",
      "VoiceInstallationReady",
      "PreparedNarrationClearingRequested",
      "PreparedNarrationCleared"
    ] as const) {
      dispatcher.subscribe(name, (event) => {
        events.push(event as AnyDomainEvent);
      });
    }
    const settings = {
      playbackRate: 1,
      volume: 1,
      autoAdvance: true,
      voiceId: "voice-1",
      voicePreferences: { en: "voice-1" }
    };
    const narration = {
      requestPlayback: vi.fn(),
      pause: vi.fn().mockResolvedValue(undefined),
      setOutput,
      prefetchUpcoming: vi.fn(),
      reset,
      start: vi.fn(() => () => undefined)
    } satisfies ReaderNarrationWorkflow;
    const application = createReaderOfflineNarrationApplication(
      {
        audioCache: {
          getStats,
          clear
        },
        engineInstallations: {
          getStatus: vi.fn(),
          install: vi.fn(),
          listen: vi.fn().mockResolvedValue(() => undefined)
        },
        eventDispatcher: dispatcher,
        narration,
        offlineLibrary: "individual-voice",
        voiceInstallations: {
          getStatus,
          install,
          listen: vi.fn().mockResolvedValue(stopListening)
        },
        friendlyError: () => "Narration needs attention.",
        reportPreparedAudioError
      },
      {
        currentBookId: () => "book-1",
        selectedVoiceId: () => "voice-1",
        projectAudioCache: vi.fn(),
        projectAudioCacheNotice,
        projectEngineInstallation: vi.fn(),
        projectNarrationProfile: vi.fn(),
        projectNarrationNotice: vi.fn(),
        projectVoiceInstallation: vi.fn()
      }
    );
    const stop = await application.start();

    await dispatcher.dispatch(
      createDomainEvent("NarrationSettingsChanged", {
        previousVoiceId: "voice-0",
        source: "user",
        settings
      })
    );
    application.requestSelectedVoice();
    await vi.waitFor(() => expect(install).toHaveBeenCalledWith("voice-1"));
    application.clearPreparedAudio();
    await vi.waitFor(() => expect(clear).toHaveBeenCalledOnce());

    expect(setOutput).not.toHaveBeenCalled();
    expect(reset).toHaveBeenCalledOnce();
    expect(clear).toHaveBeenCalledWith("book-1");
    expect(getStats).toHaveBeenCalledWith("book-1");
    expect(events.map((event) => event.name)).toEqual(
      expect.arrayContaining([
        "VoiceInstallationRequested",
        "VoiceInstallationReady",
        "PreparedNarrationClearingRequested",
        "PreparedNarrationCleared"
      ])
    );

    const refreshError = new Error("Could not inspect prepared audio");
    getStats.mockRejectedValueOnce(refreshError);
    await application.refreshPreparedAudio();
    expect(reportPreparedAudioError).toHaveBeenCalledWith(refreshError, "book-1");
    expect(projectAudioCacheNotice).toHaveBeenLastCalledWith("Narration needs attention.");

    getStats.mockResolvedValueOnce({ sentenceCount: 2, sizeBytes: 20 });
    await application.refreshPreparedAudio();
    expect(projectAudioCacheNotice).toHaveBeenLastCalledWith(null);

    stop();
    expect(stopListening).toHaveBeenCalledOnce();
  });

  it("projects ready provider files immediately after installation completes", async () => {
    const dispatcher = createDomainEventDispatcher();
    const projectEngineInstallation = vi.fn();
    const projectNarrationProfile = vi.fn();
    const readyEngines = new Set<string>();
    const engineState = (engineId: "kokoro" | "supertonic") => ({
      engineId,
      status: readyEngines.has(engineId) ? ("ready" as const) : ("not-installed" as const),
      modelRevision: readyEngines.has(engineId) ? `${engineId}-test` : "",
      downloadSizeBytes: 10,
      downloadedBytes: readyEngines.has(engineId) ? 10 : 0,
      progress: readyEngines.has(engineId) ? 100 : null,
      message: readyEngines.has(engineId) ? "Ready" : "Download narration files"
    });
    const narration = {
      requestPlayback: vi.fn(),
      pause: vi.fn().mockResolvedValue(undefined),
      setOutput: vi.fn(),
      prefetchUpcoming: vi.fn(),
      reset: vi.fn().mockResolvedValue(undefined),
      start: vi.fn(() => () => undefined)
    } satisfies ReaderNarrationWorkflow;
    const application = createReaderOfflineNarrationApplication(
      {
        audioCache: {
          getStats: vi.fn().mockResolvedValue({ sentenceCount: 0, sizeBytes: 0 }),
          clear: vi.fn().mockResolvedValue({ sentenceCount: 0, sizeBytes: 0 })
        },
        engineInstallations: {
          getStatus: vi.fn(async (engineId) => engineState(engineId)),
          install: vi.fn(async (engineId) => {
            readyEngines.add(engineId);
            return engineState(engineId);
          }),
          listen: vi.fn().mockResolvedValue(() => undefined)
        },
        eventDispatcher: dispatcher,
        narration,
        offlineLibrary: "language-pack",
        voiceInstallations: {
          getStatus: vi.fn(),
          install: vi.fn(),
          listen: vi.fn().mockResolvedValue(() => undefined)
        },
        friendlyError: () => "Narration needs attention."
      },
      {
        currentBookId: () => "book-1",
        selectedVoiceId: () => "kokoro:af-heart",
        projectAudioCache: vi.fn(),
        projectAudioCacheNotice: vi.fn(),
        projectEngineInstallation,
        projectNarrationProfile,
        projectNarrationNotice: vi.fn(),
        projectVoiceInstallation: vi.fn()
      }
    );
    const stop = await application.start();

    application.requestNarrationProfile("english");

    await vi.waitFor(() =>
      expect(projectEngineInstallation).toHaveBeenCalledWith(
        expect.objectContaining({ engineId: "kokoro", status: "ready" })
      )
    );
    expect(projectNarrationProfile).toHaveBeenCalledWith(
      expect.objectContaining({ id: "english", status: "ready" })
    );

    stop();
  });
});
