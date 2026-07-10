import { mkdtempSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SUPPORTED_NARRATION_VOICES } from "@sonelle/audio";
import {
  isPiperVoiceReady,
  piperVoiceFileUrl,
  resolveVoicesToInstall
} from "./setup-piper-voice.mjs";

describe("Piper voice setup", () => {
  it("installs every voice exposed by the narration settings by default", () => {
    expect(resolveVoicesToInstall({})).toEqual(SUPPORTED_NARRATION_VOICES.map((voice) => voice.id));
  });

  it("keeps explicit voice overrides available for focused setup", () => {
    expect(
      resolveVoicesToInstall({
        SONELLE_PIPER_VOICE: "en_GB-alba-medium"
      })
    ).toEqual(["en_GB-alba-medium"]);
    expect(
      resolveVoicesToInstall({
        SONELLE_PIPER_VOICES: "en_US-lessac-medium, en_GB-alba-medium, en_US-lessac-medium"
      })
    ).toEqual(["en_US-lessac-medium", "en_GB-alba-medium"]);
  });

  it("builds Piper voice file URLs for British English", () => {
    expect(piperVoiceFileUrl("en_GB-alba-medium", ".onnx")).toBe(
      "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/alba/medium/en_GB-alba-medium.onnx?download=true"
    );
  });

  it("only treats a voice as ready when both files are complete", () => {
    const directory = mkdtempSync(join(tmpdir(), "sonelle-piper-"));
    const voice = "en_US-lessac-medium";

    try {
      expect(isPiperVoiceReady(voice, directory)).toBe(false);

      const modelPath = join(directory, `${voice}.onnx`);
      writeFileSync(modelPath, "");
      truncateSync(modelPath, 10 * 1024 * 1024 + 1);
      expect(isPiperVoiceReady(voice, directory)).toBe(false);

      writeFileSync(join(directory, `${voice}.onnx.json`), "{}");
      expect(isPiperVoiceReady(voice, directory)).toBe(true);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
