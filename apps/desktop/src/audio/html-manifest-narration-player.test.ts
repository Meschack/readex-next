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
    expect(htmlAudioPlayer.play).toHaveBeenCalledWith("asset://sentence");
  });

  it("rejects unsupported mid-passage stop requests", async () => {
    const player = createHtmlManifestNarrationPlayer({
      play: vi.fn().mockResolvedValue(undefined),
      setPlaybackRate: vi.fn(),
      setVolume: vi.fn(),
      stop: vi.fn()
    });

    await expect(
      player.play(
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
          stopAfterSentenceId: "s2"
        },
        { sentenceEntered: vi.fn() }
      )
    ).rejects.toThrow("HTML compatibility playback can only stop at the active sentence.");
  });
});
