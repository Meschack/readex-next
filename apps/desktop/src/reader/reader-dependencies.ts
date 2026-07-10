import { createDomainEventDispatcher, type DomainEventDispatcher } from "@sonelle/domain";
import {
  createPrefetchingNarrationGateway,
  type PrefetchingNarrationGateway
} from "@sonelle/audio";
import type { EventSink } from "@sonelle/storage";
import {
  createAudioCacheRepository,
  type AudioCacheRepository
} from "../audio/audio-cache-repository";
import {
  createAudioSettingsRepository,
  type AudioSettingsRepository
} from "../audio/audio-settings-repository";
import { createHtmlAudioPlayer, type HtmlAudioPlayer } from "../audio/html-audio-player";
import { createNarrationRepository } from "../audio/narration-repository";
import {
  createDictionaryRepository,
  type DictionaryRepository
} from "../learning/dictionary-repository";
import {
  createBookRepository,
  listenForBookDrops,
  type BookDropEvent,
  type BookRepository
} from "../library/book-repository";
import {
  createReaderPreferencesRepository,
  type ReaderPreferencesRepository
} from "./reader-preferences-repository";
import { createDomainEventSink } from "./domain-event-sink";

export interface ReaderExperienceDependencies {
  audioCacheRepository: AudioCacheRepository;
  audioSettingsRepository: AudioSettingsRepository;
  bookRepository: BookRepository;
  dictionaryRepository: DictionaryRepository;
  eventDispatcher: DomainEventDispatcher;
  eventSink: EventSink;
  htmlAudioPlayer: HtmlAudioPlayer;
  listenForBookDrops(onEvent: (event: BookDropEvent) => void): Promise<() => void>;
  narrationRepository: PrefetchingNarrationGateway;
  readerPreferencesRepository: ReaderPreferencesRepository;
}

export function createReaderExperienceDependencies(): ReaderExperienceDependencies {
  return {
    audioCacheRepository: createAudioCacheRepository(),
    audioSettingsRepository: createAudioSettingsRepository(),
    bookRepository: createBookRepository(),
    dictionaryRepository: createDictionaryRepository(),
    eventDispatcher: createDomainEventDispatcher(),
    eventSink: createDomainEventSink(),
    htmlAudioPlayer: createHtmlAudioPlayer(),
    listenForBookDrops,
    narrationRepository: createPrefetchingNarrationGateway(createNarrationRepository()),
    readerPreferencesRepository: createReaderPreferencesRepository()
  };
}
