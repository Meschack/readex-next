import type {
  ManifestAwareNarrationPlayer,
  ManifestPlaybackHandlers,
  ManifestPlaybackInput,
  NarrationOutputSettings
} from "@sonelle/audio";
import type { HtmlAudioPlayer } from "./html-audio-player";

export function createHtmlManifestNarrationPlayer(
  htmlAudioPlayer: HtmlAudioPlayer
): ManifestAwareNarrationPlayer {
  return {
    async play(input: ManifestPlaybackInput, handlers: ManifestPlaybackHandlers): Promise<void> {
      const span = input.narration.sentences.find(
        (candidate) => candidate.sentenceId === input.startSentenceId
      );
      if (span == null) throw new Error("Prepared narration cannot start at this sentence.");
      if (
        input.stopAfterSentenceId != null &&
        input.stopAfterSentenceId !== input.startSentenceId
      ) {
        throw new Error("HTML compatibility playback can only stop at the active sentence.");
      }

      handlers.sentenceEntered(input.startSentenceId);
      await htmlAudioPlayer.play(input.narration.sourceUrl);
    },

    setOutput(settings: NarrationOutputSettings): void {
      htmlAudioPlayer.setPlaybackRate(settings.playbackRate);
      htmlAudioPlayer.setVolume(settings.volume);
    },

    stop(): void {
      htmlAudioPlayer.stop();
    }
  };
}
