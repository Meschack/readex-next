import { describe, expect, it } from "vitest";
import { SUPPORTED_NARRATION_VOICES } from "@readex/audio";
import { piperVoiceFileUrl, resolveVoicesToInstall } from "./setup-piper-voice.mjs";

describe("Piper voice setup", () => {
  it("installs every voice exposed by the narration settings by default", () => {
    expect(resolveVoicesToInstall({})).toEqual(SUPPORTED_NARRATION_VOICES.map((voice) => voice.id));
  });

  it("keeps explicit voice overrides available for focused setup", () => {
    expect(
      resolveVoicesToInstall({
        READEX_PIPER_VOICE: "en_GB-alba-medium"
      })
    ).toEqual(["en_GB-alba-medium"]);
    expect(
      resolveVoicesToInstall({
        READEX_PIPER_VOICES: "en_US-lessac-medium, en_GB-alba-medium, en_US-lessac-medium"
      })
    ).toEqual(["en_US-lessac-medium", "en_GB-alba-medium"]);
  });

  it("builds Piper voice file URLs for British English", () => {
    expect(piperVoiceFileUrl("en_GB-alba-medium", ".onnx")).toBe(
      "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/alba/medium/en_GB-alba-medium.onnx?download=true"
    );
  });
});
