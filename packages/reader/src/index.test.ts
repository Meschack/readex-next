import { describe, expect, it } from "vitest";
import {
  advancePlayback,
  calculateReaderProgress,
  calculateSentenceRenderWindow,
  createPlaybackState,
  finishSentencePlayback,
  movePlayback,
  playPlayback,
  searchReaderSentences,
  selectPlaybackSentence,
  sentenceMatchesQuery
} from "./index";

describe("reader playback", () => {
  it("starts at the first sentence", () => {
    expect(playPlayback(createPlaybackState(), 3)).toEqual({
      activeSentenceIndex: 0,
      status: "playing"
    });
  });

  it("advances sentence-by-sentence and ends on the last sentence", () => {
    const playing = playPlayback(createPlaybackState(), 2);

    expect(advancePlayback(playing, 2)).toEqual({
      activeSentenceIndex: 1,
      status: "playing"
    });
    expect(advancePlayback({ activeSentenceIndex: 1, status: "playing" }, 2)).toEqual({
      activeSentenceIndex: 1,
      status: "ended"
    });
  });

  it("keeps manual movement inside the available sentence range", () => {
    expect(movePlayback({ activeSentenceIndex: 0, status: "paused" }, 3, -1)).toEqual({
      activeSentenceIndex: 0,
      status: "paused"
    });
    expect(selectPlaybackSentence({ activeSentenceIndex: 0, status: "ended" }, 3, 9)).toEqual({
      activeSentenceIndex: 2,
      status: "paused"
    });
  });

  it("can pause after a sentence when auto-advance is off", () => {
    expect(finishSentencePlayback({ activeSentenceIndex: 0, status: "playing" }, 3, false)).toEqual(
      {
        activeSentenceIndex: 1,
        status: "paused"
      }
    );
  });
});

describe("reader progress", () => {
  it("calculates book and chapter progress across chapters", () => {
    const progress = calculateReaderProgress(
      [
        { id: "chapter-2", index: 1, sentenceCount: 3 },
        { id: "chapter-1", index: 0, sentenceCount: 2 }
      ],
      "chapter-2",
      1
    );

    expect(progress).toMatchObject({
      chapterIndex: 1,
      chapterCount: 2,
      chapterSentenceNumber: 2,
      chapterSentenceCount: 3,
      bookSentenceNumber: 4,
      bookSentenceCount: 5
    });
    expect(progress.chapterPercent).toBeCloseTo(66.67, 1);
    expect(progress.bookPercent).toBe(80);
  });

  it("returns stable zero progress without readable sentences", () => {
    expect(calculateReaderProgress([], "missing", 4)).toEqual({
      chapterIndex: 0,
      chapterCount: 0,
      chapterSentenceNumber: 0,
      chapterSentenceCount: 0,
      chapterPercent: 0,
      bookSentenceNumber: 0,
      bookSentenceCount: 0,
      bookPercent: 0
    });
  });
});

describe("reader search", () => {
  const sentences = [
    { id: "sentence-1", index: 0, text: "The reader listens carefully." },
    { id: "sentence-2", index: 1, text: "A bookmark keeps the place." }
  ];

  it("finds matching sentences with stable excerpts", () => {
    expect(searchReaderSentences(sentences, "BOOKMARK")).toEqual([
      {
        sentence: sentences[1],
        excerpt: "A bookmark keeps the place."
      }
    ]);
  });

  it("reports whether a sentence matches a query", () => {
    expect(sentenceMatchesQuery(sentences[0], "listens")).toBe(true);
    expect(sentenceMatchesQuery(sentences[0], "")).toBe(false);
  });
});

describe("sentence render window", () => {
  it("keeps the mounted sentence range bounded around the active sentence", () => {
    expect(
      calculateSentenceRenderWindow({
        sentenceCount: 2027,
        activeSentenceIndex: 1000,
        leadCount: 36,
        trailCount: 96
      })
    ).toEqual({
      start: 964,
      end: 1097,
      hiddenBefore: 964,
      hiddenAfter: 930
    });
  });

  it("clamps the window at chapter edges", () => {
    expect(
      calculateSentenceRenderWindow({
        sentenceCount: 12,
        activeSentenceIndex: -4,
        leadCount: 36,
        trailCount: 96
      })
    ).toEqual({
      start: 0,
      end: 12,
      hiddenBefore: 0,
      hiddenAfter: 0
    });
  });
});
