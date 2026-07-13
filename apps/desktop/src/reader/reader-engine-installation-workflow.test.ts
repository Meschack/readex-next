import { describe, expect, it, vi } from "vitest";
import { createDomainEventDispatcher, type AnyDomainEvent } from "@sonelle/domain";
import type { EventSink } from "@sonelle/storage";
import type {
  EngineInstallationRepository,
  EngineInstallationState,
  NarrationEngineId
} from "../audio/engine-installation-repository";
import { createReaderEngineInstallationWorkflow } from "./reader-engine-installation-workflow";

const readyInstallation: EngineInstallationState = {
  engineId: "kokoro",
  status: "ready",
  downloadSizeBytes: 0,
  downloadedBytes: 0,
  progress: 100,
  message: "Ready to listen offline."
};

describe("reader engine installation workflow", () => {
  it("turns one request into a persisted ready lifecycle", async () => {
    const harness = createHarness({ result: readyInstallation });
    const stop = await harness.workflow.start();

    harness.workflow.request("kokoro");
    await vi.waitFor(() =>
      expect(harness.events.map((event) => event.name)).toEqual([
        "OfflineNarrationFilesInstallationRequested",
        "OfflineNarrationFilesInstallationReady"
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

    harness.workflow.request("supertonic");
    await vi.waitFor(() =>
      expect(harness.events.map((event) => event.name)).toEqual([
        "OfflineNarrationFilesInstallationRequested",
        "OfflineNarrationFilesInstallationFailed"
      ])
    );

    expect(harness.states[harness.states.length - 1]).toEqual({
      engineId: "supertonic",
      status: "failed",
      downloadSizeBytes: 0,
      downloadedBytes: 0,
      progress: null,
      message: "Please retry."
    });
    expect(harness.notices[harness.notices.length - 1]).toBe("Please retry.");
    stop();
  });
});

function createHarness(outcome: { result: EngineInstallationState } | { error: Error }) {
  const dispatcher = createDomainEventDispatcher();
  const events: AnyDomainEvent[] = [];
  const states: EngineInstallationState[] = [];
  const notices: Array<string | null> = [];
  const eventSink: EventSink = {
    append: async (event) => void events.push(event as AnyDomainEvent)
  };
  const install = vi.fn(async (engineId: NarrationEngineId) => {
    if ("error" in outcome) throw outcome.error;
    return { ...outcome.result, engineId };
  });
  const repository: EngineInstallationRepository = {
    getStatus: async (engineId) => ({ ...readyInstallation, engineId }),
    install,
    listen: async () => () => undefined
  };
  const workflow = createReaderEngineInstallationWorkflow({
    eventDispatcher: dispatcher,
    eventSink,
    repository,
    projectInstallation: (state) => states.push(state),
    projectNotice: (notice) => notices.push(notice),
    friendlyError: () => "Please retry."
  });

  return { workflow, events, states, notices, install };
}
