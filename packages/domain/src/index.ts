export type EntityId = string;
export type IsoDateTime = string;

export interface NarrationSettingsSnapshot {
  playbackRate: number;
  volume: number;
  autoAdvance: boolean;
  voiceId: string;
  voicePreferences: Readonly<Record<string, string>>;
}

export interface DomainEventPayloadMap {
  BookImportRequested: { path: string | null };
  BookImportCancelled: { path: string | null };
  BookImportFailed: { path: string | null; reason: string };
  BookImported: {
    bookId: EntityId;
    title: string;
    chapterCount: number;
    replacedExisting: boolean;
  };
  NarrationPlaybackRequested: SentenceRef & { voiceId: string };
  NarrationPreparationStarted: SentenceRef & { passageId: EntityId };
  PassageNarrationReady: {
    bookId: EntityId;
    chapterId: EntityId;
    passageId: EntityId;
    firstSentenceId: EntityId;
    lastSentenceId: EntityId;
    voiceId: string;
    engineId: string;
    source: "cache" | "prepared";
  };
  NarrationSentenceEntered: SentenceRef & { passageId: EntityId };
  PassageNarrationPlaybackEnded: {
    bookId: EntityId;
    chapterId: EntityId;
    passageId: EntityId;
    lastSentenceId: EntityId;
  };
  NarrationPlaybackPaused: SentenceRef & { passageId: EntityId };
  NarrationPlaybackEnded: {
    bookId: EntityId;
    chapterId: EntityId;
    passageId: EntityId;
    lastSentenceId: EntityId;
  };
  NarrationPlaybackFailed: SentenceRef & { passageId: EntityId | null; reason: string };
  NarrationResetRequested: { bookId: EntityId; chapterId: EntityId };
  NarrationSettingsChanged: {
    previousVoiceId: string;
    source: "book" | "user";
    settings: NarrationSettingsSnapshot;
  };
  UpcomingNarrationPreparationRequested: {
    bookId: EntityId;
    chapterId: EntityId;
    nextChapterId: EntityId;
    voiceId: string;
  };
  UpcomingNarrationPreparationReady: {
    bookId: EntityId;
    chapterId: EntityId;
    nextChapterId: EntityId;
    voiceId: string;
  };
  UpcomingNarrationPreparationFailed: {
    bookId: EntityId;
    chapterId: EntityId;
    nextChapterId: EntityId;
    voiceId: string;
    reason: string;
  };
  VoiceInstallationRequested: { voiceId: string };
  VoiceInstallationProgressed: {
    voiceId: string;
    status: "preparing" | "ready";
    downloadSizeBytes: number;
    downloadedBytes: number;
    progress: number | null;
    message: string;
  };
  VoiceInstallationReady: { voiceId: string };
  VoiceInstallationFailed: { voiceId: string; reason: string };
  OfflineNarrationFilesInstallationRequested: { engineId: string };
  OfflineNarrationFilesInstallationProgressed: {
    engineId: string;
    status: "preparing" | "ready";
    modelRevision: string;
    downloadSizeBytes: number;
    downloadedBytes: number;
    progress: number | null;
    message: string;
  };
  OfflineNarrationFilesInstallationReady: { engineId: string };
  OfflineNarrationFilesInstallationFailed: { engineId: string; reason: string };
  PreparedNarrationClearingRequested: { bookId: EntityId };
  PreparedNarrationCleared: { bookId: EntityId; sentenceCount: number; sizeBytes: number };
  PreparedNarrationClearingFailed: { bookId: EntityId; reason: string };
  ReaderOpened: {
    bookId: EntityId;
    chapterId: EntityId;
    sentenceId: EntityId;
    sentenceIndex: number;
    playbackStatus: "idle" | "playing" | "paused" | "ended";
    source: "library" | "sample";
  };
  ReaderClosed: SentenceRef;
  ReaderTypographyChanged: {
    contentFontSize: number;
    contentFontFamily: string | null;
    uiFontFamily: string | null;
  };
  ReaderAppearanceChanged: {
    narrationHighlightColor: string;
    bookmarkHighlightColor: string;
  };
  WordInspected: SentenceRef & { surface: string; language: string | null; tokenIndex: number };
  WordLookupStarted: { lookupId: EntityId; surface: string };
  WordLookupCompleted: {
    lookupId: EntityId;
    surface: string;
    status: "ready" | "not-found" | "error";
  };
  WordSaved: { surface: string };
  WordForgotten: { surface: string };
  BookmarkCreated: SentenceRef & { bookmarkId: EntityId; sentenceIndex: number };
  BookmarkDeleted: { bookmarkId: EntityId; bookId: EntityId };
  BookExportRequested: { bookId: EntityId };
  BookExportFailed: { bookId: EntityId; reason: string };
  BookExported: {
    bookId: EntityId;
    exportedAt: IsoDateTime;
    bookmarkCount: number;
    fileName: string | null;
  };
  ParagraphImageRequested: { bookId: EntityId; chapterId: EntityId; paragraphId: EntityId };
  ParagraphImageCreated: {
    bookId: EntityId;
    chapterId: EntityId;
    paragraphId: EntityId;
    fileName: string;
  };
  ParagraphImageFailed: {
    bookId: EntityId;
    chapterId: EntityId;
    paragraphId: EntityId;
    reason: string;
  };
}

