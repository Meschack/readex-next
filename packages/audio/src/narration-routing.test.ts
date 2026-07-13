import { describe, expect, it } from "vitest";
import {
  resolveCatalogNarrationVoice,
  validateNarrationCatalog,
  type NarrationCatalog
} from "./narration-catalog";
import { routeNarrationEngine } from "./narration-routing";

describe("narration engine routing", () => {
  it("uses contextual English passages and multilingual sentence batches", () => {
    expect(routeNarrationEngine("en-GB")).toEqual({
      engineId: "kokoro",
      preparationKind: "passage",
      language: "en"
    });
    expect(routeNarrationEngine("fr-FR")).toEqual({
      engineId: "supertonic",
      preparationKind: "sentence-batch",
      language: "fr"
    });
  });

  it("routes missing and unsupported languages to the language-agnostic fallback", () => {
    expect(routeNarrationEngine(null).language).toBe("na");
    expect(routeNarrationEngine("tlh").language).toBe("na");
  });
});

describe("narration catalog", () => {
  it("links voices to matching engine packs and resolves language preferences", () => {
    const catalog = narrationCatalog();

    expect(validateNarrationCatalog(catalog)).toEqual({ valid: true, issues: [] });
    expect(resolveCatalogNarrationVoice(catalog, "en-US", { en: "kokoro:af-heart" }).id).toBe(
      "kokoro:af-heart"
    );
    expect(resolveCatalogNarrationVoice(catalog, "fr-FR").id).toBe("supertonic:F1");
    expect(resolveCatalogNarrationVoice(catalog, "tlh").id).toBe("supertonic:F1");
  });

  it("rejects voices whose pack belongs to another engine", () => {
    const catalog = narrationCatalog();
    catalog.voices = [{ ...catalog.voices[0], engineId: "supertonic" }, catalog.voices[1]];

    expect(validateNarrationCatalog(catalog)).toEqual({
      valid: false,
      issues: ["engine-mismatch", "invalid-default"]
    });
  });
});

function narrationCatalog(): NarrationCatalog {
  const digest = "a".repeat(64);
  return {
    schemaVersion: 1,
    defaultVoiceIds: { en: "kokoro:af-heart", fr: "supertonic:F1", "*": "supertonic:F1" },
    packs: [
      {
        id: "kokoro-english",
        engineId: "kokoro",
        modelRevision: "kokoro-test",
        artifacts: [
          {
            id: "kokoro-model",
            role: "model",
            fileName: "kokoro.onnx",
            sizeBytes: 10,
            sha256: digest
          }
        ]
      },
      {
        id: "supertonic-multilingual",
        engineId: "supertonic",
        modelRevision: "supertonic-test",
        artifacts: [
          {
            id: "supertonic-model",
            role: "model",
            fileName: "model.onnx",
            sizeBytes: 10,
            sha256: digest
          }
        ]
      }
    ],
    voices: [
      {
        id: "kokoro:af-heart",
        label: "Heart",
        description: "American English",
        locale: "en-US",
        languages: ["en"],
        engineId: "kokoro",
        engineVoiceId: "af_heart",
        packId: "kokoro-english",
        modelRevision: "kokoro-test"
      },
      {
        id: "supertonic:F1",
        label: "F1",
        description: "Multilingual",
        locale: "fr-FR",
        languages: ["*"],
        engineId: "supertonic",
        engineVoiceId: "F1",
        packId: "supertonic-multilingual",
        modelRevision: "supertonic-test"
      }
    ]
  };
}
