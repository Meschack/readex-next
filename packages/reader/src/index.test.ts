import { afterEach, describe, expect, it, vi } from "vitest";
import {
  advancePlayback,
  calculateReaderProgress,
  calculateReaderProgressFromIndex,
  calculateSentenceRenderWindow,
  createReaderProgressIndex,
  createReadingPositionScheduler,
  createPlaybackState,
  createReaderPreferences,
  finishSentencePlayback,
  movePlayback,
  parseReaderPreferences,
  playPlayback,
  projectNarrationEventToPlayback,
  readableInkForColor,
  searchReaderSentences,
  selectPlaybackSentence,
  serializeReaderPreferences,
  sentenceMatchesQuery
} from "./index";

interface TestReadingPosition {
  bookId: string;
  chapterId: string;
  sentenceIndex: number;
}

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

  it("projects manifest narration events into playback state", () => {
    const sentenceIds = ["sentence-1", "sentence-2", "sentence-3"];

    expect(
      projectNarrationEventToPlayback(
        { activeSentenceIndex: 0, status: "paused" },
        sentenceIds,
        narrationEvent("NarrationSentenceEntered", {
          sentenceId: "sentence-2",
          passageId: "passage-1"
        })
      )
    ).toEqual({ activeSentenceIndex: 1, status: "playing" });
    expect(
      projectNarrationEventToPlayback(
        { activeSentenceIndex: 1, status: "playing" },
        sentenceIds,
        narrationEvent("NarrationPlaybackPaused", {
          sentenceId: "sentence-2",
          passageId: "passage-1"
        })
      )
    ).toEqual({ activeSentenceIndex: 1, status: "paused" });
    expect(
      projectNarrationEventToPlayback(
        { activeSentenceIndex: 1, status: "playing" },
        sentenceIds,
        narrationEvent("NarrationPlaybackEnded", {
          passageId: "passage-1",
          lastSentenceId: "sentence-3"
        })
      )
    ).toEqual({ activeSentenceIndex: 2, status: "ended" });
    expect(
      projectNarrationEventToPlayback(
        { activeSentenceIndex: 1, status: "playing" },
        sentenceIds,
        narrationEvent("NarrationPlaybackFailed", {
          sentenceId: "sentence-2",
          passageId: "passage-1",
          reason: "needs attention"
        })
      )
    ).toEqual({ activeSentenceIndex: 1, status: "paused" });
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

  it("reuses an indexed progress model for playback updates", () => {
    const progressIndex = createReaderProgressIndex([
      { id: "chapter-2", index: 1, sentenceCount: 3 },
      { id: "chapter-1", index: 0, sentenceCount: 2 }
    ]);

    expect(calculateReaderProgressFromIndex(progressIndex, "chapter-2", 2)).toMatchObject({
      chapterSentenceNumber: 3,
      bookSentenceNumber: 5,
      bookSentenceCount: 5
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

  it("uses precomputed search text when available", () => {
    const sentence = {
      id: "sentence-3",
      index: 2,
      text: "Display text",
      searchText: "hidden searchable text"
    };

    expect(sentenceMatchesQuery(sentence, "searchable")).toBe(true);
    expect(searchReaderSentences([sentence], "display")).toEqual([]);
  });

  it("caps common-query results before building an unbounded inspector list", () => {
    const repeated = Array.from({ length: 200 }, (_, index) => ({
      id: `sentence-${index}`,
      index,
      text: "A repeated reader sentence."
    }));

    expect(searchReaderSentences(repeated, "reader", 12)).toHaveLength(12);
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

describe("reading position scheduler", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("coalesces playback-driven saves to the latest pending position", () => {
    vi.useFakeTimers();
    const savedPositions: TestReadingPosition[] = [];
    const scheduler = createReadingPositionScheduler<TestReadingPosition>({
      delayMs: 2_000,
      save: (position) => {
        savedPositions.push(position);
      }
    });

    scheduler.schedulePlaybackSave(position(1));
    scheduler.schedulePlaybackSave(position(2));

    vi.advanceTimersByTime(1_999);
    expect(savedPositions).toEqual([]);

    vi.advanceTimersByTime(1);
    expect(savedPositions).toEqual([position(2)]);
  });

  it("saves manual jumps immediately and clears any pending playback save", () => {
    vi.useFakeTimers();
    const savedPositions: TestReadingPosition[] = [];
    const scheduler = createReadingPositionScheduler<TestReadingPosition>({
      delayMs: 2_000,
      save: (position) => {
        savedPositions.push(position);
      }
    });

    scheduler.schedulePlaybackSave(position(1));
    scheduler.saveNow(position(7));
    vi.advanceTimersByTime(2_000);

    expect(savedPositions).toEqual([position(7)]);
  });

  it("flushes pending playback progress when playback stops", () => {
    vi.useFakeTimers();
    const savedPositions: TestReadingPosition[] = [];
    const scheduler = createReadingPositionScheduler<TestReadingPosition>({
      delayMs: 2_000,
      save: (position) => {
        savedPositions.push(position);
      }
    });

    scheduler.schedulePlaybackSave(position(3));
    scheduler.flush();

    expect(savedPositions).toEqual([position(3)]);
  });

  it("drops pending playback progress when cancelled", () => {
    vi.useFakeTimers();
    const savedPositions: TestReadingPosition[] = [];
    const scheduler = createReadingPositionScheduler<TestReadingPosition>({
      delayMs: 2_000,
      save: (position) => {
        savedPositions.push(position);
      }
    });

    scheduler.schedulePlaybackSave(position(4));
    scheduler.cancel();
    vi.advanceTimersByTime(2_000);

    expect(savedPositions).toEqual([]);
  });
});

describe("reader preferences", () => {
  it("keeps workflow preferences inside supported values", () => {
    expect(
      createReaderPreferences({
        toolTab: "settings",
        libraryFilter: "bookmarked",
        libraryRailWidth: 356.4,
        inspectorRailWidth: 418.7,
        contentFontSize: 19,
        contentFontFamily: "Literata",
        uiFontFamily: "Inter",
        narrationHighlightColor: "#ABCDEF",
        bookmarkHighlightColor: "#016630"
      })
    ).toEqual({
      toolTab: "settings",
      libraryFilter: "bookmarked",
      libraryRailWidth: 356,
      inspectorRailWidth: 419,
      contentFontSize: 19,
      contentFontFamily: "Literata",
      uiFontFamily: "Inter",
      narrationHighlightColor: "#abcdef",
      bookmarkHighlightColor: "#016630"
    });
    expect(
      parseReaderPreferences(
        JSON.stringify({
          toolTab: "nope",
          libraryFilter: "also-nope",
          contentFontSize: 900
        })
      )
    ).toEqual({
      toolTab: "word",
      libraryFilter: "all",
      libraryRailWidth: 340,
      inspectorRailWidth: 400,
      contentFontSize: 24,
      contentFontFamily: null,
      uiFontFamily: null,
      narrationHighlightColor: "#f5edb8",
      bookmarkHighlightColor: "#016630"
    });
    expect(
      parseReaderPreferences(
        serializeReaderPreferences({
          toolTab: "search",
          libraryFilter: "in-progress",
          libraryRailWidth: 375,
          inspectorRailWidth: 425,
          contentFontSize: 13,
          contentFontFamily: "  Source Serif 4  ",
          uiFontFamily: "Bad\nFont",
          narrationHighlightColor: "not-a-color",
          bookmarkHighlightColor: "#FF0066"
        })
      )
    ).toEqual({
      toolTab: "search",
      libraryFilter: "in-progress",
      libraryRailWidth: 375,
      inspectorRailWidth: 425,
      contentFontSize: 14,
      contentFontFamily: "Source Serif 4",
      uiFontFamily: null,
      narrationHighlightColor: "#f5edb8",
      bookmarkHighlightColor: "#ff0066"
    });
  });

  it("chooses readable text for light and dark reader highlights", () => {
    expect(readableInkForColor("#f5edb8")).toBe("#242625");
    expect(readableInkForColor("#016630")).toBe("#ffffff");
  });
});

function position(sentenceIndex: number): TestReadingPosition {
  return {
    bookId: "book-1",
    chapterId: "chapter-1",
    sentenceIndex
  };
}

function narrationEvent<
  TName extends Parameters<typeof projectNarrationEventToPlayback>[2]["name"]
>(
  name: TName,
  payload: Omit<
    Extract<Parameters<typeof projectNarrationEventToPlayback>[2], { name: TName }>["payload"],
    "bookId" | "chapterId"
  >
): Extract<Parameters<typeof projectNarrationEventToPlayback>[2], { name: TName }> {
  return {
    id: `${name}-1`,
    name,
    occurredAt: "2026-07-13T00:00:00.000Z",
    payload: {
      bookId: "book-1",
      chapterId: "chapter-1",
      ...payload
    }
  } as unknown as Extract<Parameters<typeof projectNarrationEventToPlayback>[2], { name: TName }>;
}
