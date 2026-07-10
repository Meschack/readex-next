import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import {
  FakeNarrationGateway,
  type NarrationGateway,
  type NarrationPlaybackMode,
  type SentenceNarration
} from "@sonelle/audio";

interface NarrationDevelopmentErrorContext {
  stage: "prepare" | "playback" | "prefetch" | "stop";
  sentenceId: string;
  voiceId: string;
  playbackMode?: NarrationPlaybackMode | null;
}

export function createNarrationRepository(): NarrationGateway {
  return isTauriRuntime() ? nativeNarrationRepository : new FakeNarrationGateway();
}

const nativeNarrationRepository: NarrationGateway = {
  async prepareSentenceAudio(request) {
    const narration = await invoke<SentenceNarration>("prepare_sentence_audio", { request });
    return {
      ...narration,
      sourceUrl: narration.sourceUrl == null ? null : convertFileSrc(narration.sourceUrl, "asset")
    };
  },

  async playPreparedSentenceAudio(request, narration) {
    if (narration.playbackMode === "native-speech") {
      await invoke("play_sentence_audio", { request });
    }
  },

  async stopPreparedSentenceAudio() {
    await invoke("stop_sentence_audio");
  }
};

export function toFriendlyNarrationError(error: unknown): string {
  if (typeof error === "string" && error.trim().length > 0) return error;
  if (error instanceof Error && error.message.trim().length > 0) return error.message;

  return "Narration needs attention. Please try again.";
}

export function reportNarrationDevelopmentError(
  error: unknown,
  context: NarrationDevelopmentErrorContext
) {
  if (!import.meta.env.DEV) return;

  const message = toFriendlyNarrationError(error);
  const detail = [
    `stage=${context.stage}`,
    `sentenceId=${context.sentenceId}`,
    `voiceId=${context.voiceId}`,
    `playbackMode=${context.playbackMode ?? "unknown"}`,
    `error=${message}`
  ].join(" ");

  console.error(`[sonelle][audio][${context.stage}] ${message}`, error, context);
  if (!isTauriRuntime()) return;

  void invoke("report_development_error", {
    scope: `audio.${context.stage}`,
    message: detail
  }).catch((reportingError) => {
    console.error("[sonelle][audio][reporting] Could not forward the error.", reportingError);
  });
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
