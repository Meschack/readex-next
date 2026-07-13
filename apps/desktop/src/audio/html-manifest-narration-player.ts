import type {
  ManifestAwareNarrationPlayer,
  ManifestPlaybackHandlers,
  ManifestPlaybackInput,
  NarrationOutputSettings
} from "@sonelle/audio";
import type { EntityId } from "@sonelle/domain";
import type { HtmlAudioPlayer } from "./html-audio-player";

export function createHtmlManifestNarrationPlayer(
  htmlAudioPlayer: HtmlAudioPlayer
): ManifestAwareNarrationPlayer {
  let playbackRate = 1;
  let timers: ReturnType<typeof setTimeout>[] = [];

  const clearSentenceTimers = () => {
    for (const timer of timers) clearTimeout(timer);
    timers = [];
  };

  return {
    async play(input: ManifestPlaybackInput, handlers: ManifestPlaybackHandlers): Promise<void> {
      clearSentenceTimers();
      const startSpan = input.narration.sentences.find(
        (candidate) => candidate.sentenceId === input.startSentenceId
      );
      if (startSpan == null) throw new Error("Prepared narration cannot start at this sentence.");
      const stopSpan =
        input.stopAfterSentenceId == null
          ? input.narration.sentences[input.narration.sentences.length - 1]
          : input.narration.sentences.find(
              (candidate) => candidate.sentenceId === input.stopAfterSentenceId
            );
      if (stopSpan == null) throw new Error("Prepared narration cannot stop at this sentence.");
      if (stopSpan.endSample <= startSpan.startSample)
        throw new Error("Prepared narration has an invalid playback range.");

      scheduleSentenceEntries(
        playbackSpans(input.narration.sentences, input.startSentenceId, input.stopAfterSentenceId),
        startSpan.startSample,
        input.narration.sampleRate,
        playbackRate,
        handlers
      );

      try {
        await htmlAudioPlayer.play(input.narration.sourceUrl, {
          offsetSeconds: startSpan.startSample / input.narration.sampleRate,
          durationSeconds: (stopSpan.endSample - startSpan.startSample) / input.narration.sampleRate
        });
      } finally {
        clearSentenceTimers();
      }
    },

    setOutput(settings: NarrationOutputSettings): void {
      playbackRate = settings.playbackRate;
      htmlAudioPlayer.setPlaybackRate(settings.playbackRate);
      htmlAudioPlayer.setVolume(settings.volume);
    },

    stop(): void {
      clearSentenceTimers();
      htmlAudioPlayer.stop();
    }
  };

  function scheduleSentenceEntries(
    spans: readonly { sentenceId: EntityId; startSample: number }[],
    startSample: number,
    sampleRate: number,
    currentPlaybackRate: number,
    handlers: ManifestPlaybackHandlers
  ) {
    const rate = currentPlaybackRate > 0 ? currentPlaybackRate : 1;
    for (const span of spans) {
      const delayMs = Math.max(0, ((span.startSample - startSample) / sampleRate / rate) * 1_000);
      if (delayMs === 0) {
        handlers.sentenceEntered(span.sentenceId);
        continue;
      }

      timers.push(setTimeout(() => handlers.sentenceEntered(span.sentenceId), delayMs));
    }
  }
}

function playbackSpans(
  spans: ManifestPlaybackInput["narration"]["sentences"],
  startSentenceId: EntityId,
  stopAfterSentenceId: EntityId | null
) {
  const startIndex = spans.findIndex((span) => span.sentenceId === startSentenceId);
  if (startIndex < 0) return [];
  const stopIndex =
    stopAfterSentenceId == null
      ? spans.length - 1
      : spans.findIndex((span) => span.sentenceId === stopAfterSentenceId);
  if (stopIndex < startIndex) return [];
  return spans.slice(startIndex, stopIndex + 1);
}
