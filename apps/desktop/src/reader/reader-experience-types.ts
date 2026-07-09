import type { PlaybackStatus, ReaderToolTab } from "@readex/reader";

export type InspectorTab = ReaderToolTab;
export type AppView = "reader" | "library";

export interface SelectedWord {
  sentenceId: string;
  tokenIndex: number;
  surface: string;
}

export interface OpenBookOptions {
  chapterId?: string;
  sentenceIndex?: number;
  playbackStatus?: PlaybackStatus;
}
