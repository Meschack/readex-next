import type { NarrationGateway, SentenceNarrationRequest } from "./legacy-narration";
import type {
  NarrationPreparationAdapter,
  NarrationPreparationRequest,
  PreparedNarration
} from "./narration-contracts";
import { assertPreparedNarration } from "./narration-manifest";

const compatibilitySampleRate = 1_000;

export class PiperCompatibilityAdapter implements NarrationPreparationAdapter {
  constructor(private readonly gateway: NarrationGateway) {}

  async prepare(
    request: NarrationPreparationRequest,
    signal?: AbortSignal
  ): Promise<PreparedNarration> {
    if (request.engineId !== "piper")
      throw new Error("Piper received a request for another engine.");
    if (request.passage.sentences.length !== 1) {
      throw new Error("Piper compatibility prepares exactly one sentence at a time.");
    }
    throwIfAborted(signal);

    const sentence = request.passage.sentences[0];
    const legacyRequest: SentenceNarrationRequest = {
      bookId: request.passage.bookId,
      chapterId: request.passage.chapterId,
      sentenceId: sentence.id,
      sentenceIndex: sentence.index,
      voiceId: request.voiceId,
      text: sentence.text
    };
    const legacy = await this.gateway.prepareSentenceAudio(legacyRequest);
    throwIfAborted(signal);
    if (
      legacy.readiness !== "ready" ||
      legacy.sourceUrl == null ||
      legacy.durationSec == null ||
      legacy.durationSec <= 0
    ) {
      throw new Error(legacy.message ?? "Piper narration needs attention.");
    }

    const sampleCount = Math.max(1, Math.round(legacy.durationSec * compatibilitySampleRate));
    return assertPreparedNarration(
      {
        assetId: [
          "piper",
          request.passage.bookId,
          sentence.id,
          request.voiceId,
          request.modelRevision,
          request.sourceTextDigest
        ].join(":"),
        sourceUrl: legacy.sourceUrl,
        sampleRate: compatibilitySampleRate,
        sampleCount,
        sentences: [{ sentenceId: sentence.id, startSample: 0, endSample: sampleCount }],
        cached: legacy.cached,
        engineId: "piper",
        modelRevision: request.modelRevision,
        voiceId: request.voiceId,
        sourceTextDigest: request.sourceTextDigest
      },
      request.passage.sentences
    );
  }
}

function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted)
    throw signal.reason ?? new DOMException("Preparation cancelled.", "AbortError");
}
