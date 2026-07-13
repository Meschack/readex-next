import { describe, expect, it, vi } from "vitest";
import { createHtmlManifestNarrationPlayer } from "./html-manifest-narration-player";
import type { HtmlAudioPlayer } from "./html-audio-player";

describe("HTML manifest narration player", () => {
  it("plays one-span compatibility manifests through the HTML audio player", async () => {
    const htmlAudioPlayer: HtmlAudioPlayer = {
      play: vi.fn().mockResolvedValue(undefined),
      setPlaybackRate: vi.fn(),
      setVolume: vi.fn(),
      stop: vi.fn()
    };
    const player = createHtmlManifestNarrationPlayer(htmlAudioPlayer);
    const sentenceEntered = vi.fn();

    player.setOutput({ playbackRate: 1.25, volume: 1.1 });
    await player.play(
      {
        narration: {
          assetId: "asset-1",
          sourceUrl: "asset://sentence",
          sampleRate: 1_000,
          sampleCount: 1_000,
          sentences: [{ sentenceId: "s1", startSample: 0, endSample: 1_000 }],
          cached: false,
          engineId: "piper",
          modelRevision: "piper-compat",
          voiceId: "en",
          sourceTextDigest: "digest"
        },
        startSentenceId: "s1",
        stopAfterSentenceId: "s1"
      },
      { sentenceEntered }
    );

    expect(htmlAudioPlayer.setPlaybackRate).toHaveBeenCalledWith(1.25);
    expect(htmlAudioPlayer.setVolume).toHaveBeenCalledWith(1.1);
    expect(sentenceEntered).toHaveBeenCalledWith("s1");
    expect(htmlAudioPlayer.play).toHaveBeenCalledWith("asset://sentence", {
      offsetSeconds: 0,
      durationSeconds: 1
    });
  });

  it("plays manifest ranges and emits sentence entries from sample timing", async () => {
    vi.useFakeTimers();
    const playback = deferred<void>();
    const htmlAudioPlayer: HtmlAudioPlayer = {
      play: vi.fn().mockReturnValue(playback.promise),
      setPlaybackRate: vi.fn(),
      setVolume: vi.fn(),
      stop: vi.fn()
    };
    const player = createHtmlManifestNarrationPlayer(htmlAudioPlayer);
    const sentenceEntered = vi.fn();

    player.setOutput({ playbackRate: 2, volume: 1 });
    const playing = player.play(
      {
        narration: {
          assetId: "asset-1",
          sourceUrl: "asset://passage",
          sampleRate: 1_000,
          sampleCount: 3_000,
          sentences: [
            { sentenceId: "s1", startSample: 0, endSample: 1_000 },
            { sentenceId: "s2", startSample: 1_000, endSample: 2_000 },
            { sentenceId: "s3", startSample: 2_000, endSample: 3_000 }
          ],
          cached: false,
          engineId: "kokoro",
          modelRevision: "kokoro",
          voiceId: "en",
          sourceTextDigest: "digest"
        },
        startSentenceId: "s2",
        stopAfterSentenceId: "s3"
      },
      { sentenceEntered }
    );

    expect(sentenceEntered).toHaveBeenCalledWith("s2");
    expect(sentenceEntered).not.toHaveBeenCalledWith("s3");
    expect(htmlAudioPlayer.play).toHaveBeenCalledWith("asset://passage", {
      offsetSeconds: 1,
      durationSeconds: 2
    });

    await vi.advanceTimersByTimeAsync(499);
    expect(sentenceEntered).not.toHaveBeenCalledWith("s3");
    await vi.advanceTimersByTimeAsync(1);
    expect(sentenceEntered).toHaveBeenCalledWith("s3");

    playback.resolve();
    await playing;
    vi.useRealTimers();
  });

  it("stops after the active sentence when auto-advance is off", async () => {
    const htmlAudioPlayer: HtmlAudioPlayer = {
      play: vi.fn().mockResolvedValue(undefined),
      setPlaybackRate: vi.fn(),
      setVolume: vi.fn(),
      stop: vi.fn()
    };
    const player = createHtmlManifestNarrationPlayer(htmlAudioPlayer);

    await player.play(
      {
        narration: {
          assetId: "asset-1",
          sourceUrl: "asset://passage",
          sampleRate: 1_000,
          sampleCount: 2_000,
          sentences: [
            { sentenceId: "s1", startSample: 0, endSample: 1_000 },
            { sentenceId: "s2", startSample: 1_000, endSample: 2_000 }
          ],
          cached: false,
          engineId: "kokoro",
          modelRevision: "kokoro",
          voiceId: "en",
          sourceTextDigest: "digest"
        },
        startSentenceId: "s1",
        stopAfterSentenceId: "s1"
      },
      { sentenceEntered: vi.fn() }
    );

    expect(htmlAudioPlayer.play).toHaveBeenCalledWith("asset://passage", {
      offsetSeconds: 0,
      durationSeconds: 1
    });
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}
