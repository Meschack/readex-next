import { describe, expect, it, vi } from "vitest";
import { createDomainEventDispatcher, type AnyDomainEvent } from "@sonelle/domain";
import type {
  EngineInstallationRepository,
  EngineInstallationState,
  NarrationEngineId
} from "../audio/engine-installation-repository";
import { createReaderEngineInstallationWorkflow } from "./reader-engine-installation-workflow";

const readyInstallation: EngineInstallationState = {
  engineId: "kokoro",
  status: "ready",
  modelRevision: "kokoro-test",
  downloadSizeBytes: 0,
  downloadedBytes: 0,
  progress: 100,
  message: "Ready to listen offline."
};

describe("reader engine installation workflow", () => {
  it("turns one request into a published ready lifecycle", async () => {
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
      modelRevision: "",
      downloadSizeBytes: 0,
      downloadedBytes: 0,
      progress: null,
      message: "Please retry."
    });
    expect(harness.notices[harness.notices.length - 1]).toBe("Please retry.");
    stop();
  });

  it("projects transient native progress without publishing a lifecycle event", async () => {
    const harness = createHarness({ result: readyInstallation });
    const stop = await harness.workflow.start();

    harness.emitProgress({
      ...readyInstallation,
      status: "preparing",
      downloadSizeBytes: 200,
      downloadedBytes: 75,
      progress: 37.5
    });
    await vi.waitFor(() =>
      expect(harness.states[harness.states.length - 1]?.downloadedBytes).toBe(75)
    );

    stop();
  });
});

function createHarness(outcome: { result: EngineInstallationState } | { error: Error }) {
  const dispatcher = createDomainEventDispatcher();
  const events: AnyDomainEvent[] = [];
  for (const name of [
    "OfflineNarrationFilesInstallationRequested",
    "OfflineNarrationFilesInstallationReady",
    "OfflineNarrationFilesInstallationFailed"
  ] as const) {
    dispatcher.subscribe(name, (event) => {
      events.push(event as AnyDomainEvent);
    });
  }
  const states: EngineInstallationState[] = [];
  const notices: Array<string | null> = [];
  const install = vi.fn(async (engineId: NarrationEngineId) => {
    if ("error" in outcome) throw outcome.error;
    return { ...outcome.result, engineId };
  });
  let progressListener: (state: EngineInstallationState) => void = () => undefined;
  const repository: EngineInstallationRepository = {
    getStatus: async (engineId) => ({ ...readyInstallation, engineId }),
    install,
    listen: async (listener) => {
      progressListener = listener;
      return () => undefined;
    }
  };
  const workflow = createReaderEngineInstallationWorkflow({
    eventDispatcher: dispatcher,
    repository,
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
    emitProgress: (state: EngineInstallationState) => progressListener(state)
  };
}
