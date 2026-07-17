import type { AudioSettings } from "@sonelle/audio";
import type { DomainEvent, DomainEventDispatcher } from "@sonelle/domain";
import {
  createReadingPositionScheduler,
  movePlayback,
  pausePlayback,
  playPlayback,
  projectNarrationEventToPlayback,
  selectPlaybackSentence,
  type NarrationPlaybackProjectionEvent,
  type PlaybackStatus,
  type ReaderPlaybackState
} from "@sonelle/reader";
import type { ReadingPositionStore, SaveReadingPositionInput } from "../library/library-contracts";
import { nextReaderChapter } from "./reader-chapter-flow";
import type { ReaderNarrationWorkflow } from "./reader-narration-workflow";
import type { ReaderNarrationSettingsWorkflow } from "./reader-narration-settings-workflow";
import type { ReaderView } from "./reader-view";

type PositionSaveIntent = "immediate" | "playback";

interface ReaderPlaybackApplicationDependencies {
  narration: ReaderNarrationWorkflow;
  settings: Pick<ReaderNarrationSettingsWorkflow, "activate">;
  eventDispatcher: DomainEventDispatcher;
  positions: ReadingPositionStore;
  preparesAcrossChapters: boolean;
  reportEventError(error: unknown): void;
  reportPlaybackError(
    event: Extract<NarrationPlaybackProjectionEvent, { name: "NarrationPlaybackFailed" }>
  ): void;
}

interface ReaderPlaybackApplicationOptions {
  currentReader(): ReaderView;
  currentPlayback(): ReaderPlaybackState;
  currentSettings(): AudioSettings;
  narrationAudible(): boolean;
  narrationReadinessMessage(): string | null;
  projectPlayback(update: (current: ReaderPlaybackState) => ReaderPlaybackState): void;
  projectNotice(message: string | null): void;
  projectAudible(audible: boolean): void;
  projectPreparing(preparing: boolean): void;
  projectJump(update: (current: ReaderPlaybackState) => ReaderPlaybackState): void;
  projectReaderActivation(reader: ReaderView, playback: ReaderPlaybackState): void;
  clearSentenceElements(): void;
  advanceChapter(reader: ReaderView, nextChapterId: string): Promise<void>;
  reportPositionError(): void;
}

export interface ReaderPlaybackApplication {
  start(): () => void;
  playbackChanged(): () => void;
  autoAdvanceChanged(): void;
  prefetchChanged(): void;
  positionChanged(): void;
  toggle(): void;
  move(direction: -1 | 1): void;
  select(sentenceIndex: number): void;
  activate(
    reader: ReaderView,
    sentenceIndex?: number,
    playbackStatus?: PlaybackStatus
  ): Promise<void>;
  projectNarration(event: NarrationPlaybackProjectionEvent): void;
  stop(): Promise<void>;
  jumpStatus(): PlaybackStatus;
  dispose(): void;
}

