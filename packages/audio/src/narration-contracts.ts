import type { EntityId } from "@sonelle/domain";

export type NarrationEngineId = "piper" | "kokoro" | "supertonic";
export type NarrationPreparationKind = "passage" | "sentence-batch";

export interface NarrationSentence {
  id: EntityId;
  index: number;
  text: string;
}

export interface NarrationParagraphRange {
  id: EntityId;
  index: number;
  startSentenceIndex: number;
  endSentenceIndex: number;
}

export interface NarrationChapterOutline {
  bookId: EntityId;
  chapterId: EntityId;
  language: string | null;
  sentences: readonly NarrationSentence[];
  paragraphs: readonly NarrationParagraphRange[];
}

export interface NarrationPassage {
  id: EntityId;
  bookId: EntityId;
  chapterId: EntityId;
  paragraphId: EntityId;
  language: string | null;
  sentences: readonly NarrationSentence[];
}

export interface NarrationSentenceSpan {
  sentenceId: EntityId;
  startSample: number;
  endSample: number;
}

export interface PreparedNarration {
  assetId: EntityId;
  sourceUrl: string;
  sampleRate: number;
  sampleCount: number;
  sentences: readonly NarrationSentenceSpan[];
  cached: boolean;
  engineId: NarrationEngineId;
  modelRevision: string;
  voiceId: string;
  sourceTextDigest: string;
}

export interface NarrationPreparationRequest {
  requestId: EntityId;
  passage: NarrationPassage;
  engineId: NarrationEngineId;
  modelRevision: string;
  voiceId: string;
  sourceTextDigest: string;
  synthesisParameters?: Readonly<Record<string, string | number | boolean>>;
}

export interface NarrationPreparationAdapter {
  prepare(request: NarrationPreparationRequest, signal?: AbortSignal): Promise<PreparedNarration>;
}
