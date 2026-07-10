import { describe, expect, it, vi } from "vitest";
import { createHtmlAudioPlayer } from "./html-audio-player";

function createAudioDouble() {
  return {
    error: null,
    onended: null,
    onerror: null,
    pause: vi.fn(),
    play: vi.fn().mockResolvedValue(undefined),
    playbackRate: 1
  } as unknown as HTMLAudioElement;
}

describe("HTML audio player", () => {
  it("owns playback rate and disposable source lifecycle", async () => {
    const audio = createAudioDouble();
    const dispose = vi.fn();
    const player = createHtmlAudioPlayer({
      createAudio: () => audio,
      resolveSource: vi.fn().mockResolvedValue({ url: "blob:audio", dispose })
    });

    player.setPlaybackRate(1.25);
    const playback = player.play("asset://sentence");
    await Promise.resolve();

    expect(audio.playbackRate).toBe(1.25);
    expect(audio.play).toHaveBeenCalledOnce();

    audio.onended?.(new Event("ended"));
    await playback;
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("stops active playback and resolves its pending play", async () => {
    const audio = createAudioDouble();
    const player = createHtmlAudioPlayer({
      createAudio: () => audio,
      resolveSource: vi.fn().mockResolvedValue({ url: "blob:audio", dispose: vi.fn() })
    });

    const playback = player.play("asset://sentence");
    await Promise.resolve();
    player.stop();
    await playback;

    expect(audio.pause).toHaveBeenCalledOnce();
  });
});
