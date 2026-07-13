import { describe, expect, it } from "vitest";
import {
  FakeNarrationGateway,
  DEFAULT_NARRATION_VOICE_ID,
  type NarrationPreparationAdapter,
  type NarrationPreparationRequest,
  type PreparedNarration
} from "./index";
import { FakePassageNarrationAdapter, FakeSentenceBatchNarrationAdapter } from "./narration-fakes";
import { createNarrationAssetIdentity } from "./narration-identity";
import {
  createLatestNarrationPreparation,
  StaleNarrationPreparationError
} from "./narration-preparation";
import { PiperCompatibilityAdapter } from "./piper-compatibility";

describe("deterministic narration adapters", () => {
  it("builds repeatable passage and sentence-batch manifests", async () => {
    const passageAdapter = new FakePassageNarrationAdapter();
    const passageRequest = preparationRequest("kokoro");
    const first = await passageAdapter.prepare(passageRequest);
    const second = await passageAdapter.prepare(passageRequest);
    const batch = await new FakeSentenceBatchNarrationAdapter().prepare(
      preparationRequest("supertonic")
    );

    expect(first.sentences).toEqual(second.sentences);
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(first.sampleRate).toBe(24_000);
    expect(batch.sampleRate).toBe(44_100);
  });

  it("represents current Piper output as one complete sentence span", async () => {
    const adapter = new PiperCompatibilityAdapter(new FakeNarrationGateway());
    const narration = await adapter.prepare({
      ...preparationRequest("piper"),
      passage: { ...preparationRequest("piper").passage, sentences: [sentences[0]] },
      voiceId: DEFAULT_NARRATION_VOICE_ID
    });

    expect(narration.engineId).toBe("piper");
    expect(narration.sentences).toEqual([
      { sentenceId: "sentence-1", startSample: 0, endSample: narration.sampleCount }
    ]);
    expect(narration.sourceUrl).toMatch(/^data:audio\/wav/u);
  });
});

describe("narration asset identity", () => {
  it("includes synthesis inputs but ignores output-only playback controls", () => {
    const input = {
      schemaVersion: 3,
      engineId: "kokoro" as const,
      modelRevision: "model-a",
      voiceId: "voice-a",
      language: "en",
      sentences,
      synthesisParameters: { speed: 1, steps: 8 },
      sampleRate: 24_000,
      encodingRevision: "wav-v1"
    };
    const withPlaybackControls = { ...input, playbackRate: 1.5, volume: 0.2 };

    expect(createNarrationAssetIdentity(input)).toBe(
      createNarrationAssetIdentity(withPlaybackControls)
    );
    expect(createNarrationAssetIdentity({ ...input, modelRevision: "model-b" })).not.toBe(
      createNarrationAssetIdentity(input)
    );
    expect(
      createNarrationAssetIdentity({ ...input, sentences: [...sentences].reverse() })
    ).not.toBe(createNarrationAssetIdentity(input));
  });
});

describe("latest narration preparation", () => {
  it("rejects a stale result when a newer request wins", async () => {
    const pending = new ControlledNarrationAdapter();
    const latest = createLatestNarrationPreparation(pending);
    const first = latest.prepare(preparationRequest("kokoro", "request-1"));
    const second = latest.prepare(preparationRequest("kokoro", "request-2"));

    pending.resolve("request-1");
    pending.resolve("request-2");

    await expect(first).rejects.toBeInstanceOf(StaleNarrationPreparationError);
    await expect(second).resolves.toMatchObject({ assetId: "request-2" });
  });
});

const sentences = [
  { id: "sentence-1", index: 0, text: "One steady sentence." },
  { id: "sentence-2", index: 1, text: "Then another sentence follows." }
];

function preparationRequest(
  engineId: "piper" | "kokoro" | "supertonic",
  requestId = "request-1"
): NarrationPreparationRequest {
  return {
    requestId,
    passage: {
      id: "passage-1",
      bookId: "book-1",
      chapterId: "chapter-1",
      paragraphId: "paragraph-1",
      language: engineId === "supertonic" ? "fr" : "en",
      sentences
    },
    engineId,
    modelRevision: `${engineId}-test`,
    voiceId: `${engineId}:voice-test`,
    sourceTextDigest: "digest"
  };
}

class ControlledNarrationAdapter implements NarrationPreparationAdapter {
  private readonly pending = new Map<
    string,
    { request: NarrationPreparationRequest; resolve: (value: PreparedNarration) => void }
  >();

  prepare(request: NarrationPreparationRequest): Promise<PreparedNarration> {
    return new Promise((resolve) => this.pending.set(request.requestId, { request, resolve }));
  }

  resolve(requestId: string) {
    const pending = this.pending.get(requestId);
    if (pending == null) throw new Error(`Missing controlled request ${requestId}.`);
    pending.resolve({
      assetId: requestId,
      sourceUrl: "file:///controlled.wav",
      sampleRate: 24_000,
      sampleCount: 2,
      sentences: [
        { sentenceId: "sentence-1", startSample: 0, endSample: 1 },
        { sentenceId: "sentence-2", startSample: 1, endSample: 2 }
      ],
      cached: false,
      engineId: pending.request.engineId,
      modelRevision: pending.request.modelRevision,
      voiceId: pending.request.voiceId,
      sourceTextDigest: pending.request.sourceTextDigest
    });
  }
}
