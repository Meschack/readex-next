import { createPlayableAudioSource, type PlayableAudioSource } from "./playable-audio-source";

export interface HtmlAudioPlayer {
  play(sourceUrl: string): Promise<void>;
  setPlaybackRate(playbackRate: number): void;
  stop(): void;
}

export interface HtmlAudioPlayerOptions {
  createAudio?: (sourceUrl: string) => HTMLAudioElement;
  resolveSource?: (sourceUrl: string) => Promise<PlayableAudioSource>;
}

interface ActiveAudio {
  audio: HTMLAudioElement;
  finish(): void;
}

export function createHtmlAudioPlayer(options: HtmlAudioPlayerOptions = {}): HtmlAudioPlayer {
  const createAudio = options.createAudio ?? ((sourceUrl: string) => new Audio(sourceUrl));
  const resolveSource = options.resolveSource ?? createPlayableAudioSource;
  let active: ActiveAudio | null = null;
  let playbackRate = 1;
  let generation = 0;

  const stop = () => {
    generation += 1;
    const current = active;
    active = null;
    current?.audio.pause();
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

      await new Promise<void>((resolve, reject) => {
        const audio = createAudio(playableSource.url);
        let settled = false;
        const cleanUp = () => {
          audio.onended = null;
          audio.onerror = null;
          playableSource.dispose();
          if (active?.audio === audio) active = null;
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

        active = { audio, finish };
        audio.playbackRate = playbackRate;
        audio.onended = finish;
        audio.onerror = () => {
          const mediaError = audio.error;
          fail(
            new Error(
              mediaError == null
                ? "HTML audio emitted an unknown playback error."
                : `HTML audio failed with code ${mediaError.code}: ${mediaError.message || "No media error message."}`
            )
          );
        };
        audio.play().catch(fail);

        if (playGeneration !== generation) {
          audio.pause();
          finish();
        }
      });
    },
    setPlaybackRate(nextPlaybackRate) {
      playbackRate = nextPlaybackRate;
      if (active != null) active.audio.playbackRate = nextPlaybackRate;
    },
    stop
  };
}
