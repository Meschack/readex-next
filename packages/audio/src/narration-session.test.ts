import { describe, expect, it } from "vitest";
import type { AnyDomainEvent } from "@sonelle/domain";
import { FakePassageNarrationAdapter } from "./narration-fakes";
import { createNarrationChapterOutline } from "./narration-outline";
import { FakeManifestNarrationPlayer } from "./narration-player";
import { createNarrationSession } from "./narration-session";

describe("narration session", () => {
  it("projects passage readiness, sentence entry, and chapter end from manifests", async () => {
    const events: AnyDomainEvent[] = [];
    const player = new FakeManifestNarrationPlayer();
    const session = createNarrationSession({
      adapter: new FakePassageNarrationAdapter(),
      player,
      onEvent: (event) => events.push(event),
      createRequestId: createIncrementingIds()
    });

    session.open({
      outline: createOutline(),
      engineId: "kokoro",
      modelRevision: "fake-kokoro",
      voiceId: "kokoro-en"
    });
    session.setOutput({ playbackRate: 1.1, volume: 0.8, autoAdvance: true });

    await session.play("s2");

    expect(events.map((event) => event.name)).toEqual([
      "PassageNarrationReady",
      "NarrationSentenceEntered",
      "PassageNarrationReady",
      "NarrationSentenceEntered",
      "NarrationPlaybackEnded"
    ]);
    expect(events[0].payload).toMatchObject({
      passageId: "chapter-1:p1:passage-1",
      firstSentenceId: "s1",
      lastSentenceId: "s2",
      source: "prepared"
    });
    expect(events[1].payload).toMatchObject({ sentenceId: "s2" });
    expect(events[2].payload).toMatchObject({
      passageId: "chapter-1:p2:passage-1",
      firstSentenceId: "s3",
      lastSentenceId: "s3"
    });
    expect(events[4].payload).toMatchObject({
      passageId: "chapter-1:p2:passage-1",
      lastSentenceId: "s3"
    });
    expect(player.getOutput()).toEqual({ playbackRate: 1.1, volume: 0.8 });
  });

  it("stops at the requested sentence when auto-advance is off", async () => {
    const events: AnyDomainEvent[] = [];
    const session = createNarrationSession({
      adapter: new FakePassageNarrationAdapter(),
      player: new FakeManifestNarrationPlayer(),
      onEvent: (event) => events.push(event),
      createRequestId: createIncrementingIds()
    });

    session.open({
      outline: createOutline(),
      engineId: "kokoro",
      modelRevision: "fake-kokoro",
      voiceId: "kokoro-en"
    });
    session.setOutput({ playbackRate: 1, volume: 1, autoAdvance: false });

    await session.play("s1");

    expect(events.map((event) => event.name)).toEqual([
      "PassageNarrationReady",
      "NarrationSentenceEntered",
      "NarrationPlaybackPaused"
    ]);
    expect(events[2].payload).toMatchObject({
      passageId: "chapter-1:p1:passage-1",
      sentenceId: "s1"
    });
  });

  it("moves to a clicked sentence by starting the containing passage at that sentence", async () => {
    const events: AnyDomainEvent[] = [];
    const player = new FakeManifestNarrationPlayer();
    const session = createNarrationSession({
      adapter: new FakePassageNarrationAdapter(),
      player,
      onEvent: (event) => events.push(event),
      createRequestId: createIncrementingIds()
    });

    session.open({
      outline: createOutline(),
      engineId: "kokoro",
      modelRevision: "fake-kokoro",
      voiceId: "kokoro-en"
    });

    await session.moveTo("s3");

    expect(player.played[0]).toMatchObject({
      startSentenceId: "s3",
      stopAfterSentenceId: null
    });
    expect(events.map((event) => event.name)).toEqual([
      "PassageNarrationReady",
      "NarrationSentenceEntered",
      "NarrationPlaybackEnded"
    ]);
  });
});

function createOutline() {
  return createNarrationChapterOutline({
    bookId: "book-1",
    chapterId: "chapter-1",
    language: "en",
    sentences: [
      { id: "s1", index: 0, text: "The first sentence has enough words." },
      { id: "s2", index: 1, text: "The second sentence keeps the same paragraph." },
      { id: "s3", index: 2, text: "The third sentence starts a new paragraph." }
    ],
    paragraphs: [
      { id: "p1", index: 0, startSentenceIndex: 0, endSentenceIndex: 2 },
      { id: "p2", index: 1, startSentenceIndex: 2, endSentenceIndex: 3 }
    ]
  });
}

function createIncrementingIds() {
  let nextId = 0;
  return () => `request-${(nextId += 1)}`;
}
