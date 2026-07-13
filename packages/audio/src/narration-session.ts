import { createDomainEvent, type AnyDomainEvent, type EntityId } from "@sonelle/domain";
import type {
  NarrationChapterOutline,
  NarrationEngineId,
  NarrationPassage,
  NarrationPreparationAdapter,
  NarrationPreparationRequest,
  PreparedNarration
} from "./narration-contracts";
import { createNarrationPassages, type NarrationPassageOptions } from "./narration-outline";
import { createLatestNarrationPreparation } from "./narration-preparation";
import type { ManifestAwareNarrationPlayer, NarrationOutputSettings } from "./narration-player";

export interface NarrationSessionChapter {
  outline: NarrationChapterOutline;
  engineId: NarrationEngineId;
  modelRevision: string;
  voiceId: string;
  passageOptions?: NarrationPassageOptions;
}

export interface NarrationSession {
  open(chapter: NarrationSessionChapter): void;
  play(sentenceId: EntityId): Promise<void>;
  pause(): void;
  moveTo(sentenceId: EntityId): Promise<void>;
  setOutput(settings: NarrationOutputSettings & { autoAdvance: boolean }): void;
  close(): void;
}

export interface NarrationSessionOptions {
  adapter: NarrationPreparationAdapter;
  player: ManifestAwareNarrationPlayer;
  onEvent(event: AnyDomainEvent): void;
  createRequestId?: () => EntityId;
}

interface OpenChapter extends NarrationSessionChapter {
  passages: readonly NarrationPassage[];
  passageBySentenceId: ReadonlyMap<EntityId, NarrationPassage>;
}

interface ActivePlayback {
  passageId: EntityId;
  sentenceId: EntityId;
}

export function createNarrationSession(options: NarrationSessionOptions): NarrationSession {
  const foregroundPreparation = createLatestNarrationPreparation(options.adapter);
  const prefetchPreparation = createLatestNarrationPreparation(options.adapter);
  const createRequestId = options.createRequestId ?? (() => crypto.randomUUID());
  let chapter: OpenChapter | null = null;
  let output = { playbackRate: 1, volume: 1, autoAdvance: true };
  let active: ActivePlayback | null = null;
  let generation = 0;

  const closeActive = () => {
    generation += 1;
    foregroundPreparation.cancel();
    prefetchPreparation.cancel();
    options.player.stop();
  };

  const dispatch = (event: AnyDomainEvent) => options.onEvent(event);

  const startAt = async (sentenceId: EntityId): Promise<void> => {
    const currentChapter = requireOpenChapter(chapter);
    const passage = currentChapter.passageBySentenceId.get(sentenceId);
    if (passage == null) throw new Error("Sentence does not belong to the open narration chapter.");

    const run = ++generation;
    const request = createPreparationRequest(currentChapter, passage, createRequestId());
    let prepared: PreparedNarration;

    try {
      prepared = await foregroundPreparation.prepare(request);
    } catch (error) {
      if (run !== generation) return;
      dispatch(
        createDomainEvent("NarrationPlaybackFailed", {
          bookId: currentChapter.outline.bookId,
          chapterId: currentChapter.outline.chapterId,
          sentenceId,
          passageId: passage.id,
          reason: friendlyNarrationSessionError(error)
        })
      );
      return;
    }

    if (run !== generation) return;
    const firstSentenceId = passage.sentences[0]?.id;
    const lastSentenceId = passage.sentences[passage.sentences.length - 1]?.id;
    if (firstSentenceId == null || lastSentenceId == null) return;

    dispatch(
      createDomainEvent("PassageNarrationReady", {
        bookId: passage.bookId,
        chapterId: passage.chapterId,
        passageId: passage.id,
        firstSentenceId,
        lastSentenceId,
        voiceId: prepared.voiceId,
        engineId: prepared.engineId,
        source: prepared.cached ? "cache" : "prepared"
      })
    );

    prefetchNextPassage(currentChapter, passage);

    try {
      await options.player.play(
        {
          narration: prepared,
          startSentenceId: sentenceId,
          stopAfterSentenceId: output.autoAdvance ? null : sentenceId
        },
        {
          sentenceEntered(nextSentenceId) {
            if (run !== generation) return;
            active = { passageId: passage.id, sentenceId: nextSentenceId };
            dispatch(
              createDomainEvent("NarrationSentenceEntered", {
                bookId: passage.bookId,
                chapterId: passage.chapterId,
                passageId: passage.id,
                sentenceId: nextSentenceId
              })
            );
          }
        }
      );
    } catch (error) {
      if (run !== generation) return;
      dispatch(
        createDomainEvent("NarrationPlaybackFailed", {
          bookId: passage.bookId,
          chapterId: passage.chapterId,
          passageId: passage.id,
          sentenceId,
          reason: friendlyNarrationSessionError(error)
        })
      );
      return;
    }

    if (run !== generation) return;
    if (!output.autoAdvance) {
      dispatchPaused(currentChapter, active ?? { passageId: passage.id, sentenceId }, dispatch);
      return;
    }

    const nextSentenceId = nextSentenceAfterPassage(currentChapter, passage);
    if (nextSentenceId != null) {
      await startAt(nextSentenceId);
      return;
    }

    active = { passageId: passage.id, sentenceId: lastSentenceId };
    dispatch(
      createDomainEvent("NarrationPlaybackEnded", {
        bookId: passage.bookId,
        chapterId: passage.chapterId,
        passageId: passage.id,
        lastSentenceId
      })
    );
  };

  return {
    open(nextChapter) {
      closeActive();
      const passages = createNarrationPassages(nextChapter.outline, nextChapter.passageOptions);
      chapter = {
        ...nextChapter,
        passages,
        passageBySentenceId: mapPassagesBySentenceId(passages)
      };
    },

    play(sentenceId) {
      closeActive();
      return startAt(sentenceId);
    },

    pause() {
      const currentChapter = chapter;
      const paused = active;
      closeActive();
      if (currentChapter != null && paused != null)
        dispatchPaused(currentChapter, paused, dispatch);
    },

    moveTo(sentenceId) {
      closeActive();
      return startAt(sentenceId);
    },

    setOutput(settings) {
      output = {
        playbackRate: settings.playbackRate,
        volume: settings.volume,
        autoAdvance: settings.autoAdvance
      };
      options.player.setOutput({
        playbackRate: settings.playbackRate,
        volume: settings.volume
      });
    },

    close() {
      closeActive();
      active = null;
      chapter = null;
    }
  };

  function prefetchNextPassage(currentChapter: OpenChapter, passage: NarrationPassage) {
    const index = currentChapter.passages.findIndex((candidate) => candidate.id === passage.id);
    const nextPassage = currentChapter.passages[index + 1];
    if (nextPassage == null) return;

    void prefetchPreparation
      .prepare(createPreparationRequest(currentChapter, nextPassage, createRequestId()))
      .catch(() => {
        // Prefetch is best-effort; foreground playback will surface any real error.
      });
  }
}

