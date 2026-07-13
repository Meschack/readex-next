import { describe, expect, it } from "vitest";
import {
  createAudioSettings,
  createPrefetchingNarrationGateway,
  DEFAULT_NARRATION_VOICE_ID,
  FakeNarrationGateway,
  estimateSentenceDurationSec,
  parseAudioSettings,
  resolveNarrationVoiceForLanguage,
  serializeAudioSettings,
  type NarrationGateway,
  type SentenceNarration,
  type SentenceNarrationRequest
} from "./index";

describe("sentence narration", () => {
  it("keeps fake narration deterministic and cached for tests", async () => {
    const gateway = new FakeNarrationGateway();
    const request = {
      bookId: "book",
      chapterId: "chapter",
      sentenceId: "sentence",
      sentenceIndex: 0,
      voiceId: DEFAULT_NARRATION_VOICE_ID,
      text: "Hello reader."
    };

    const first = await gateway.prepareSentenceAudio(request);
    const second = await gateway.prepareSentenceAudio(request);

    expect(first).toMatchObject({
      readiness: "ready",
      playbackMode: "html-audio",
      cached: false
    });
    expect(second.cached).toBe(true);
    expect(second.sourceUrl).toBe(first.sourceUrl);
  });

  it("estimates sentence duration without exposing timing internals", () => {
    expect(estimateSentenceDurationSec("One two three.")).toBeGreaterThan(1);
  });

  it("keeps audio settings inside supported playback behavior", () => {
    expect(createAudioSettings({ playbackRate: 8, autoAdvance: false })).toEqual({
      playbackRate: 1.5,
      volume: 1.2,
      voiceId: DEFAULT_NARRATION_VOICE_ID,
      autoAdvance: false
    });
    expect(parseAudioSettings("{nope")).toEqual({
      playbackRate: 0.9,
      volume: 1.2,
      voiceId: DEFAULT_NARRATION_VOICE_ID,
      autoAdvance: true
    });
    expect(
      parseAudioSettings(
        serializeAudioSettings({
          playbackRate: 0.9,
          volume: 0.75,
          voiceId: "en_GB-alba-medium",
          autoAdvance: false
        })
      )
    ).toEqual({
      playbackRate: 0.9,
      volume: 0.75,
      voiceId: "en_GB-alba-medium",
      autoAdvance: false
    });
    expect(createAudioSettings({ voiceId: "nope" })).toEqual({
      playbackRate: 0.9,
      volume: 1.2,
      voiceId: DEFAULT_NARRATION_VOICE_ID,
      autoAdvance: true
    });
    expect(createAudioSettings({ volume: -4 }).volume).toBe(0);
    expect(createAudioSettings({ volume: 8 }).volume).toBe(1.5);
  });

  it("matches the persisted voice to the active book language", () => {
    expect(resolveNarrationVoiceForLanguage("fr-FR", "en_US-amy-medium")).toBe(
      "fr_FR-siwis-medium"
    );
    expect(resolveNarrationVoiceForLanguage("en-GB", "en_US-amy-medium")).toBe("en_US-amy-medium");
    expect(resolveNarrationVoiceForLanguage("en", "en_GB-alba-medium")).toBe("en_GB-alba-medium");
    expect(resolveNarrationVoiceForLanguage(null, "fr_FR-siwis-medium")).toBe("fr_FR-siwis-medium");
  });

  it("reuses prefetched narration instead of preparing the same sentence twice", async () => {
    const gateway = new CountingNarrationGateway();
    const prefetching = createPrefetchingNarrationGateway(gateway);
    const request = createRequest("sentence-1");

    await prefetching.prefetchSentenceAudio(request);
    const narration = await prefetching.prepareSentenceAudio(request);

    expect(narration.sentenceId).toBe("sentence-1");
    expect(gateway.prepareCount).toBe(1);
  });

  it("drops old prefetched narrations when the in-memory window is full", async () => {
    const gateway = new CountingNarrationGateway();
    const prefetching = createPrefetchingNarrationGateway(gateway, { maxEntries: 1 });
    const first = createRequest("sentence-1");
    const second = createRequest("sentence-2");

    await prefetching.prefetchSentenceAudio(first);
    await prefetching.prefetchSentenceAudio(second);
    await prefetching.prepareSentenceAudio(first);

    expect(gateway.prepareCount).toBe(3);
  });
});

class CountingNarrationGateway implements NarrationGateway {
  prepareCount = 0;

  async prepareSentenceAudio(request: SentenceNarrationRequest): Promise<SentenceNarration> {
    this.prepareCount += 1;

    return {
      bookId: request.bookId,
      chapterId: request.chapterId,
      sentenceId: request.sentenceId,
      readiness: "ready",
      durationSec: 1,
      sourceUrl: "data:audio/wav;base64,UklGRg==",
      playbackMode: "html-audio",
      cached: false,
      message: null
    };
  }

  async playPreparedSentenceAudio(): Promise<void> {
    return undefined;
  }

  async stopPreparedSentenceAudio(): Promise<void> {
    return undefined;
  }
}

function createRequest(sentenceId: string): SentenceNarrationRequest {
  return {
    bookId: "book",
    chapterId: "chapter",
    sentenceId,
    sentenceIndex: Number(sentenceId.split("-").at(-1) ?? 0),
    voiceId: DEFAULT_NARRATION_VOICE_ID,
    text: sentenceId
  };
}
