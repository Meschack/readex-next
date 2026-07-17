import { describe, expect, it, vi } from "vitest";
import { createDomainEventDispatcher, type AnyDomainEvent } from "@sonelle/domain";
import type {
  VoiceInstallationRepository,
  VoiceInstallationState
} from "../audio/voice-installation-repository";
import { createReaderVoiceInstallationWorkflow } from "./reader-voice-installation-workflow";

const readyInstallation: VoiceInstallationState = {
  voiceId: "en_US-amy-medium",
  status: "ready",
  downloadSizeBytes: 0,
  downloadedBytes: 0,
  progress: 100,
  message: "Ready to listen offline."
};

describe("reader voice installation workflow", () => {
  it("turns one request into a published ready lifecycle", async () => {
    const harness = createHarness({ result: readyInstallation });
    const stop = await harness.workflow.start();

    harness.workflow.request("en_US-amy-medium");
    await vi.waitFor(() =>
      expect(harness.events.map((event) => event.name)).toEqual([
        "VoiceInstallationRequested",
        "VoiceInstallationReady"
      ])
    );

    expect(harness.install).toHaveBeenCalledOnce();
    expect(harness.states[harness.states.length - 1]).toEqual(readyInstallation);
    expect(harness.notices[harness.notices.length - 1]).toBeNull();
    stop();
  });

  it("turns installation errors into one friendly failed event", async () => {
    const harness = createHarness({ error: new Error("native detail") });
    const stop = await harness.workflow.start();

    harness.workflow.request("en_US-amy-medium");
    await vi.waitFor(() =>
      expect(harness.events.map((event) => event.name)).toEqual([
        "VoiceInstallationRequested",
        "VoiceInstallationFailed"
      ])
    );

    expect(harness.states[harness.states.length - 1]?.status).toBe("failed");
    expect(harness.notices[harness.notices.length - 1]).toBe("Please retry.");
    stop();
  });

  it("projects transient native progress without publishing a lifecycle event", async () => {
    const harness = createHarness({ result: readyInstallation });
    const stop = await harness.workflow.start();

    harness.emitProgress({
      ...readyInstallation,
      status: "preparing",
      downloadSizeBytes: 100,
      downloadedBytes: 40,
      progress: 40
    });
    await vi.waitFor(() =>
      expect(harness.states[harness.states.length - 1]?.downloadedBytes).toBe(40)
    );

    stop();
  });
});

function createHarness(outcome: { result: VoiceInstallationState } | { error: Error }) {
  const dispatcher = createDomainEventDispatcher();
  const events: AnyDomainEvent[] = [];
  for (const name of [
    "VoiceInstallationRequested",
    "VoiceInstallationReady",
    "VoiceInstallationFailed"
  ] as const) {
    dispatcher.subscribe(name, (event) => {
      events.push(event as AnyDomainEvent);
    });
  }
  const states: VoiceInstallationState[] = [];
  const notices: Array<string | null> = [];
  const install = vi.fn(async () => {
    if ("error" in outcome) throw outcome.error;
    return outcome.result;
  });
  let progressListener: (state: VoiceInstallationState) => void = () => undefined;
  const repository: VoiceInstallationRepository = {
    getStatus: async () => readyInstallation,
    install,
    listen: async (listener) => {
      progressListener = listener;
      return () => undefined;
    }
  };
  const workflow = createReaderVoiceInstallationWorkflow({
    eventDispatcher: dispatcher,
    repository,
    selectedVoiceId: () => "en_US-amy-medium",
    projectInstallation: (state) => states.push(state),
    projectNotice: (notice) => notices.push(notice),
    friendlyError: () => "Please retry."
  });

  return {
    workflow,
    events,
    states,
    notices,
    install,
    emitProgress: (state: VoiceInstallationState) => progressListener(state)
  };
}
