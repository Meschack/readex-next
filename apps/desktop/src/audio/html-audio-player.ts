import { createPlayableAudioSource, type PlayableAudioSource } from "./playable-audio-source";

export interface HtmlAudioPlayer {
  play(sourceUrl: string): Promise<void>;
  setPlaybackRate(playbackRate: number): void;
  setVolume(volume: number): void;
  stop(): void;
}

export interface AudioPlaybackHandlers {
  ended(): void;
  failed(error: unknown): void;
}

export interface AudioPlayback {
  setPlaybackRate(playbackRate: number): void;
  setVolume(volume: number): void;
  start(handlers: AudioPlaybackHandlers): Promise<void>;
  stop(): void;
  dispose(): void;
}

export interface HtmlAudioPlayerOptions {
  resolveSource?: (sourceUrl: string) => Promise<PlayableAudioSource>;
  createPlayback?: (source: PlayableAudioSource) => Promise<AudioPlayback>;
}

export interface AudioBufferPlaybackFactoryOptions {
  createContext?: () => AudioContext | null;
  fetchSource?: typeof fetch;
}

interface ActiveAudio {
  playback: AudioPlayback;
  finish(): void;
}

export function createHtmlAudioPlayer(options: HtmlAudioPlayerOptions = {}): HtmlAudioPlayer {
  const resolveSource = options.resolveSource ?? createPlayableAudioSource;
  const createPlayback = options.createPlayback ?? createAudioBufferPlaybackFactory();
  let active: ActiveAudio | null = null;
  let playbackRate = 1;
  let volume = 1;
  let generation = 0;

  const stop = () => {
    generation += 1;
    const current = active;
    active = null;
    current?.playback.stop();
    current?.finish();
  };

  return {
    async play(sourceUrl) {
      stop();
      const playGeneration = generation;
      const playableSource = await resolveSource(sourceUrl);

      if (playGeneration !== generation) {
        playableSource.dispose();
        return;
      }

      let playback: AudioPlayback;
      try {
        playback = await createPlayback(playableSource);
      } catch (error) {
        playableSource.dispose();
        throw error;
      }

      if (playGeneration !== generation) {
        playback.dispose();
        playableSource.dispose();
        return;
      }

      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const cleanUp = () => {
          playback.dispose();
          playableSource.dispose();
          if (active?.playback === playback) active = null;
        };
        const finish = () => {
          if (settled) return;
          settled = true;
          cleanUp();
          resolve();
        };
        const fail = (error: unknown) => {
          if (settled) return;
          settled = true;
          cleanUp();
          reject(error);
        };

        active = { playback, finish };
        playback.setPlaybackRate(playbackRate);
        playback.setVolume(volume);
        playback.start({ ended: finish, failed: fail }).catch(fail);

        if (playGeneration !== generation) {
          playback.stop();
          finish();
        }
      });
    },
    setPlaybackRate(nextPlaybackRate) {
      playbackRate = nextPlaybackRate;
      active?.playback.setPlaybackRate(nextPlaybackRate);
    },
    setVolume(nextVolume) {
      volume = clampVolume(nextVolume);
      active?.playback.setVolume(volume);
    },
    stop
  };
}

export function createAudioBufferPlaybackFactory(
  options: AudioBufferPlaybackFactoryOptions = {}
): (source: PlayableAudioSource) => Promise<AudioPlayback> {
  let context: AudioContext | null = null;
  let output: GainNode | null = null;

  return async (source) => {
    context ??= options.createContext?.() ?? createAudioContext();
    if (context == null) return createElementAudioPlayback(source.url);

    if (output == null) {
      output = context.createGain();
      output.connect(context.destination);
    }

    const encodedAudio = source.data ?? (await fetchAudioData(source.url, options.fetchSource));
    const buffer = await context.decodeAudioData(encodedAudio.slice(0));
    const bufferSource = context.createBufferSource();
    let handlers: AudioPlaybackHandlers | null = null;
    let started = false;
    let stopped = false;
    let disposed = false;

    bufferSource.buffer = buffer;
    bufferSource.connect(output);
    bufferSource.onended = () => {
      if (stopped || disposed) return;
      handlers?.ended();
    };

    return {
      setPlaybackRate(playbackRate) {
        bufferSource.playbackRate.value = playbackRate;
      },
      setVolume(volume) {
        if (output != null) output.gain.value = clampVolume(volume);
      },
      async start(nextHandlers) {
        handlers = nextHandlers;
        try {
          if (context?.state === "suspended") await context.resume();
          if (stopped || disposed) return;
          started = true;
          bufferSource.start();
        } catch (error) {
          nextHandlers.failed(error);
        }
      },
      stop() {
        if (stopped || disposed) return;
        stopped = true;
        handlers = null;
        if (!started) return;
        try {
          bufferSource.stop();
        } catch {
          // The source may have reached its natural end between the state check and stop().
        }
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        handlers = null;
        bufferSource.onended = null;
        bufferSource.disconnect();
      }
    };
  };
}

function createAudioContext(): AudioContext | null {
  const AudioContextConstructor = globalThis.AudioContext;
  return AudioContextConstructor == null ? null : new AudioContextConstructor();
}

async function fetchAudioData(
  sourceUrl: string,
  fetchSource: typeof fetch = fetch
): Promise<ArrayBuffer> {
  const response = await fetchSource(sourceUrl);
  if (!response.ok) throw new Error("We couldn't open prepared narration. Please try again.");
  return response.arrayBuffer();
}

function createElementAudioPlayback(sourceUrl: string): AudioPlayback {
  const audio = new Audio(sourceUrl);

  return {
    setPlaybackRate(playbackRate) {
      audio.playbackRate = playbackRate;
    },
    setVolume(volume) {
      audio.volume = Math.min(1, clampVolume(volume));
    },
    async start(handlers) {
      audio.onended = handlers.ended;
      audio.onerror = () => handlers.failed(mediaPlaybackError(audio));
      await audio.play();
    },
    stop() {
      audio.pause();
    },
    dispose() {
      audio.onended = null;
      audio.onerror = null;
    }
  };
}

function mediaPlaybackError(audio: HTMLAudioElement): Error {
  const mediaError = audio.error;
  if (mediaError == null) return new Error("HTML audio emitted an unknown playback error.");

  return new Error(
    `HTML audio failed with code ${mediaError.code}: ${mediaError.message || "No media error message."}`
  );
}

function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) return 1;
  return Math.min(1.5, Math.max(0, volume));
}
