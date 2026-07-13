import type { EntityId } from "@sonelle/domain";
import type { PreparedNarration } from "./narration-contracts";

export interface NarrationOutputSettings {
  playbackRate: number;
  volume: number;
}

export interface ManifestPlaybackInput {
  narration: PreparedNarration;
  startSentenceId: EntityId;
  stopAfterSentenceId: EntityId | null;
}

export interface ManifestPlaybackHandlers {
  sentenceEntered(sentenceId: EntityId): void;
}

export interface ManifestAwareNarrationPlayer {
  play(input: ManifestPlaybackInput, handlers: ManifestPlaybackHandlers): Promise<void>;
  setOutput(settings: NarrationOutputSettings): void;
  stop(): void;
}

export class FakeManifestNarrationPlayer implements ManifestAwareNarrationPlayer {
  private output: NarrationOutputSettings = { playbackRate: 1, volume: 1 };
  private generation = 0;

  readonly played: ManifestPlaybackInput[] = [];

  async play(input: ManifestPlaybackInput, handlers: ManifestPlaybackHandlers): Promise<void> {
    const run = ++this.generation;
    this.played.push(input);

    const startIndex = input.narration.sentences.findIndex(
      (span) => span.sentenceId === input.startSentenceId
    );
    if (startIndex < 0) throw new Error("Prepared narration cannot start at this sentence.");

    for (let index = startIndex; index < input.narration.sentences.length; index += 1) {
      if (run !== this.generation) return;

      const sentenceId = input.narration.sentences[index].sentenceId;
      handlers.sentenceEntered(sentenceId);
      await Promise.resolve();

      if (input.stopAfterSentenceId === sentenceId) return;
    }
  }

  setOutput(settings: NarrationOutputSettings): void {
    this.output = { ...settings };
  }

  getOutput(): NarrationOutputSettings {
    return { ...this.output };
  }

  stop(): void {
    this.generation += 1;
  }
}
