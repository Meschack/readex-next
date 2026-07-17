import { describe, expect, it, vi } from "vitest";
import { createDomainEventDispatcher, type AnyDomainEvent } from "@sonelle/domain";
import {
  createSavedDictionary,
  createWordInsight,
  type DictionaryEntry,
  type DictionaryLookupResult,
  type SavedDictionary
} from "@sonelle/learning";
import { createReaderWordInsightWorkflow } from "./reader-word-insight-workflow";

describe("reader word insight workflow", () => {
  it("turns inspection and lookup into published facts before projecting results", async () => {
    const dispatcher = createDomainEventDispatcher();
    const events: AnyDomainEvent[] = [];
    for (const name of [
      "WordInspected",
      "WordLookupStarted",
      "WordLookupCompleted",
      "WordSaved",
      "WordForgotten"
    ] as const) {
      dispatcher.subscribe(name, (event) => {
        events.push(event as AnyDomainEvent);
      });
    }
    const selections: string[] = [];
    const lookups: DictionaryLookupResult[] = [];
    const savedProjections: SavedDictionary[] = [];
    let savedDictionary = createSavedDictionary();
    const entry: DictionaryEntry = {
      key: "bonjour",
      surface: "Bonjour",
      word: "bonjour",
      phonetic: null,
      audioUrl: null,
      meanings: [],
      sourceUrl: "dictionary",
      fetchedAt: "2026-07-15T00:00:00.000Z"
    };
    const workflow = createReaderWordInsightWorkflow(
      {
        dictionary: {
          lookupWord: vi.fn().mockResolvedValue(entry),
          loadSavedDictionary: () => savedDictionary,
          saveSavedDictionary: (next) => {
            savedDictionary = next;
          }
        },
        eventDispatcher: dispatcher,
        createLookupId: () => "lookup-1"
      },
      {
        savedDictionary: () => savedDictionary,
        projectSelection: (selection) => selections.push(selection.surface),
        projectLookup: (_key, lookup) => lookups.push(lookup),
        projectSavedDictionary: (dictionary) => savedProjections.push(dictionary),
        openWordInspector: vi.fn()
      }
    );
    const stop = workflow.start();

    workflow.inspect({
      bookId: "book-1",
      chapterId: "chapter-1",
      sentenceId: "sentence-1",
      tokenIndex: 2,
      surface: "Bonjour",
      language: "fr"
    });

    await vi.waitFor(() => expect(lookups[lookups.length - 1]?.status).toBe("ready"));
    expect(selections).toEqual(["Bonjour"]);
    expect(events.map((event) => event.name)).toEqual([
      "WordInspected",
      "WordLookupStarted",
      "WordLookupCompleted"
    ]);

    await workflow.save(
      createWordInsight("Bonjour", savedDictionary, {
        status: "ready",
        entry,
        message: null
      })
    );
    await workflow.forget("Bonjour");

    expect(events.slice(-2).map((event) => event.name)).toEqual(["WordSaved", "WordForgotten"]);
    expect(savedProjections).toHaveLength(2);
    expect(savedProjections[1]?.entries).toEqual({});
    stop();
  });
});
