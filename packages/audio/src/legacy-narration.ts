import type { SentenceRef } from "@sonelle/domain";

export type NarrationPlaybackMode = "html-audio" | "native-speech";
export type AudioReadiness = "ready" | "preparing" | "needs-attention" | "unavailable";

export interface SentenceAudio extends SentenceRef {
  readiness: AudioReadiness;
  durationSec: number | null;
  sourceUrl: string | null;
}

export interface SentenceNarration extends SentenceAudio {
  playbackMode: NarrationPlaybackMode;
  cached: boolean;
  message: string | null;
}

export interface SentenceNarrationRequest extends SentenceRef {
  sentenceIndex: number;
  text: string;
  voiceId: string;
}

export interface NarrationGateway {
  prepareSentenceAudio(request: SentenceNarrationRequest): Promise<SentenceNarration>;
  playPreparedSentenceAudio(
    request: SentenceNarrationRequest,
    narration: SentenceNarration
  ): Promise<void>;
  stopPreparedSentenceAudio(): Promise<void>;
}

export interface PrefetchingNarrationGateway extends NarrationGateway {
  prefetchSentenceAudio(request: SentenceNarrationRequest): Promise<void>;
  clearPrefetchedNarrations(): void;
}
