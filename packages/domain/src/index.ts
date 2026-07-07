export type EntityId = string;
export type IsoDateTime = string;

export type DomainEventName =
  | "BookImportRequested"
  | "BookImported"
  | "BookTextExtracted"
  | "ChapterSegmented"
  | "AudioPreparationRequested"
  | "SentenceAudioReady"
  | "AudioPreparationFailed"
  | "PlaybackPositionChanged"
  | "WordInspected"
  | "BookmarkCreated"
  | "BookExportRequested"
  | "BookExported";

export interface DomainEvent<TName extends DomainEventName, TPayload> {
  id: EntityId;
  name: TName;
  occurredAt: IsoDateTime;
  payload: TPayload;
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
