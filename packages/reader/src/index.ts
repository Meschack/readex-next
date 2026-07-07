import type { SentenceRef } from "@readex/domain";

export type PlaybackStatus = "idle" | "playing" | "paused" | "ended";
export type ReaderToolTab = "word" | "search" | "bookmarks" | "settings";
export type ReaderLibraryFilterPreference = "all" | "in-progress" | "bookmarked";

export interface ReaderPosition extends SentenceRef {
  offsetSec: number;
}

export interface HighlightState {
  activeSentenceId: string | null;
}

export interface ReaderPlaybackState {
  activeSentenceIndex: number;
  status: PlaybackStatus;
}

export interface ReaderPreferences {
  toolTab: ReaderToolTab;
  libraryFilter: ReaderLibraryFilterPreference;
}

export interface SearchableSentence {
  id: string;
  index: number;
  text: string;
}

export interface ReaderSearchResult<TSentence extends SearchableSentence = SearchableSentence> {
  sentence: TSentence;
  excerpt: string;
}

export interface ReaderProgressChapter {
  id: string;
  index: number;
  sentenceCount: number;
}

export interface ReaderProgress {
  chapterIndex: number;
  chapterCount: number;
  chapterSentenceNumber: number;
  chapterSentenceCount: number;
  chapterPercent: number;
  bookSentenceNumber: number;
  bookSentenceCount: number;
  bookPercent: number;
}

export interface SentenceRenderWindow {
  start: number;
  end: number;
  hiddenBefore: number;
  hiddenAfter: number;
}

export interface SentenceRenderWindowOptions {
  sentenceCount: number;
  activeSentenceIndex: number;
  leadCount: number;
  trailCount: number;
}

export function highlightSentence(sentenceId: string | null): HighlightState {
  return { activeSentenceId: sentenceId };
}

export function createPlaybackState(): ReaderPlaybackState {
  return {
    activeSentenceIndex: 0,
    status: "idle"
  };
}

export const DEFAULT_READER_PREFERENCES: ReaderPreferences = {
  toolTab: "word",
  libraryFilter: "all"
};

export function createReaderPreferences(input: Partial<ReaderPreferences> = {}): ReaderPreferences {
  return {
    toolTab: isReaderToolTab(input.toolTab) ? input.toolTab : DEFAULT_READER_PREFERENCES.toolTab,
    libraryFilter: isReaderLibraryFilter(input.libraryFilter)
      ? input.libraryFilter
      : DEFAULT_READER_PREFERENCES.libraryFilter
  };
}

export function serializeReaderPreferences(preferences: ReaderPreferences): string {
  return JSON.stringify(createReaderPreferences(preferences));
}

export function parseReaderPreferences(value: string | null): ReaderPreferences {
  if (value == null) return DEFAULT_READER_PREFERENCES;

  try {
    return createReaderPreferences(JSON.parse(value) as Partial<ReaderPreferences>);
  } catch {
    return DEFAULT_READER_PREFERENCES;
  }
}

export function playPlayback(
  state: ReaderPlaybackState,
  sentenceCount: number
): ReaderPlaybackState {
  if (sentenceCount <= 0) return { activeSentenceIndex: 0, status: "idle" };

  return {
    activeSentenceIndex:
      state.status === "ended" ? 0 : clampSentenceIndex(state.activeSentenceIndex, sentenceCount),
    status: "playing"
  };
}

export function pausePlayback(state: ReaderPlaybackState): ReaderPlaybackState {
  return {
    ...state,
    status: state.status === "playing" ? "paused" : state.status
  };
}

export function advancePlayback(
  state: ReaderPlaybackState,
  sentenceCount: number
): ReaderPlaybackState {
  if (sentenceCount <= 0) return { activeSentenceIndex: 0, status: "idle" };

  const activeSentenceIndex = clampSentenceIndex(state.activeSentenceIndex, sentenceCount);
  const nextIndex = activeSentenceIndex + 1;

  if (nextIndex >= sentenceCount) {
    return {
      activeSentenceIndex,
      status: "ended"
    };
  }

  return {
    activeSentenceIndex: nextIndex,
    status: state.status
  };
}

export function movePlayback(
  state: ReaderPlaybackState,
  sentenceCount: number,
  direction: -1 | 1
): ReaderPlaybackState {
  if (sentenceCount <= 0) return { activeSentenceIndex: 0, status: "idle" };

  return {
    activeSentenceIndex: clampSentenceIndex(state.activeSentenceIndex + direction, sentenceCount),
    status: state.status === "ended" ? "paused" : state.status
  };
}

export function selectPlaybackSentence(
  state: ReaderPlaybackState,
  sentenceCount: number,
  sentenceIndex: number
): ReaderPlaybackState {
  if (sentenceCount <= 0) return { activeSentenceIndex: 0, status: "idle" };

  return {
    activeSentenceIndex: clampSentenceIndex(sentenceIndex, sentenceCount),
    status: state.status === "ended" ? "paused" : state.status
  };
}

export function finishSentencePlayback(
  state: ReaderPlaybackState,
  sentenceCount: number,
  autoAdvance: boolean
): ReaderPlaybackState {
  const advanced = advancePlayback(state, sentenceCount);
  if (autoAdvance || advanced.status === "ended") return advanced;

  return {
    ...advanced,
    status: "paused"
  };
}

