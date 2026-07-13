import { describe, expect, it } from "vitest";
import type { NarrationChapterOutline, PreparedNarration } from "./narration-contracts";
import { validatePreparedNarration } from "./narration-manifest";
import { createNarrationChapterOutline, createNarrationPassages } from "./narration-outline";

describe("narration chapter outlines", () => {
  it("preserves paragraph boundaries and splits oversized paragraphs only between sentences", () => {
    const outline = chapterOutline();
    const passages = createNarrationPassages(outline, { maxCharacters: 16, maxSentences: 8 });

    expect(passages.map((passage) => passage.sentences.map((sentence) => sentence.id))).toEqual([
      ["sentence-1"],
      ["sentence-2"],
      ["sentence-3"]
    ]);
    expect(passages.map((passage) => passage.paragraphId)).toEqual([
      "paragraph-1",
      "paragraph-1",
      "paragraph-2"
    ]);
  });

  it("rejects paragraph gaps instead of inventing narration structure", () => {
    expect(() =>
      createNarrationChapterOutline({
        ...chapterOutline(),
        paragraphs: [
          { id: "paragraph-1", index: 0, startSentenceIndex: 0, endSentenceIndex: 1 },
          { id: "paragraph-2", index: 1, startSentenceIndex: 2, endSentenceIndex: 3 }
        ]
      })
    ).toThrow("cover sentences once and in order");
  });
});

describe("prepared narration manifests", () => {
  it("accepts a complete sample timeline in requested sentence order", () => {
    expect(validatePreparedNarration(preparedNarration(), chapterOutline().sentences)).toEqual({
      valid: true,
      issues: []
    });
  });

  it("rejects reordered sentences and gaps in the audio timeline", () => {
    const invalid = preparedNarration();
    invalid.sentences = [
      { sentenceId: "sentence-2", startSample: 0, endSample: 10_000 },
      { sentenceId: "sentence-1", startSample: 10_500, endSample: 20_000 },
      { sentenceId: "sentence-3", startSample: 20_000, endSample: 30_000 }
    ];

    expect(validatePreparedNarration(invalid, chapterOutline().sentences)).toEqual({
      valid: false,
      issues: ["missing-sentence", "unexpected-sentence", "timeline-gap"]
    });
  });
});

function chapterOutline(): NarrationChapterOutline {
  return {
    bookId: "book-1",
    chapterId: "chapter-1",
    language: "en-GB",
    sentences: [
      { id: "sentence-1", index: 0, text: "First sentence." },
      { id: "sentence-2", index: 1, text: "Second sentence." },
      { id: "sentence-3", index: 2, text: "Third sentence." }
    ],
    paragraphs: [
      { id: "paragraph-1", index: 0, startSentenceIndex: 0, endSentenceIndex: 2 },
      { id: "paragraph-2", index: 1, startSentenceIndex: 2, endSentenceIndex: 3 }
    ]
  };
}

function preparedNarration(): PreparedNarration {
  return {
    assetId: "asset-1",
    sourceUrl: "file:///prepared.wav",
    sampleRate: 24_000,
    sampleCount: 30_000,
    sentences: [
      { sentenceId: "sentence-1", startSample: 0, endSample: 10_000 },
      { sentenceId: "sentence-2", startSample: 10_000, endSample: 20_000 },
      { sentenceId: "sentence-3", startSample: 20_000, endSample: 30_000 }
    ],
    cached: false,
    engineId: "kokoro",
    modelRevision: "kokoro-test",
    voiceId: "kokoro:af-heart",
    sourceTextDigest: "digest"
  };
}
