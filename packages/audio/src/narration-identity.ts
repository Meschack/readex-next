import type { NarrationEngineId, NarrationSentence } from "./narration-contracts";

export interface NarrationAssetIdentityInput {
  schemaVersion: number;
  engineId: NarrationEngineId;
  modelRevision: string;
  voiceId: string;
  language: string;
  sentences: readonly Pick<NarrationSentence, "id" | "text">[];
  synthesisParameters?: Readonly<Record<string, string | number | boolean>>;
  sampleRate: number;
  encodingRevision: string;
}

export function createNarrationAssetIdentity(input: NarrationAssetIdentityInput): string {
  const synthesisParameters = Object.fromEntries(
    Object.entries(input.synthesisParameters ?? {}).sort(([first], [second]) =>
      first.localeCompare(second)
    )
  );
  return JSON.stringify({
    schemaVersion: input.schemaVersion,
    engineId: input.engineId,
    modelRevision: input.modelRevision,
    voiceId: input.voiceId,
    language: input.language,
    sentences: input.sentences.map((sentence) => ({
      id: sentence.id,
      text: normalizeNarrationIdentityText(sentence.text)
    })),
    synthesisParameters,
    sampleRate: input.sampleRate,
    encodingRevision: input.encodingRevision
  });
}

function normalizeNarrationIdentityText(text: string): string {
  return text.trim().replace(/\s+/gu, " ");
}