export type DomainEventName = keyof DomainEventPayloadMap;

export interface DomainEvent<TName extends DomainEventName = DomainEventName> {
  id: EntityId;
  name: TName;
  occurredAt: IsoDateTime;
  payload: DomainEventPayloadMap[TName];
}

export type AnyDomainEvent = {
  [TName in DomainEventName]: DomainEvent<TName>;
}[DomainEventName];

export interface DomainEventMetadata {
  id?: EntityId;
  occurredAt?: IsoDateTime;
}

export type DomainEventHandler<TName extends DomainEventName> = (
  event: DomainEvent<TName>
) => void | Promise<void>;

export interface DomainEventDispatcher {
  dispatch<TName extends DomainEventName>(event: DomainEvent<TName>): Promise<void>;
  subscribe<TName extends DomainEventName>(
    name: TName,
    handler: DomainEventHandler<TName>
  ): () => void;
}

export class DomainEventDispatchError extends Error {
  readonly failures: readonly unknown[];

  constructor(eventName: DomainEventName, failures: readonly unknown[]) {
    super(`${eventName} reaction failed.`);
    this.name = "DomainEventDispatchError";
    this.failures = failures;
  }
}

export function createDomainEventDispatcher(): DomainEventDispatcher {
  const handlers = new Map<DomainEventName, Set<DomainEventHandler<DomainEventName>>>();

  return {
    async dispatch(event) {
      const subscribed = [...(handlers.get(event.name) ?? [])];
      const failures: unknown[] = [];

      for (const handler of subscribed) {
        try {
          await handler(event);
        } catch (error) {
          failures.push(error);
        }
      }

      if (failures.length > 0) {
        throw new DomainEventDispatchError(event.name, failures);
      }
    },
    subscribe(name, handler) {
      const subscribed = handlers.get(name) ?? new Set<DomainEventHandler<DomainEventName>>();
      subscribed.add(handler as DomainEventHandler<DomainEventName>);
      handlers.set(name, subscribed);

      return () => {
        subscribed.delete(handler as DomainEventHandler<DomainEventName>);
        if (subscribed.size === 0) handlers.delete(name);
      };
    }
  };
}

export function createDomainEvent<TName extends DomainEventName>(
  name: TName,
  payload: DomainEventPayloadMap[TName],
  metadata: DomainEventMetadata = {}
): DomainEvent<TName> {
  return {
    id: metadata.id ?? crypto.randomUUID(),
    name,
    occurredAt: metadata.occurredAt ?? new Date().toISOString(),
    payload
  };
}

export interface BookRef {
  id: EntityId;
  title: string;
  author: string;
}

export interface SentenceRef {
  bookId: EntityId;
  chapterId: EntityId;
  sentenceId: EntityId;
}

const languageAliases: Readonly<Record<string, string>> = {
  deu: "de",
  eng: "en",
  fra: "fr",
  fre: "fr",
  ger: "de",
  ita: "it",
  por: "pt",
  spa: "es"
};

export function normalizeLanguageCode(language: string | null | undefined): string | null {
  if (language == null) return null;

  const code = language.trim().toLocaleLowerCase().split(/[-_]/u)[0];
  if (code.length === 0) return null;
  return languageAliases[code] ?? code;
}
