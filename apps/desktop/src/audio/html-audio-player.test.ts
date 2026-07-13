import { describe, expect, it, vi } from "vitest";
import {
  createAudioBufferPlaybackFactory,
  createHtmlAudioPlayer,
  type AudioPlayback,
  type AudioPlaybackHandlers
} from "./html-audio-player";

function createPlaybackDouble() {
  let handlers: AudioPlaybackHandlers | null = null;
  const playback: AudioPlayback = {
    setPlaybackRate: vi.fn(),
    setVolume: vi.fn(),
    start: vi.fn(async (nextHandlers) => {
      handlers = nextHandlers;
    }),
    stop: vi.fn(),
    dispose: vi.fn()
  };

  return {
    playback,
    end: () => handlers?.ended(),
    fail: (error: unknown) => handlers?.failed(error)
  };
}

function createBufferSourceDouble() {
  return {
    buffer: null,
    connect: vi.fn(),
    disconnect: vi.fn(),
    onended: null,
    playbackRate: { value: 1 },
    start: vi.fn(),
    stop: vi.fn()
  } as unknown as AudioBufferSourceNode;
}

describe("sentence audio player", () => {
  it("plays decoded buffers through one persistent output bus", async () => {
    const firstSource = createBufferSourceDouble();
    const secondSource = createBufferSourceDouble();
    const output = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      gain: { value: 1 }
    } as unknown as GainNode;
    const context = {
      createBufferSource: vi
        .fn()
        .mockReturnValueOnce(firstSource)
        .mockReturnValueOnce(secondSource),
      createGain: vi.fn().mockReturnValue(output),
      decodeAudioData: vi.fn().mockResolvedValue({}),
      destination: {},
      resume: vi.fn().mockResolvedValue(undefined),
      state: "running"
    } as unknown as AudioContext;
    const createPlayback = createAudioBufferPlaybackFactory({ createContext: () => context });
    const preparedSource = {
      url: "blob:audio",
      data: new ArrayBuffer(4),
      dispose: vi.fn()
    };

    const first = await createPlayback(preparedSource);
    const second = await createPlayback(preparedSource);
    const ended = vi.fn();
    await first.start({ ended, failed: vi.fn() });
    (firstSource.onended as EventListener | null)?.(new Event("ended"));
    first.dispose();

    expect(firstSource.start).toHaveBeenCalledOnce();
    expect(ended).toHaveBeenCalledOnce();
    expect(firstSource.disconnect).toHaveBeenCalledOnce();
    expect(context.createGain).toHaveBeenCalledOnce();
    expect(output.connect).toHaveBeenCalledOnce();
    expect(output.disconnect).not.toHaveBeenCalled();

    second.dispose();
    expect(secondSource.disconnect).toHaveBeenCalledOnce();
    expect(output.disconnect).not.toHaveBeenCalled();
  });

  it("starts decoded playback at the requested offset and duration", async () => {
    const source = createBufferSourceDouble();
    const output = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      gain: { value: 1 }
    } as unknown as GainNode;
    const context = {
      createBufferSource: vi.fn().mockReturnValue(source),
      createGain: vi.fn().mockReturnValue(output),
      decodeAudioData: vi.fn().mockResolvedValue({}),
      destination: {},
      resume: vi.fn().mockResolvedValue(undefined),
      state: "running"
    } as unknown as AudioContext;
    const createPlayback = createAudioBufferPlaybackFactory({ createContext: () => context });

    const playback = await createPlayback({
      url: "blob:audio",
      data: new ArrayBuffer(4),
      dispose: vi.fn()
    });
    await playback.start(
      { ended: vi.fn(), failed: vi.fn() },
      { offsetSeconds: 1.25, durationSeconds: 2.5 }
    );

    expect(source.start).toHaveBeenCalledWith(0, 1.25, 2.5);
  });

  it("waits for decoded playback to consume the complete audio buffer", async () => {
    const decoded = createPlaybackDouble();
    const disposeSource = vi.fn();
    const player = createHtmlAudioPlayer({
      resolveSource: vi
        .fn()
        .mockResolvedValue({ url: "blob:audio", data: new ArrayBuffer(4), dispose: disposeSource }),
      createPlayback: vi.fn().mockResolvedValue(decoded.playback)
    });

    player.setPlaybackRate(1.25);
    player.setVolume(1.2);
    let playbackFinished = false;
    const playback = player.play("asset://sentence").then(() => {
      playbackFinished = true;
    });
    await vi.waitFor(() => expect(decoded.playback.start).toHaveBeenCalledOnce());

    expect(decoded.playback.setPlaybackRate).toHaveBeenCalledWith(1.25);
    expect(decoded.playback.setVolume).toHaveBeenCalledWith(1.2);
    expect(playbackFinished).toBe(false);

    player.setVolume(0.65);
    expect(decoded.playback.setVolume).toHaveBeenLastCalledWith(0.65);

    decoded.end();
    await playback;
    expect(playbackFinished).toBe(true);
    expect(decoded.playback.dispose).toHaveBeenCalledOnce();
    expect(disposeSource).toHaveBeenCalledOnce();
  });

  it("stops active playback and resolves its pending play", async () => {
    const decoded = createPlaybackDouble();
    const disposeSource = vi.fn();
    const player = createHtmlAudioPlayer({
      resolveSource: vi.fn().mockResolvedValue({ url: "blob:audio", dispose: disposeSource }),
      createPlayback: vi.fn().mockResolvedValue(decoded.playback)
    });

    const playback = player.play("asset://sentence");
    await vi.waitFor(() => expect(decoded.playback.start).toHaveBeenCalledOnce());
    player.stop();
    await playback;

    expect(decoded.playback.stop).toHaveBeenCalledOnce();
    expect(decoded.playback.dispose).toHaveBeenCalledOnce();
    expect(disposeSource).toHaveBeenCalledOnce();
  });

  it("rejects playback errors and releases its resources", async () => {
    const decoded = createPlaybackDouble();
    const disposeSource = vi.fn();
    const player = createHtmlAudioPlayer({
      resolveSource: vi.fn().mockResolvedValue({ url: "blob:audio", dispose: disposeSource }),
      createPlayback: vi.fn().mockResolvedValue(decoded.playback)
    });

    const playback = player.play("asset://sentence");
    await vi.waitFor(() => expect(decoded.playback.start).toHaveBeenCalledOnce());
    decoded.fail(new Error("decoder failed"));

    await expect(playback).rejects.toThrow("decoder failed");
    expect(decoded.playback.dispose).toHaveBeenCalledOnce();
    expect(disposeSource).toHaveBeenCalledOnce();
  });
});