export function searchReaderSentences<TSentence extends SearchableSentence>(
  sentences: TSentence[],
  query: string
): ReaderSearchResult<TSentence>[] {
  const normalizedQuery = normalizeReaderSearchQuery(query);
  if (normalizedQuery.length === 0) return [];

  return sentences
    .filter((sentence) => normalizeReaderSearchQuery(sentence.text).includes(normalizedQuery))
    .map((sentence) => ({
      sentence,
      excerpt: createSearchExcerpt(sentence.text, normalizedQuery)
    }));
}

export function sentenceMatchesQuery(sentence: SearchableSentence, query: string): boolean {
  const normalizedQuery = normalizeReaderSearchQuery(query);
  return (
    normalizedQuery.length > 0 &&
    normalizeReaderSearchQuery(sentence.text).includes(normalizedQuery)
  );
}

export function createSentenceId(bookId: string, chapterId: string, sentenceIndex: number): string {
  return `${bookId}:${chapterId}:sentence-${sentenceIndex + 1}`;
}

export function calculateReaderProgress(
  chapters: ReaderProgressChapter[],
  activeChapterId: string,
  activeSentenceIndex: number
): ReaderProgress {
  const orderedChapters = [...chapters].sort((first, second) => first.index - second.index);
  const activeChapter =
    orderedChapters.find((chapter) => chapter.id === activeChapterId) ?? orderedChapters[0];
  const chapterCount = orderedChapters.length;
  const bookSentenceCount = orderedChapters.reduce(
    (total, chapter) => total + Math.max(0, chapter.sentenceCount),
    0
  );

  if (activeChapter == null) {
    return {
      chapterIndex: 0,
      chapterCount,
      chapterSentenceNumber: 0,
      chapterSentenceCount: 0,
      chapterPercent: 0,
      bookSentenceNumber: 0,
      bookSentenceCount,
      bookPercent: 0
    };
  }

  const chapterSentenceCount = Math.max(0, activeChapter.sentenceCount);
  const safeSentenceIndex =
    chapterSentenceCount === 0 ? 0 : clampSentenceIndex(activeSentenceIndex, chapterSentenceCount);
  const sentencesBeforeChapter = orderedChapters
    .filter((chapter) => chapter.index < activeChapter.index)
    .reduce((total, chapter) => total + Math.max(0, chapter.sentenceCount), 0);
  const bookSentenceIndex =
    bookSentenceCount === 0
      ? 0
      : Math.min(sentencesBeforeChapter + safeSentenceIndex, bookSentenceCount - 1);
  const chapterSentenceNumber = chapterSentenceCount === 0 ? 0 : safeSentenceIndex + 1;
  const bookSentenceNumber = bookSentenceCount === 0 ? 0 : bookSentenceIndex + 1;

  return {
    chapterIndex: activeChapter.index,
    chapterCount,
    chapterSentenceNumber,
    chapterSentenceCount,
    chapterPercent: percentage(chapterSentenceNumber, chapterSentenceCount),
    bookSentenceNumber,
    bookSentenceCount,
    bookPercent: percentage(bookSentenceNumber, bookSentenceCount)
  };
}

export function calculateSentenceRenderWindow(
  options: SentenceRenderWindowOptions
): SentenceRenderWindow {
  const sentenceCount = Math.max(0, Math.trunc(options.sentenceCount));
  const leadCount = Math.max(0, Math.trunc(options.leadCount));
  const trailCount = Math.max(0, Math.trunc(options.trailCount));
  const activeIndex =
    sentenceCount === 0 ? 0 : clampSentenceIndex(options.activeSentenceIndex, sentenceCount);
  const start = Math.max(0, activeIndex - leadCount);
  const end = Math.min(sentenceCount, activeIndex + trailCount + 1);

  return {
    start,
    end,
    hiddenBefore: start,
    hiddenAfter: sentenceCount - end
  };
}

function normalizeReaderSearchQuery(query: string): string {
  return query.normalize("NFKC").trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function isReaderToolTab(value: unknown): value is ReaderToolTab {
  return value === "word" || value === "search" || value === "bookmarks" || value === "settings";
}

function isReaderLibraryFilter(value: unknown): value is ReaderLibraryFilterPreference {
  return value === "all" || value === "in-progress" || value === "bookmarked";
}

function createSearchExcerpt(text: string, normalizedQuery: string): string {
  const normalizedText = normalizeReaderSearchQuery(text);
  const matchIndex = normalizedText.indexOf(normalizedQuery);
  if (matchIndex === -1 || text.length <= 120) return text;

  const start = Math.max(0, matchIndex - 44);
  const end = Math.min(text.length, matchIndex + normalizedQuery.length + 68);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < text.length ? "..." : "";

  return `${prefix}${text.slice(start, end).trim()}${suffix}`;
}

function clampSentenceIndex(sentenceIndex: number, sentenceCount: number): number {
  return Math.max(0, Math.min(sentenceIndex, sentenceCount - 1));
}

function percentage(current: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, (current / total) * 100));
}
