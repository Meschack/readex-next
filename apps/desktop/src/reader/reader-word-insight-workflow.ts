import { createDomainEvent, type DomainEvent, type DomainEventDispatcher } from "@sonelle/domain";
import {
  loadingDictionaryLookup,
  normalizeInsightKey,
  forgetDictionaryEntry,
  saveDictionaryEntry,
  type DictionaryLookupResult,
  type SavedDictionary,
  type WordInsight
} from "@sonelle/learning";
import type { DictionaryRepository } from "../learning/dictionary-repository";
import { lookupReaderWord } from "./reader-word-lookup";

export interface WordInspectionRequest {
  bookId: string;
  chapterId: string;
  sentenceId: string;
  tokenIndex: number;
  surface: string;
  language: string | null;
}

interface ReaderWordInsightWorkflowDependencies {
  dictionary: DictionaryRepository;
  eventDispatcher: DomainEventDispatcher;
  createLookupId?: () => string;
  onEventError?(error: unknown): void;
}

interface ReaderWordInsightWorkflowOptions {
  savedDictionary(): SavedDictionary;
  projectSelection(selection: { sentenceId: string; tokenIndex: number; surface: string }): void;
  projectLookup(key: string, result: DictionaryLookupResult): void;
  projectSavedDictionary(dictionary: SavedDictionary): void;
  openWordInspector(): void;
}

export interface ReaderWordInsightWorkflow {
  inspect(input: WordInspectionRequest): void;
  save(insight: WordInsight): Promise<void>;
  forget(surface: string): Promise<void>;
  start(): () => void;
}

export function createReaderWordInsightWorkflow(
  dependencies: ReaderWordInsightWorkflowDependencies,
  options: ReaderWordInsightWorkflowOptions
): ReaderWordInsightWorkflow {
  const createLookupId = dependencies.createLookupId ?? (() => crypto.randomUUID());
  const results = new Map<string, DictionaryLookupResult>();

  const publish = async (event: Parameters<DomainEventDispatcher["dispatch"]>[0]) => {
    try {
      await dependencies.eventDispatcher.dispatch(event);
    } catch (error) {
      try {
        dependencies.onEventError?.(error);
      } catch {
        // Event diagnostics are observers, not lookup control flow.
      }
    }
  };

  const lookup = async (event: DomainEvent<"WordInspected">) => {
    const key = normalizeInsightKey(event.payload.surface);
    if (key.length === 0 || options.savedDictionary().entries[key] != null) return;

    const lookupId = createLookupId();
    await publish(
      createDomainEvent("WordLookupStarted", { lookupId, surface: event.payload.surface })
    );
    const result = await lookupReaderWord(event, { dictionaryRepository: dependencies.dictionary });
    results.set(lookupId, result);
    await publish(
      createDomainEvent("WordLookupCompleted", {
        lookupId,
        surface: event.payload.surface,
        status: result.status === "loading" || result.status === "idle" ? "error" : result.status
      })
    );
    results.delete(lookupId);
  };

  return {
    inspect(input) {
      void publish(createDomainEvent("WordInspected", input));
    },
    async save(insight) {
      if (insight.entry == null) return;
      const next = saveDictionaryEntry(options.savedDictionary(), insight.entry);
      dependencies.dictionary.saveSavedDictionary(next);
      await publish(createDomainEvent("WordSaved", { surface: insight.entry.surface }));
    },
    async forget(surface) {
      const next = forgetDictionaryEntry(options.savedDictionary(), surface);
      dependencies.dictionary.saveSavedDictionary(next);
      await publish(createDomainEvent("WordForgotten", { surface }));
    },
    start() {
      const subscriptions = [
        dependencies.eventDispatcher.subscribe("WordInspected", (event) => {
          options.projectSelection({
            sentenceId: event.payload.sentenceId,
            tokenIndex: event.payload.tokenIndex,
            surface: event.payload.surface
          });
          options.openWordInspector();
        }),
        dependencies.eventDispatcher.subscribe("WordInspected", lookup),
        dependencies.eventDispatcher.subscribe("WordLookupStarted", (event) => {
          options.projectLookup(
            normalizeInsightKey(event.payload.surface),
            loadingDictionaryLookup()
          );
        }),
        dependencies.eventDispatcher.subscribe("WordLookupCompleted", (event) => {
          const result = results.get(event.payload.lookupId);
          if (result != null) {
            options.projectLookup(normalizeInsightKey(event.payload.surface), result);
          }
        }),
        dependencies.eventDispatcher.subscribe("WordSaved", () => {
          options.projectSavedDictionary(dependencies.dictionary.loadSavedDictionary());
        }),
        dependencies.eventDispatcher.subscribe("WordForgotten", () => {
          options.projectSavedDictionary(dependencies.dictionary.loadSavedDictionary());
        })
      ];
      return () => subscriptions.forEach((unsubscribe) => unsubscribe());
    }
  };
}
