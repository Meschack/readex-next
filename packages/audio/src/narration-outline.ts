import type {
  NarrationChapterOutline,
  NarrationParagraphRange,
  NarrationPassage,
  NarrationSentence
} from "./narration-contracts";

export interface NarrationPassageOptions {
  maxCharacters?: number;
  maxSentences?: number;
}

const defaultPassageOptions = {
  maxCharacters: 800,
  maxSentences: 32
} as const;

export function createNarrationChapterOutline(
  input: NarrationChapterOutline
): NarrationChapterOutline {
  assertIdentifier(input.bookId, "book");
  assertIdentifier(input.chapterId, "chapter");

  const sentences = input.sentences.map((sentence, position) => {
    assertIdentifier(sentence.id, `sentence ${position + 1}`);
    if (sentence.index !== position) {
      throw new Error("Narration sentences must use contiguous chapter indexes.");
    }
    if (sentence.text.trim().length === 0) {
      throw new Error("Narration sentences cannot be empty.");
    }
    return { ...sentence };
  });
  assertUniqueIds(sentences);

  const paragraphs = input.paragraphs.map((paragraph) => ({ ...paragraph }));
  assertParagraphCoverage(paragraphs, sentences.length);

  return {
    bookId: input.bookId,
    chapterId: input.chapterId,
    language: normalizeOptionalLanguage(input.language),
    sentences,
    paragraphs
  };
}

export function createNarrationPassages(
  outline: NarrationChapterOutline,
  options: NarrationPassageOptions = {}
): readonly NarrationPassage[] {
  const chapter = createNarrationChapterOutline(outline);
  const maxCharacters = positiveInteger(
    options.maxCharacters ?? defaultPassageOptions.maxCharacters,
    "maximum passage characters"
  );
  const maxSentences = positiveInteger(
    options.maxSentences ?? defaultPassageOptions.maxSentences,
    "maximum passage sentences"
  );
  const passages: NarrationPassage[] = [];

  for (const paragraph of chapter.paragraphs) {
    const sentences = chapter.sentences.slice(
      paragraph.startSentenceIndex,
      paragraph.endSentenceIndex
    );
    const groups = splitSentences(sentences, maxCharacters, maxSentences);

    for (const [partIndex, group] of groups.entries()) {
      passages.push({
        id: `${chapter.chapterId}:${paragraph.id}:passage-${partIndex + 1}`,
        bookId: chapter.bookId,
        chapterId: chapter.chapterId,
        paragraphId: paragraph.id,
        language: chapter.language,
        sentences: group
      });
    }
  }

  return passages;
}

function splitSentences(
  sentences: readonly NarrationSentence[],
  maxCharacters: number,
  maxSentences: number
): NarrationSentence[][] {
  const groups: NarrationSentence[][] = [];
  let current: NarrationSentence[] = [];
  let currentCharacters = 0;

  for (const sentence of sentences) {
    const separatorCharacters = current.length > 0 ? 1 : 0;
    const exceedsCharacters =
      current.length > 0 &&
      currentCharacters + separatorCharacters + sentence.text.length > maxCharacters;
    const exceedsSentences = current.length >= maxSentences;

    if (exceedsCharacters || exceedsSentences) {
      groups.push(current);
      current = [];
      currentCharacters = 0;
    }

    currentCharacters += (current.length > 0 ? 1 : 0) + sentence.text.length;
    current.push(sentence);
  }

  if (current.length > 0) groups.push(current);
  return groups;
}

function assertParagraphCoverage(
  paragraphs: readonly NarrationParagraphRange[],
  sentenceCount: number
) {
  if (sentenceCount === 0) {
    if (paragraphs.length > 0)
      throw new Error("An empty chapter cannot contain narration paragraphs.");
    return;
  }
  if (paragraphs.length === 0) {
    throw new Error("Narration paragraphs must cover every chapter sentence.");
  }

  let nextSentenceIndex = 0;
  const paragraphIds = new Set<string>();
  for (const [position, paragraph] of paragraphs.entries()) {
    assertIdentifier(paragraph.id, `paragraph ${position + 1}`);
    if (paragraphIds.has(paragraph.id)) throw new Error("Narration paragraph IDs must be unique.");
    paragraphIds.add(paragraph.id);

    if (paragraph.index !== position) {
      throw new Error("Narration paragraphs must use contiguous chapter indexes.");
    }
    if (
      paragraph.startSentenceIndex !== nextSentenceIndex ||
      paragraph.endSentenceIndex <= paragraph.startSentenceIndex ||
      paragraph.endSentenceIndex > sentenceCount
    ) {
      throw new Error("Narration paragraphs must cover sentences once and in order.");
    }
    nextSentenceIndex = paragraph.endSentenceIndex;
  }

  if (nextSentenceIndex !== sentenceCount) {
    throw new Error("Narration paragraphs must cover every chapter sentence.");
  }
}

function assertUniqueIds(sentences: readonly NarrationSentence[]) {
  const ids = new Set(sentences.map((sentence) => sentence.id));
  if (ids.size !== sentences.length) throw new Error("Narration sentence IDs must be unique.");
}

function assertIdentifier(value: string, label: string) {
  if (value.trim().length === 0) throw new Error(`Narration ${label} ID cannot be empty.`);
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1)
    throw new Error(`${label} must be a positive integer.`);
  return value;
}

function normalizeOptionalLanguage(language: string | null): string | null {
  if (language == null) return null;
  const normalized = language.trim();
  return normalized.length > 0 ? normalized : null;
}
