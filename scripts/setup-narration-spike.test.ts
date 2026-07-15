import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  isNarrationArtifactReady,
  loadNarrationSpikeConfig,
  narrationArtifactUrl,
  selectSpikeEngines
} from "./setup-narration-spike.mjs";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("narration runtime spike setup", () => {
  it("pins full source and model revisions for both engines", () => {
    const config = loadNarrationSpikeConfig();

    expect(config.engines.map((engine: { id: string }) => engine.id)).toEqual([
      "kokoro",
      "supertonic"
    ]);
    for (const engine of config.engines) {
      expect(engine.source.revision).toMatch(/^[a-f0-9]{40}$/u);
      expect(engine.model.revision).toMatch(/^[a-f0-9]{40}$/u);
    }
  });

  it("selects one engine without weakening the all-engine default", () => {
    const config = loadNarrationSpikeConfig();

    expect(selectSpikeEngines(config).map((engine: { id: string }) => engine.id)).toEqual([
      "kokoro",
      "supertonic"
    ]);
    expect(selectSpikeEngines(config, "kokoro")).toHaveLength(1);
    expect(() => selectSpikeEngines(config, "piper")).toThrow("Unknown narration engine");
  });

  it("builds snapshot URLs without losing nested artifact paths", () => {
    expect(
      narrationArtifactUrl(
        { repository: "Acme/voice", revision: "abc123" },
        { remotePath: "voice styles/F1.json" }
      )
    ).toBe("https://huggingface.co/Acme/voice/resolve/abc123/voice%20styles/F1.json?download=true");
  });

  it("honors an explicit artifact URL when a pack spans repositories", () => {
    expect(
      narrationArtifactUrl(
        { repository: "Acme/voice", revision: "abc123" },
        {
          remotePath: "config.json",
          url: "https://huggingface.co/hexgrad/Kokoro-82M/resolve/abc/config.json"
        }
      )
    ).toBe("https://huggingface.co/hexgrad/Kokoro-82M/resolve/abc/config.json");
  });

  it("requires both the pinned size and SHA-256", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sonelle-narration-spike-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "model.bin");
    const contents = Buffer.from("verified narration model");
    writeFileSync(path, contents);

    const artifact = {
      sizeBytes: contents.length,
      sha256: createHash("sha256").update(contents).digest("hex")
    };

    await expect(isNarrationArtifactReady(path, artifact)).resolves.toBe(true);
    await expect(
      isNarrationArtifactReady(path, { ...artifact, sha256: "0".repeat(64) })
    ).resolves.toBe(false);
    await expect(
      isNarrationArtifactReady(path, { ...artifact, sizeBytes: contents.length + 1 })
    ).resolves.toBe(false);
  });
});
