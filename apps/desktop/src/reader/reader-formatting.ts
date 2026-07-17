import type { LibraryBookSummary } from "../library/library-models";

export function slugify(value: string): string {
  return (
    value
      .normalize("NFKC")
      .toLocaleLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "sonelle-book"
  );
}

export function bookInitials(title: string): string {
  const words = title
    .trim()
    .split(/\s+/)
    .filter((word) => !/^(a|an|the)$/i.test(word));
  const initials = (words.length > 0 ? words : title.trim().split(/\s+/))
    .slice(0, 2)
    .map((word) => word[0])
    .filter(Boolean)
    .join("");

  return initials.toLocaleUpperCase() || "R";
}

export function libraryProgressPercent(book: LibraryBookSummary): number {
  if (book.sentenceCount <= 0) return 0;

  const completedSentences = Math.max(0, Math.min(book.sentenceCount, book.completedSentenceCount));
  return Math.round((completedSentences / book.sentenceCount) * 100);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}

export function cssFontFamilyStack(fontFamily: string | null, fallback: string): string {
  if (fontFamily == null) return fallback;
  const escaped = fontFamily.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"');
  return `"${escaped}", ${fallback}`;
}
