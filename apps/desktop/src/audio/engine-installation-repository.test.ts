import { describe, expect, it } from "vitest";
import {
  failedEngineInstallation,
  projectEngineInstallationProgress
} from "./engine-installation-repository";

describe("offline narration engine installation", () => {
  it("projects retryable failures without exposing model details", () => {
    expect(failedEngineInstallation("kokoro", "Please retry.")).toEqual({
      engineId: "kokoro",
      status: "failed",
      downloadSizeBytes: 0,
      downloadedBytes: 0,
      progress: null,
      message: "Please retry."
    });
  });

  it("projects cumulative download bytes for engine packs", () => {
    expect(
      projectEngineInstallationProgress({
        engineId: "supertonic",
        status: "downloading",
        progress: 37,
        downloadedBytes: 150_000_000,
        totalBytes: 398_960_177,
        message: "Preparing offline narration"
      })
    ).toEqual({
      engineId: "supertonic",
      status: "preparing",
      downloadSizeBytes: 398_960_177,
      downloadedBytes: 150_000_000,
      progress: 37,
      message: "Preparing offline narration"
    });
  });
});
