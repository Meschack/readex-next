import type { NarrationSentence, PreparedNarration } from "./narration-contracts";

export type NarrationManifestIssue =
  "invalid-audio" | "missing-sentence" | "unexpected-sentence" | "invalid-span" | "timeline-gap";

export interface NarrationManifestValidation {
  valid: boolean;
  issues: readonly NarrationManifestIssue[];
}

export class InvalidNarrationManifestError extends Error {
  readonly issues: readonly NarrationManifestIssue[];

  constructor(issues: readonly NarrationManifestIssue[]) {
    super(`Prepared narration manifest is invalid: ${issues.join(", ")}.`);
    this.name = "InvalidNarrationManifestError";
    this.issues = issues;
  }
}

export function validatePreparedNarration(
  narration: PreparedNarration,
  requestedSentences: readonly Pick<NarrationSentence, "id">[]
): NarrationManifestValidation {
  const issues = new Set<NarrationManifestIssue>();

  if (
    narration.assetId.trim().length === 0 ||
    narration.sourceUrl.trim().length === 0 ||
    narration.modelRevision.trim().length === 0 ||
    narration.voiceId.trim().length === 0 ||
    narration.sourceTextDigest.trim().length === 0 ||
    !Number.isInteger(narration.sampleRate) ||
    narration.sampleRate <= 0 ||
    !Number.isInteger(narration.sampleCount) ||
    narration.sampleCount <= 0
  ) {
    issues.add("invalid-audio");
  }

  if (narration.sentences.length < requestedSentences.length) issues.add("missing-sentence");
  if (narration.sentences.length > requestedSentences.length) issues.add("unexpected-sentence");

  let expectedStartSample = 0;
  const count = Math.max(narration.sentences.length, requestedSentences.length);
  for (let index = 0; index < count; index += 1) {
    const span = narration.sentences[index];
    const requested = requestedSentences[index];
    if (span == null || requested == null) continue;
    if (span.sentenceId !== requested.id) {
      issues.add("missing-sentence");
      issues.add("unexpected-sentence");
    }
    if (
      !Number.isInteger(span.startSample) ||
      !Number.isInteger(span.endSample) ||
      span.startSample < 0 ||
      span.endSample <= span.startSample ||
      span.endSample > narration.sampleCount
    ) {
      issues.add("invalid-span");
    }
    if (span.startSample !== expectedStartSample) issues.add("timeline-gap");
    expectedStartSample = span.endSample;
  }

  if (expectedStartSample !== narration.sampleCount) issues.add("timeline-gap");
  return { valid: issues.size === 0, issues: [...issues] };
}

export function assertPreparedNarration(
  narration: PreparedNarration,
  requestedSentences: readonly Pick<NarrationSentence, "id">[]
): PreparedNarration {
  const validation = validatePreparedNarration(narration, requestedSentences);
  if (!validation.valid) throw new InvalidNarrationManifestError(validation.issues);
  return narration;
}
