import { For, Show } from "solid-js";
import type { PlaybackStatus, ReaderProgress } from "@sonelle/reader";
import type { ReaderChapterNavigationItem } from "./reader-view";
import {
  BookmarkIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PreviousIcon,
  SearchIcon,
  SpeakerIcon,
  SettingsIcon
} from "./reader-icons";

export function ProductBar() {
  return (
    <header class="product-bar">
      <div class="product-brand">
        <img src="/sonelle-icon.png" alt="" aria-hidden="true" />
        <strong>Sonelle</strong>
      </div>
      <span class="product-tagline">Your private reading desk</span>
      <span class="product-local-status">
        <span aria-hidden="true" />
        Stored locally
      </span>
    </header>
  );
}

interface ReaderTopAppBarProps {
  chapterTitle: string;
  activeChapterId: string;
  chapters: ReaderChapterNavigationItem[];
  sentenceCount: number;
  onOpenSearch: () => void;
  onOpenSettings: () => void;
}

export function ReaderTopAppBar(props: ReaderTopAppBarProps) {
  const chapterNumber = () =>
    Math.max(1, props.chapters.findIndex((chapter) => chapter.id === props.activeChapterId) + 1);

  return (
    <header class="top-app-bar">
      <div class="top-reading-title">
        <span>Now reading</span>
        <strong>{props.chapterTitle}</strong>
      </div>
      <div class="top-reading-meta">
        <span>
          Chapter {chapterNumber()} of {props.chapters.length}
        </span>
        <span>
          {props.sentenceCount} sentence{props.sentenceCount === 1 ? "" : "s"}
        </span>
      </div>
      <div class="top-app-actions">
        <button type="button" aria-label="Open search" onClick={props.onOpenSearch}>
          <SearchIcon />
        </button>
        <button type="button" aria-label="Open settings" onClick={props.onOpenSettings}>
          <SettingsIcon />
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
  bookmarked: boolean;
  volume: number;
  onPrevious: () => void;
  onToggle: () => void;
  onNext: () => void;
  onToggleBookmark: () => void;
  onVolumeChange: (volume: number) => void;
  onToggleMute: () => void;
}

export function PlaybackRail(props: PlaybackRailProps) {
  const isFirstSentence = () => props.progress.chapterSentenceNumber <= 1;
  const isLastSentence = () =>
    props.progress.chapterSentenceCount === 0 ||
    props.progress.chapterSentenceNumber >= props.progress.chapterSentenceCount;

  return (
    <footer class="audio-rail" aria-label="Playback controls">
      <div class="track-info">
        <div class="book-cover player-cover">
          <Show
            when={props.coverImageSrc}
            fallback={<span aria-hidden="true">{props.bookTitle.slice(0, 1).toUpperCase()}</span>}
          >
            {(source) => <img src={source()} alt={`${props.bookTitle} cover`} />}
          </Show>
        </div>
        <div class="playback-copy">
          <strong title={props.chapterTitle}>{props.chapterTitle}</strong>
          <span title={props.author}>{props.author || "Unknown author"}</span>
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
          <span>
            {props.progress.chapterSentenceNumber} / {props.progress.chapterSentenceCount}
          </span>
          <div class="progress-track" aria-hidden="true">
            <span style={{ width: `${props.progress.bookPercent}%` }} />
          </div>
          <span>{Math.round(props.progress.bookPercent)}%</span>
        </div>
      </div>
      <div class="essential-actions">
        <div class="volume-control">
          <button
            classList={{ "volume-toggle": true, muted: props.volume === 0 }}
            type="button"
            aria-label={props.volume === 0 ? "Unmute narration" : "Mute narration"}
            aria-pressed={props.volume === 0}
            title={props.volume === 0 ? "Unmute narration" : "Mute narration"}
            onClick={props.onToggleMute}
          >
            <SpeakerIcon />
          </button>
          <input
            type="range"
            min="0"
            max="1.5"
            step="0.05"
            value={props.volume}
            aria-label="Narration volume"
            aria-valuetext={`${Math.round(props.volume * 100)} percent`}
            title={`Narration volume: ${Math.round(props.volume * 100)}%`}
            onInput={(event) => props.onVolumeChange(Number(event.currentTarget.value))}
          />
          <span>{Math.round(props.volume * 100)}%</span>
        </div>
        <button
          classList={{
            "bookmark-toggle": true,
            active: props.bookmarked
          }}
          type="button"
          aria-label={props.bookmarked ? "Remove bookmark" : "Bookmark sentence"}
          aria-pressed={props.bookmarked}
          disabled={props.sentenceCount === 0}
          title={props.bookmarked ? "Remove bookmark" : "Bookmark sentence"}
          onClick={props.onToggleBookmark}
        >
          <BookmarkIcon />
        </button>
      </div>
    </footer>
  );
}
