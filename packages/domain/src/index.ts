export type EntityId = string;
export type IsoDateTime = string;

export interface DomainEventPayloadMap {
  BookImportRequested: { path: string | null };
  BookImported: {
    bookId: EntityId;
    title: string;
    chapterCount: number;
    replacedExisting: boolean;
  };
  BookTextExtracted: { bookId: EntityId; chapterCount: number };
  ChapterSegmented: { bookId: EntityId; chapterId: EntityId; sentenceCount: number };
  AudioPreparationRequested: SentenceRef & { voiceId: string };
  SentenceAudioReady: SentenceRef & { voiceId: string; source: "cache" | "prepared" };
  AudioPreparationFailed: SentenceRef & { voiceId: string; reason: string };
  PlaybackPositionChanged: {
    bookId: EntityId;
    chapterId: EntityId;
    sentenceIndex: number;
  };
  ReaderClosed: SentenceRef;
  WordInspected: SentenceRef & { surface: string; language: string | null };
  BookmarkCreated: SentenceRef & { bookmarkId: EntityId; sentenceIndex: number };
  BookmarkDeleted: { bookmarkId: EntityId; bookId: EntityId };
  BookExportRequested: { bookId: EntityId };
  BookExported: {
    bookId: EntityId;
    exportedAt: IsoDateTime;
    bookmarkCount: number;
    fileName: string | null;
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