function dispatchPaused(
  chapter: OpenChapter,
  active: ActivePlayback,
  dispatch: (event: AnyDomainEvent) => void
) {
  const passage = chapter.passages.find((candidate) => candidate.id === active.passageId);
  if (passage == null) return;

  dispatch(
    createDomainEvent("NarrationPlaybackPaused", {
      bookId: passage.bookId,
      chapterId: passage.chapterId,
      passageId: passage.id,
      sentenceId: active.sentenceId
    })
  );
}

function createPreparationRequest(
  chapter: OpenChapter,
  passage: NarrationPassage,
  requestId: EntityId
): NarrationPreparationRequest {
  return {
    requestId,
    passage,
    engineId: chapter.engineId,
    modelRevision: chapter.modelRevision,
    voiceId: chapter.voiceId,
    sourceTextDigest: digestPassageText(passage)
  };
}

function mapPassagesBySentenceId(
  passages: readonly NarrationPassage[]
): ReadonlyMap<EntityId, NarrationPassage> {
  const mapped = new Map<EntityId, NarrationPassage>();
  for (const passage of passages) {
    for (const sentence of passage.sentences) mapped.set(sentence.id, passage);
  }
  return mapped;
}

function nextSentenceAfterPassage(
  chapter: OpenChapter,
  passage: NarrationPassage
): EntityId | null {
  const lastSentence = passage.sentences[passage.sentences.length - 1];
  if (lastSentence == null) return null;
  return chapter.outline.sentences[lastSentence.index + 1]?.id ?? null;
}

function requireOpenChapter(chapter: OpenChapter | null): OpenChapter {
  if (chapter == null) throw new Error("Open a narration chapter before controlling playback.");
  return chapter;
}

function digestPassageText(passage: NarrationPassage): string {
  let hash = 2_166_136_261;
  for (const sentence of passage.sentences) {
    const value = `${sentence.id}\n${sentence.text}\n`;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16_777_619);
    }
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function friendlyNarrationSessionError(error: unknown): string {
  return error instanceof Error ? error.message : "Narration needs attention.";
}
