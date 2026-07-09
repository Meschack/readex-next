import { For, Show } from "solid-js";
import type { PlaybackStatus, ReaderProgress } from "@readex/reader";
import { BookCover } from "./book-cover";
import type { ReaderChapterNavigationItem } from "./reader-view";
import {
  BookmarkIcon,
  HeadphonesIcon,
  MoreIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PreviousIcon
} from "./reader-icons";

interface ReaderTopAppBarProps {
  bookTitle: string;
  onOpenSearch: () => void;
  onOpenSettings: () => void;
}

export function ReaderTopAppBar(props: ReaderTopAppBarProps) {
  return (
    <header class="top-app-bar">
      <div class="top-reading-title">
        <span>Now reading</span>
        <strong>{props.bookTitle}</strong>
      </div>
      <div class="top-app-actions">
        <button type="button" aria-label="Open search" onClick={props.onOpenSearch}>
          <HeadphonesIcon />
        </button>
        <button type="button" aria-label="Open settings" onClick={props.onOpenSettings}>
          <MoreIcon />
        </button>
      </div>
    </header>
  );
}

interface ChapterNavigatorProps {
  chapters: ReaderChapterNavigationItem[];
  activeChapterId: string;
  progress: ReaderProgress;
  volume: string;
  onOpenChapter: (chapterId: string) => void;
}

export function ChapterNavigator(props: ChapterNavigatorProps) {
  const activeChapter = () =>
    props.chapters.find((chapter) => chapter.id === props.activeChapterId) ?? props.chapters[0];

  return (
    <nav class="chapter-navigation" aria-label="Chapter navigation">
      <label class="chapter-meta-block">
        <span>Chapter</span>
        <select
          aria-label="Current chapter"
          value={props.activeChapterId}
          onChange={(event) => props.onOpenChapter(event.currentTarget.value)}
        >
          <For each={props.chapters}>
            {(chapter) => <option value={chapter.id}>{chapter.title}</option>}
          </For>
        </select>
      </label>
      <span class="chapter-divider" aria-hidden="true" />
      <div class="chapter-meta-block">
        <span>Volume</span>
        <strong>{props.volume}</strong>
      </div>
      <div class="chapter-meta-block chapter-progress-meta">
        <span>Chapter Progress</span>
        <strong>
          {activeChapter()?.sentenceCount ?? props.progress.chapterSentenceCount} sentence
          {(activeChapter()?.sentenceCount ?? props.progress.chapterSentenceCount) === 1 ? "" : "s"}
        </strong>
      </div>
    </nav>
  );
}

interface PlaybackRailProps {
  bookTitle: string;
  author: string;
  coverImageSrc: string | null;
  chapterTitle: string;
  progress: ReaderProgress;
  sentenceCount: number;
  status: PlaybackStatus;
  narrationStatus: string;
  narrationNotice: string | null;
  bookmarked: boolean;
  playbackRate: number;
  onPrevious: () => void;
  onToggle: () => void;
  onNext: () => void;
  onToggleBookmark: () => void;
}

export function PlaybackRail(props: PlaybackRailProps) {
  const isFirstSentence = () => props.progress.chapterSentenceNumber <= 1;
  const isLastSentence = () =>
    props.progress.chapterSentenceCount === 0 ||
    props.progress.chapterSentenceNumber >= props.progress.chapterSentenceCount;

  return (
    <footer class="audio-rail" aria-label="Playback controls">
      <div class="track-info">
        <BookCover className="cover-art" title={props.bookTitle} src={props.coverImageSrc} />
        <div>
          <strong>{props.chapterTitle}</strong>
          <span>{props.author || props.bookTitle}</span>
        </div>
      </div>
      <div class="transport-stack">
        <div class="transport-controls">
          <button
            class="icon-button"
            type="button"
            aria-label="Previous sentence"
            disabled={props.sentenceCount === 0 || isFirstSentence()}
            onClick={props.onPrevious}
          >
            <PreviousIcon />
          </button>
          <button
            class="play"
            type="button"
            aria-label={props.status === "playing" ? "Pause" : "Play"}
            disabled={props.sentenceCount === 0}
            onClick={props.onToggle}
          >
            <Show when={props.status === "playing"} fallback={<PlayIcon />}>
              <PauseIcon />
            </Show>
          </button>
          <button
            class="icon-button"
            type="button"
            aria-label="Next sentence"
            disabled={props.sentenceCount === 0 || isLastSentence()}
            onClick={props.onNext}
          >
            <NextIcon />
          </button>
        </div>
        <div class="audio-progress" aria-label="Reading progress">
          <span>{props.progress.chapterSentenceNumber}</span>
          <div class="progress-track" aria-hidden="true">
            <span style={{ width: `${props.progress.chapterPercent}%` }} />
          </div>
          <span>{props.progress.chapterSentenceCount}</span>
        </div>
      </div>
      <div class="essential-actions">
        <span classList={{ "narration-status": true, attention: props.narrationNotice != null }}>
          {props.narrationStatus}
        </span>
        <button
          classList={{
            "bookmark-toggle": true,
            active: props.bookmarked
          }}
          type="button"
          aria-label={props.bookmarked ? "Remove bookmark" : "Bookmark sentence"}
          aria-pressed={props.bookmarked}
          disabled={props.sentenceCount === 0}
          onClick={props.onToggleBookmark}
        >
          <BookmarkIcon />
        </button>
        <span class="speed-label">{props.playbackRate.toFixed(1)}x</span>
      </div>
    </footer>
  );
}