export function createReaderPlaybackApplication(
  dependencies: ReaderPlaybackApplicationDependencies,
  options: ReaderPlaybackApplicationOptions
): ReaderPlaybackApplication {
  let positionSaveSettled = Promise.resolve();
  const positionScheduler = createReadingPositionScheduler<SaveReadingPositionInput>({
    delayMs: 2_500,
    save(position) {
      positionSaveSettled = positionSaveSettled
        .then(() => dependencies.positions.save(position))
        .catch(() => options.reportPositionError());
      return positionSaveSettled;
    }
  });
  let nextPositionSaveIntent: PositionSaveIntent | null = null;
  let sessionProjectedPlaybackChange = false;
  let chapterTransitionRun = 0;
  let chapterTransitionTimer: ReturnType<typeof setTimeout> | undefined;

  const pauseNarration = () => {
    void dependencies.narration.pause().catch(dependencies.reportEventError);
  };

  const cancelChapterTransition = () => {
    chapterTransitionRun += 1;
    if (chapterTransitionTimer != null) {
      clearTimeout(chapterTransitionTimer);
      chapterTransitionTimer = undefined;
    }
  };

  const stopPlaybackNow = () => {
    sessionProjectedPlaybackChange = false;
    options.projectAudible(false);
    cancelChapterTransition();
    pauseNarration();
  };

  const commitJump = (resolve: (current: ReaderPlaybackState) => ReaderPlaybackState) => {
    nextPositionSaveIntent = "immediate";
    options.projectJump(resolve);
    void dependencies.narration.reset();
  };

  const isUserVoiceChange = (event: DomainEvent<"NarrationSettingsChanged">) =>
    event.payload.source === "user" &&
    event.payload.previousVoiceId !== event.payload.settings.voiceId;

  return {
    start() {
      const subscriptions = [
        dependencies.eventDispatcher.subscribe("NarrationSettingsChanged", (event) => {
          if (isUserVoiceChange(event)) void dependencies.narration.reset();
        }),
        dependencies.eventDispatcher.subscribe("NarrationSettingsChanged", (event) => {
          if (isUserVoiceChange(event)) options.projectNotice(null);
        }),
        dependencies.eventDispatcher.subscribe("NarrationSettingsChanged", (event) => {
          if (isUserVoiceChange(event)) options.projectAudible(false);
        }),
        dependencies.eventDispatcher.subscribe("NarrationSettingsChanged", (event) => {
          if (isUserVoiceChange(event)) options.projectPlayback(pausePlayback);
        })
      ];
      return () => subscriptions.forEach((unsubscribe) => unsubscribe());
    },
    playbackChanged() {
      const playback = options.currentPlayback();
      const reader = options.currentReader();
      const sentence = reader.sentences[playback.activeSentenceIndex];
      const ignoreSessionProjection = sessionProjectedPlaybackChange;
      sessionProjectedPlaybackChange = false;
      if (ignoreSessionProjection || playback.status !== "playing" || sentence == null) {
        return () => undefined;
      }

      dependencies.narration.requestPlayback(sentence.id);
      return () => {
        if (!sessionProjectedPlaybackChange) pauseNarration();
      };
    },
    autoAdvanceChanged() {
      cancelChapterTransition();
      const playback = options.currentPlayback();
      const reader = options.currentReader();
      const nextChapter = nextReaderChapter(reader.chapters, reader.chapter.id);
      if (
        playback.status !== "ended" ||
        !options.currentSettings().autoAdvance ||
        nextChapter == null
      ) {
        return;
      }

      const runId = chapterTransitionRun;
      chapterTransitionTimer = setTimeout(() => {
        chapterTransitionTimer = undefined;
        if (runId !== chapterTransitionRun) return;
        const current = options.currentReader();
        if (current.book.id !== reader.book.id || current.chapter.id !== reader.chapter.id) return;
        void options.advanceChapter(reader, nextChapter.id);
      }, 5_000);
    },
    prefetchChanged() {
      const playback = options.currentPlayback();
      const reader = options.currentReader();
      const settings = options.currentSettings();
      if (
        playback.status !== "playing" ||
        !settings.autoAdvance ||
        reader.source !== "library" ||
        !dependencies.preparesAcrossChapters
      ) {
        return;
      }

      const nextChapter = nextReaderChapter(reader.chapters, reader.chapter.id);
      if (nextChapter == null || nextChapter.sentenceCount <= 0) return;
      dependencies.narration.prefetchUpcoming({
        bookId: reader.book.id,
        chapterId: reader.chapter.id,
        nextChapterId: nextChapter.id,
        voiceId: settings.voiceId
      });
    },
    positionChanged() {
      const reader = options.currentReader();
      const playback = options.currentPlayback();
      const sentence = reader.sentences[playback.activeSentenceIndex];
      const saveIntent = nextPositionSaveIntent;
      nextPositionSaveIntent = null;
      if (reader.source !== "library" || sentence == null) {
        if (reader.source !== "library") positionScheduler.flush();
        return;
      }

      const position = {
        bookId: reader.book.id,
        chapterId: reader.chapter.id,
        sentenceIndex: sentence.index
      };
      if (saveIntent === "immediate" || playback.status !== "playing") {
        positionScheduler.saveNow(position);
      } else {
        positionScheduler.schedulePlaybackSave(position);
      }
    },
    toggle() {
      const readinessMessage = options.narrationReadinessMessage();
      if (readinessMessage != null) {
        stopPlaybackNow();
        options.projectPlayback(pausePlayback);
        options.projectNotice(readinessMessage);
        return;
      }

      if (options.currentPlayback().status === "playing" || options.narrationAudible()) {
        stopPlaybackNow();
        options.projectPlayback(pausePlayback);
        return;
      }
      options.projectPlayback((current) =>
        playPlayback(current, options.currentReader().sentences.length)
      );
    },
    move(direction) {
      commitJump((current) =>
        movePlayback(current, options.currentReader().sentences.length, direction)
      );
    },
    select(sentenceIndex) {
      commitJump((current) =>
        selectPlaybackSentence(current, options.currentReader().sentences.length, sentenceIndex)
      );
    },
    async activate(
      nextReader,
      sentenceIndex = nextReader.initialSentenceIndex,
      playbackStatus = "idle"
    ) {
      const previousReader = options.currentReader();
      const switchingBooks =
        nextReader.book.id !== previousReader.book.id ||
        nextReader.source !== previousReader.source;
      if (switchingBooks) dependencies.settings.activate(nextReader.book.language);
      positionScheduler.flush();
      await positionSaveSettled;
      nextPositionSaveIntent = "immediate";
      options.clearSentenceElements();
      await dependencies.narration.reset().catch(dependencies.reportEventError);
      options.projectReaderActivation(
        nextReader,
        selectPlaybackSentence(
          { activeSentenceIndex: sentenceIndex, status: playbackStatus },
          nextReader.sentences.length,
          sentenceIndex
        )
      );
    },
    projectNarration(event) {
      const reader = options.currentReader();
      if (
        reader.book.id !== event.payload.bookId ||
        reader.chapter.id !== event.payload.chapterId
      ) {
        return;
      }
      nextPositionSaveIntent = event.name === "NarrationSentenceEntered" ? "playback" : "immediate";
      options.projectPreparing(false);
      options.projectAudible(event.name === "NarrationSentenceEntered");
      sessionProjectedPlaybackChange = true;
      options.projectPlayback((current) =>
        projectNarrationEventToPlayback(
          current,
          reader.sentences.map((sentence) => sentence.id),
          event
        )
      );
      if (event.name === "NarrationPlaybackFailed") {
        options.projectNotice(event.payload.reason);
        dependencies.reportPlaybackError(event);
      }
    },
    async stop() {
      cancelChapterTransition();
      positionScheduler.flush();
      await positionSaveSettled;
      await dependencies.narration.pause().catch(dependencies.reportEventError);
      options.projectAudible(false);
      options.projectPlayback(pausePlayback);
    },
    jumpStatus() {
      const status = options.currentPlayback().status;
      return status === "ended" ? "paused" : status;
    },
    dispose() {
      cancelChapterTransition();
      positionScheduler.flush();
    }
  };
}
