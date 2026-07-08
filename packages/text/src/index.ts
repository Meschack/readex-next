export interface SentenceSegment {
  text: string;
  index: number;
}

export interface ParagraphSegment {
  index: number;
  sentences: SentenceSegment[];
}

export type ReaderTextToken =
  | {
      kind: "word";
      text: string;
      normalized: string;
      index: number;
    }
  | {
      kind: "text";
      text: string;
      index: number;
    };

export function normalizeReaderText(input: string): string {
  return input
    .replace(/\u00a0/g, " ")
    .replace(/\u00ad/g, "")
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/([A-Za-z])-\s+([a-z])/g, "$1$2")
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:!?)\]])/g, "$1")
    .trim();
}

export function normalizeReaderParagraphs(input: string): string {
  return input
    .replace(/\u00a0/g, " ")
    .replace(/\u00ad/g, "")
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/([A-Za-z])-\s+([a-z])/g, "$1$2")
    .replace(/[‐‑‒–—]/g, "-")
    .split(/\n{2,}/)
    .map(normalizeReaderText)
    .filter(Boolean)
    .join("\n\n");
}

export function segmentSentences(input: string): SentenceSegment[] {
  const normalized = normalizeReaderText(input);
  if (!normalized) return [];

  return normalized
    .split(/(?<=[.!?;"')\]]|\.\.\.)\s+(?=[A-Z0-9"'(])/g)
    .map(normalizeReaderText)
    .filter(Boolean)
    .map((text, index) => ({ text, index }));
}

export function segmentParagraphs(input: string): ParagraphSegment[] {
  const normalized = normalizeReaderParagraphs(input);
  if (!normalized) return [];

  let sentenceOffset = 0;

  return normalized
    .split("\n\n")
    .map((paragraph) => {
      const sentences = segmentSentences(paragraph).map((sentence) => ({
        ...sentence,
        index: sentence.index + sentenceOffset
      }));
      sentenceOffset += sentences.length;

      return sentences;
    })
    .filter((sentences) => sentences.length > 0)
    .map((sentences, index) => ({ index, sentences }));
}

export function tokenizeReaderText(input: string): ReaderTextToken[] {
  const tokens: ReaderTextToken[] = [];
  const wordPattern = /[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/gu;
  let lastIndex = 0;
  let index = 0;

  for (const match of input.matchAll(wordPattern)) {
    const text = match[0];
    const matchIndex = match.index ?? 0;

    if (matchIndex > lastIndex) {
      tokens.push({
        kind: "text",
        text: input.slice(lastIndex, matchIndex),
        index
      });
      index += 1;
    }

    tokens.push({
      kind: "word",
      text,
      normalized: normalizeWordSurface(text),
      index
    });
    index += 1;
    lastIndex = matchIndex + text.length;
  }

  if (lastIndex < input.length) {
    tokens.push({
      kind: "text",
      text: input.slice(lastIndex),
      index
    });
  }

  return tokens;
}

export function normalizeWordSurface(input: string): string {
  return input
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}
