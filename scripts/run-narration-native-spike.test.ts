import { describe, expect, it } from "vitest";
import { resolveNativeSpikePaths } from "./run-narration-native-spike.mjs";

describe("native narration spike runner", () => {
  it("keeps generated models and evidence outside the tracked source tree", () => {
    const paths = resolveNativeSpikePaths({ workspace: ".sonelle/narration-spike" }, "linux");

    expect(paths.workspace.endsWith("/.sonelle/narration-spike")).toBe(true);
    expect(paths.python.endsWith("/kokoro-reference-venv/bin/python")).toBe(true);
    expect(paths.manifest.endsWith("/tools/narration-spike/native-runtime/Cargo.toml")).toBe(true);
  });
});
