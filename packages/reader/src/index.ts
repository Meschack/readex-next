import type { SentenceRef } from "@readex/domain";

export interface ReaderPosition extends SentenceRef {
  offsetSec: number;
}

export interface HighlightState {
  activeSentenceId: string | null;
}

export function highlightSentence(sentenceId: string | null): HighlightState {
  return { activeSentenceId: sentenceId };
}
