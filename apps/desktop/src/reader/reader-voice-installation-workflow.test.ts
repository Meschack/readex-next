import { describe, expect, it, vi } from "vitest";
import { createDomainEventDispatcher, type AnyDomainEvent } from "@sonelle/domain";
import type { EventSink } from "@sonelle/storage";
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
  it("turns one request into a persisted ready lifecycle", async () => {
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
});

function createHarness(outcome: { result: VoiceInstallationState } | { error: Error }) {
  const dispatcher = createDomainEventDispatcher();
  const events: AnyDomainEvent[] = [];
  const states: VoiceInstallationState[] = [];
  const notices: Array<string | null> = [];
  const eventSink: EventSink = {
    append: async (event) => void events.push(event as AnyDomainEvent)
  };
  const install = vi.fn(async () => {
    if ("error" in outcome) throw outcome.error;
    return outcome.result;
  });
  const repository: VoiceInstallationRepository = {
    getStatus: async () => readyInstallation,
    install,
    listen: async () => () => undefined
  };
  const workflow = createReaderVoiceInstallationWorkflow({
    eventDispatcher: dispatcher,
    eventSink,
    repository,
    selectedVoiceId: () => "en_US-amy-medium",
    projectInstallation: (state) => states.push(state),
    projectNotice: (notice) => notices.push(notice),
    friendlyError: () => "Please retry."
  });

  return { workflow, events, states, notices, install };
}
