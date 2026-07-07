export interface SentenceSegment {
  text: string;
  index: number;
}

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
    .trim();
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
