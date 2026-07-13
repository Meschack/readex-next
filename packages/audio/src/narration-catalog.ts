import { normalizeLanguageCode } from "@sonelle/domain";
import type { NarrationEngineId } from "./narration-contracts";
import { routeNarrationEngine } from "./narration-routing";

export type NarrationArtifactRole =
  "runtime" | "model" | "voice" | "text-processing" | "config" | "license";

export interface NarrationPackArtifact {
  id: string;
  role: NarrationArtifactRole;
  fileName: string;
  sizeBytes: number;
  sha256: string;
  platform?: string;
}

export interface NarrationFilePack {
  id: string;
  engineId: NarrationEngineId;
  modelRevision: string;
  artifacts: readonly NarrationPackArtifact[];
}

export interface CatalogNarrationVoice {
  id: string;
  label: string;
  description: string;
  locale: string;
  languages: readonly string[];
  engineId: NarrationEngineId;
  engineVoiceId: string;
  packId: string;
  modelRevision: string;
}

export interface NarrationCatalog {
  schemaVersion: 1;
  defaultVoiceIds: Readonly<Record<string, string>>;
  packs: readonly NarrationFilePack[];
  voices: readonly CatalogNarrationVoice[];
}

export type NarrationCatalogIssue =
  | "unsupported-schema"
  | "duplicate-id"
  | "invalid-pack"
  | "invalid-artifact"
  | "invalid-voice"
  | "missing-pack"
  | "engine-mismatch"
  | "model-mismatch"
  | "invalid-default";

export interface NarrationCatalogValidation {
  valid: boolean;
  issues: readonly NarrationCatalogIssue[];
}

export function validateNarrationCatalog(catalog: NarrationCatalog): NarrationCatalogValidation {
  const issues = new Set<NarrationCatalogIssue>();
  if (catalog.schemaVersion !== 1) issues.add("unsupported-schema");

  const packs = new Map<string, NarrationFilePack>();
  for (const pack of catalog.packs) {
    if (packs.has(pack.id)) issues.add("duplicate-id");
    packs.set(pack.id, pack);
    if (
      pack.id.trim().length === 0 ||
      pack.modelRevision.trim().length === 0 ||
      pack.artifacts.length === 0
    ) {
      issues.add("invalid-pack");
    }

    const artifactIds = new Set<string>();
    for (const artifact of pack.artifacts) {
      if (artifactIds.has(artifact.id)) issues.add("duplicate-id");
      artifactIds.add(artifact.id);
      if (
        artifact.id.trim().length === 0 ||
        artifact.fileName.trim().length === 0 ||
        !Number.isInteger(artifact.sizeBytes) ||
        artifact.sizeBytes <= 0 ||
        !/^[a-f0-9]{64}$/u.test(artifact.sha256)
      ) {
        issues.add("invalid-artifact");
      }
    }
  }

  const voices = new Map<string, CatalogNarrationVoice>();
  for (const voice of catalog.voices) {
    if (voices.has(voice.id)) issues.add("duplicate-id");
    voices.set(voice.id, voice);
    if (
      voice.id.trim().length === 0 ||
      voice.label.trim().length === 0 ||
      voice.locale.trim().length === 0 ||
      voice.engineVoiceId.trim().length === 0 ||
      voice.modelRevision.trim().length === 0 ||
      voice.languages.length === 0
    ) {
      issues.add("invalid-voice");
    }
    const pack = packs.get(voice.packId);
    if (pack == null) {
      issues.add("missing-pack");
      continue;
    }
    if (pack.engineId !== voice.engineId) issues.add("engine-mismatch");
    if (pack.modelRevision !== voice.modelRevision) issues.add("model-mismatch");
  }

  for (const [language, voiceId] of Object.entries(catalog.defaultVoiceIds)) {
    const voice = voices.get(voiceId);
    const route = routeNarrationEngine(language === "*" ? null : language);
    if (
      voice == null ||
      voice.engineId !== route.engineId ||
      !voiceSupportsLanguage(voice, route.language)
    ) {
      issues.add("invalid-default");
    }
  }

  return { valid: issues.size === 0, issues: [...issues] };
}

export function resolveCatalogNarrationVoice(
  catalog: NarrationCatalog,
  language: string | null | undefined,
  preferences: Readonly<Record<string, string>> = {}
): CatalogNarrationVoice {
  const validation = validateNarrationCatalog(catalog);
  if (!validation.valid) {
    throw new Error(`Narration catalog is invalid: ${validation.issues.join(", ")}.`);
  }

  const route = routeNarrationEngine(language);
  const languageCode = normalizeLanguageCode(language) ?? "*";
  const preferredId = preferences[languageCode] ?? preferences["*"];
  const defaultId =
    catalog.defaultVoiceIds[languageCode] ??
    catalog.defaultVoiceIds[route.language] ??
    catalog.defaultVoiceIds["*"];
  const preferred = catalog.voices.find(
    (voice) =>
      voice.id === preferredId &&
      voice.engineId === route.engineId &&
      voiceSupportsLanguage(voice, route.language)
  );
  if (preferred != null) return preferred;

  const fallback = catalog.voices.find(
    (voice) =>
      voice.id === defaultId &&
      voice.engineId === route.engineId &&
      voiceSupportsLanguage(voice, route.language)
  );
  if (fallback != null) return fallback;

  throw new Error(`No narration voice is available for ${languageCode}.`);
}

function voiceSupportsLanguage(voice: CatalogNarrationVoice, language: string): boolean {
  const normalizedLanguage = normalizeLanguageCode(language) ?? language;
  return voice.languages.some(
    (supported) => supported === "*" || normalizeLanguageCode(supported) === normalizedLanguage
  );
}
