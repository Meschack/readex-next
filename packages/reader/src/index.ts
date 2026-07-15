import type { DomainEvent, SentenceRef } from "@sonelle/domain";

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
  libraryRailWidth: number;
  inspectorRailWidth: number;
  contentFontSize: number;
  contentFontFamily: string | null;
  uiFontFamily: string | null;
}

export type ReaderTypographyPreferences = Pick<
  ReaderPreferences,
  "contentFontSize" | "contentFontFamily" | "uiFontFamily"
>;

export interface SearchableSentence {
  id: string;
  index: number;
  text: string;
  searchText?: string;
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

export interface ReaderProgressIndex {
  chapters: ReaderProgressChapter[];
  chapterCount: number;
  bookSentenceCount: number;
  sentencesBeforeChapter: Record<string, number>;
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

export interface ReadingPositionScheduler<TPosition> {
  schedulePlaybackSave(position: TPosition): void;
  saveNow(position: TPosition): void;
  flush(): void;
  cancel(): void;
}

export interface ReadingPositionSchedulerOptions<TPosition> {
  delayMs: number;
  save(position: TPosition): void | Promise<void>;
  onError?(error: unknown): void;
}

export type NarrationPlaybackProjectionEvent =
  | DomainEvent<"NarrationSentenceEntered">
  | DomainEvent<"NarrationPlaybackPaused">
  | DomainEvent<"NarrationPlaybackEnded">
  | DomainEvent<"NarrationPlaybackFailed">;

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
  libraryFilter: "all",
  libraryRailWidth: 340,
  inspectorRailWidth: 400,
  contentFontSize: 16,
  contentFontFamily: null,
  uiFontFamily: null
};

export function createReaderPreferences(input: Partial<ReaderPreferences> = {}): ReaderPreferences {
  return {
    toolTab: isReaderToolTab(input.toolTab) ? input.toolTab : DEFAULT_READER_PREFERENCES.toolTab,
    libraryFilter: isReaderLibraryFilter(input.libraryFilter)
      ? input.libraryFilter
      : DEFAULT_READER_PREFERENCES.libraryFilter,
    libraryRailWidth: normalizeRailWidth(
      input.libraryRailWidth,
      DEFAULT_READER_PREFERENCES.libraryRailWidth
    ),
    inspectorRailWidth: normalizeRailWidth(
      input.inspectorRailWidth,
      DEFAULT_READER_PREFERENCES.inspectorRailWidth
    ),
    contentFontSize: clampContentFontSize(
      input.contentFontSize ?? DEFAULT_READER_PREFERENCES.contentFontSize
    ),
    contentFontFamily: normalizeFontFamily(input.contentFontFamily),
    uiFontFamily: normalizeFontFamily(input.uiFontFamily)
  };
}

function normalizeRailWidth(value: number | undefined, fallback: number): number {
  if (value == null || !Number.isFinite(value)) return fallback;
  return Math.min(600, Math.max(180, Math.round(value)));
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

export function readerTypographyPreferences(
  preferences: ReaderPreferences
): ReaderTypographyPreferences {
  const normalized = createReaderPreferences(preferences);
  return {
    contentFontSize: normalized.contentFontSize,
    contentFontFamily: normalized.contentFontFamily,
    uiFontFamily: normalized.uiFontFamily
  };
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

export function projectNarrationEventToPlayback(
  state: ReaderPlaybackState,
  sentenceIds: readonly string[],
  event: NarrationPlaybackProjectionEvent
): ReaderPlaybackState {
  switch (event.name) {
    case "NarrationSentenceEntered": {
      const sentenceIndex = sentenceIds.indexOf(event.payload.sentenceId);
      if (sentenceIndex < 0) return state;
      return {
        activeSentenceIndex: sentenceIndex,
        status: "playing"
      };
    }
    case "NarrationPlaybackPaused": {
      const sentenceIndex = sentenceIds.indexOf(event.payload.sentenceId);
      return {
        activeSentenceIndex:
          sentenceIndex < 0
            ? state.activeSentenceIndex
            : clampSentenceIndex(sentenceIndex, sentenceIds.length),
        status: "paused"
      };
    }
    case "NarrationPlaybackEnded": {
      const sentenceIndex = sentenceIds.indexOf(event.payload.lastSentenceId);
      return {
        activeSentenceIndex:
          sentenceIndex < 0
            ? state.activeSentenceIndex
            : clampSentenceIndex(sentenceIndex, sentenceIds.length),
        status: "ended"
      };
    }
    case "NarrationPlaybackFailed":
      return pausePlayback(state);
  }
}

export function searchReaderSentences<TSentence extends SearchableSentence>(
  sentences: TSentence[],
  query: string,
  limit = 100
): ReaderSearchResult<TSentence>[] {
  const normalizedQuery = normalizeReaderSearchText(query);
  const safeLimit = Math.max(0, Math.trunc(limit));
  if (normalizedQuery.length === 0 || safeLimit === 0) return [];

  const results: ReaderSearchResult<TSentence>[] = [];
  for (const sentence of sentences) {
    if (!searchableSentenceText(sentence).includes(normalizedQuery)) continue;

    results.push({
      sentence,
      excerpt: createSearchExcerpt(sentence.text, normalizedQuery)
    });
    if (results.length >= safeLimit) break;
  }

  return results;
}

export function sentenceMatchesQuery(sentence: SearchableSentence, query: string): boolean {
  const normalizedQuery = normalizeReaderSearchText(query);
  return normalizedQuery.length > 0 && searchableSentenceText(sentence).includes(normalizedQuery);
}

export function createSentenceId(bookId: string, chapterId: string, sentenceIndex: number): string {
  return `${bookId}:${chapterId}:sentence-${sentenceIndex + 1}`;
}

export function calculateReaderProgress(
  chapters: ReaderProgressChapter[],
  activeChapterId: string,
  activeSentenceIndex: number
): ReaderProgress {
  return calculateReaderProgressFromIndex(
    createReaderProgressIndex(chapters),
    activeChapterId,
    activeSentenceIndex
  );
}

export function createReaderProgressIndex(chapters: ReaderProgressChapter[]): ReaderProgressIndex {
  const orderedChapters = [...chapters].sort((first, second) => first.index - second.index);
  let bookSentenceCount = 0;
  const sentencesBeforeChapter: Record<string, number> = {};

  for (const chapter of orderedChapters) {
    sentencesBeforeChapter[chapter.id] = bookSentenceCount;
    bookSentenceCount += Math.max(0, chapter.sentenceCount);
  }

  return {
    chapters: orderedChapters,
    chapterCount: orderedChapters.length,
    bookSentenceCount,
    sentencesBeforeChapter
  };
}

export function calculateReaderProgressFromIndex(
  index: ReaderProgressIndex,
  activeChapterId: string,
  activeSentenceIndex: number
): ReaderProgress {
  const orderedChapters = index.chapters;
  const activeChapter =
    orderedChapters.find((chapter) => chapter.id === activeChapterId) ?? orderedChapters[0];
  const { bookSentenceCount, chapterCount } = index;

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
  const sentencesBeforeChapter = index.sentencesBeforeChapter[activeChapter.id] ?? 0;
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

export function createReadingPositionScheduler<TPosition>(
  options: ReadingPositionSchedulerOptions<TPosition>
): ReadingPositionScheduler<TPosition> {
  let pendingPosition: TPosition | null = null;
  let timerId: ReturnType<typeof setTimeout> | null = null;

  const clearPendingTimer = () => {
    if (timerId == null) return;

    clearTimeout(timerId);
    timerId = null;
  };

  const persist = (position: TPosition) => {
    Promise.resolve(options.save(position)).catch((error: unknown) => options.onError?.(error));
  };

  const flush = () => {
    clearPendingTimer();
    const position = pendingPosition;
    pendingPosition = null;

    if (position != null) {
      persist(position);
    }
  };

  return {
    schedulePlaybackSave(position) {
      pendingPosition = position;
      if (timerId != null) return;

      timerId = setTimeout(flush, Math.max(0, options.delayMs));
    },
    saveNow(position) {
      clearPendingTimer();
      pendingPosition = null;
      persist(position);
    },
    flush,
    cancel() {
      clearPendingTimer();
      pendingPosition = null;
    }
  };
}

export function normalizeReaderSearchText(query: string): string {
  return query.normalize("NFKC").trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function searchableSentenceText(sentence: SearchableSentence): string {
  return sentence.searchText ?? normalizeReaderSearchText(sentence.text);
}

function isReaderToolTab(value: unknown): value is ReaderToolTab {
  return value === "word" || value === "search" || value === "bookmarks" || value === "settings";
}

function isReaderLibraryFilter(value: unknown): value is ReaderLibraryFilterPreference {
  return value === "all" || value === "in-progress" || value === "bookmarked";
}

function clampContentFontSize(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_READER_PREFERENCES.contentFontSize;
  return Math.min(24, Math.max(14, Math.round(value)));
}

function normalizeFontFamily(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const family = value.trim();
  if (
    family.length === 0 ||
    family.length > 160 ||
    [...family].some((character) => /[\u0000-\u001f\u007f]/u.test(character))
  ) {
    return null;
  }
  return family;
}

function createSearchExcerpt(text: string, normalizedQuery: string): string {
  const normalizedText = normalizeReaderSearchText(text);
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
