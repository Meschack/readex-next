import { normalizeLanguageCode } from "@sonelle/domain";
import type { NarrationEngineId, NarrationPreparationKind } from "./narration-contracts";

export interface NarrationEngineRoute {
  engineId: NarrationEngineId;
  preparationKind: NarrationPreparationKind;
  language: string;
}

const supertonicLanguages = new Set([
  "ar",
  "bg",
  "cs",
  "da",
  "de",
  "el",
  "es",
  "et",
  "fi",
  "fr",
  "hi",
  "hr",
  "hu",
  "id",
  "it",
  "ja",
  "ko",
  "lt",
  "lv",
  "nl",
  "pl",
  "pt",
  "ro",
  "ru",
  "sk",
  "sl",
  "sv",
  "tr",
  "uk",
  "vi"
]);

export function routeNarrationEngine(language: string | null | undefined): NarrationEngineRoute {
  const normalizedLanguage = normalizeLanguageCode(language);
  if (normalizedLanguage === "en") {
    return { engineId: "kokoro", preparationKind: "passage", language: "en" };
  }

  return {
    engineId: "supertonic",
    preparationKind: "sentence-batch",
    language:
      normalizedLanguage != null && supertonicLanguages.has(normalizedLanguage)
        ? normalizedLanguage
        : "na"
  };
}

export function isSupertonicLanguage(language: string): boolean {
  return language === "na" || supertonicLanguages.has(language);
}
