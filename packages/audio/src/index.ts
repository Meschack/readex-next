import type { SentenceRef } from "@readex/domain";

export type AudioReadiness = "ready" | "preparing" | "needs-attention" | "unavailable";

export interface SentenceAudio extends SentenceRef {
  readiness: AudioReadiness;
  durationSec: number | null;
  sourceUrl: string | null;
}
