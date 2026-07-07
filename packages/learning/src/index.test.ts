import { describe, expect, it } from "vitest";
import {
  createSavedDictionary,
  createWordInsight,
  dictionaryLookupFailed,
  dictionaryLookupNotFound,
  dictionaryLookupReady,
  forgetDictionaryEntry,
  listSavedDictionaryEntries,
  parseDictionaryApiResponse,
  parseSavedDictionary,
  primaryDefinition,
  saveDictionaryEntry,
  serializeSavedDictionary
} from "./index";

const fetchedAt = "2026-01-01T00:00:00.000Z";

describe("dictionary insight", () => {
  it("parses definitions from the public dictionary API shape", () => {
    const entry = parseDictionaryApiResponse(
      "cadence",
      [
        {
          word: "cadence",
          phonetic: "/ˈkeɪdəns/",
          phonetics: [
            {
              text: "/ˈkeɪdəns/",
              audio: "//example.test/cadence.mp3"
            }
          ],
          meanings: [
            {
              partOfSpeech: "noun",
              definitions: [
                {
                  definition: "The rhythm or flow of a sequence of sounds or words.",
                  example: "The narrator's cadence slowed near the comma.",
                  synonyms: ["rhythm"],
                  antonyms: []
                }
              ]
            }
          ],
          sourceUrls: ["https://en.wiktionary.org/wiki/cadence"]
        }
      ],
      fetchedAt
    );

    expect(entry).toMatchObject({
      key: "cadence",
      word: "cadence",
      phonetic: "/ˈkeɪdəns/",
      audioUrl: "https://example.test/cadence.mp3",
      fetchedAt
    });
    expect(primaryDefinition(entry)?.definition).toBe(
      "The rhythm or flow of a sequence of sounds or words."
    );
  });

  it("returns null for dictionary responses without definitions", () => {
    expect(parseDictionaryApiResponse("zzzz", { title: "No Definitions Found" })).toBeNull();
    expect(parseDictionaryApiResponse("zzzz", [{ word: "zzzz", meanings: [] }])).toBeNull();
  });

  it("composes loading, not-found, and error states without pretending to know", () => {
    expect(createWordInsight("rainfall")).toMatchObject({
      key: "rainfall",
      status: "idle",
      saved: false,
      entry: null
    });
    expect(
      createWordInsight("rainfall", createSavedDictionary(), dictionaryLookupNotFound("rainfall"))
    ).toMatchObject({
      status: "not-found",
      message: 'No dictionary definition found for "rainfall".'
    });
    expect(
      createWordInsight("rainfall", createSavedDictionary(), dictionaryLookupFailed())
    ).toMatchObject({
      status: "error",
      message: "Dictionary lookup needs attention. Please try again."
    });
  });

  it("saves entries so future insight can skip remote lookup", () => {
    const entry = parseDictionaryApiResponse(
      "margin",
      [
        {
          word: "margin",
          meanings: [
            {
              partOfSpeech: "noun",
              definitions: [{ definition: "The edge or border of something." }]
            }
          ]
        }
      ],
      fetchedAt
    );
    if (entry == null) throw new Error("entry should parse");

    const saved = saveDictionaryEntry(createSavedDictionary(), entry, "2026-01-02T00:00:00.000Z");
    const lookup = dictionaryLookupReady({
      ...entry,
      meanings: []
    });

    expect(createWordInsight("margin", saved, lookup)).toMatchObject({
      status: "ready",
      saved: true,
      entry: {
        meanings: [
          {
            partOfSpeech: "noun"
          }
        ]
      }
    });
    expect(listSavedDictionaryEntries(saved).map((word) => word.surface)).toEqual(["margin"]);
  });

  it("forgets saved entries", () => {
    const entry = parseDictionaryApiResponse(
      "margin",
      [
        {
          word: "margin",
          meanings: [
            {
              partOfSpeech: "noun",
              definitions: [{ definition: "The edge or border of something." }]
            }
          ]
        }
      ],
      fetchedAt
    );
    if (entry == null) throw new Error("entry should parse");

    const saved = saveDictionaryEntry(createSavedDictionary(), entry);

    expect(listSavedDictionaryEntries(forgetDictionaryEntry(saved, "margin"))).toEqual([]);
  });

  it("serializes defensively for app storage", () => {
    const entry = parseDictionaryApiResponse(
      "cadence",
      [
        {
          word: "cadence",
          meanings: [
            {
              partOfSpeech: "noun",
              definitions: [{ definition: "A rhythmic sequence." }]
            }
          ]
        }
      ],
      fetchedAt
    );
    if (entry == null) throw new Error("entry should parse");

    const saved = saveDictionaryEntry(createSavedDictionary(), entry, "2026-01-02T00:00:00.000Z");

    expect(parseSavedDictionary(serializeSavedDictionary(saved))).toEqual(saved);
    expect(parseSavedDictionary("{ nope")).toEqual(createSavedDictionary());
  });
});
