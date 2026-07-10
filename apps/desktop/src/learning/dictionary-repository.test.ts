import { afterEach, describe, expect, it, vi } from "vitest";
import { createDictionaryRepository } from "./dictionary-repository";

describe("dictionary repository", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("looks up French words through the multilingual dictionary endpoint", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        word: "bonjour",
        entries: [
          {
            language: { code: "fr", name: "French" },
            partOfSpeech: "interjection",
            pronunciations: [{ text: "/bɔ̃.ʒuʁ/" }],
            senses: [
              {
                definition: "greetings; hello (general salutation)",
                examples: ["Bonjour, comment allez-vous ?"],
                synonyms: [],
                antonyms: []
              }
            ]
          }
        ],
        source: { url: "https://en.wiktionary.org/wiki/bonjour" }
      })
    }));
    vi.stubGlobal("fetch", fetchMock);

    const entry = await createDictionaryRepository().lookupWord("bonjour", "fr-FR");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://freedictionaryapi.com/api/v1/entries/fr/bonjour"
    );
    expect(entry).toMatchObject({
      key: "bonjour",
      word: "bonjour",
      phonetic: "/bɔ̃.ʒuʁ/",
      sourceUrl: "https://en.wiktionary.org/wiki/bonjour",
      meanings: [
        {
          partOfSpeech: "interjection",
          definitions: [
            {
              definition: "greetings; hello (general salutation)",
              example: "Bonjour, comment allez-vous ?"
            }
          ]
        }
      ]
    });
  });

  it("falls back to multilingual entries when an older book has no language metadata", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          word: "maison",
          entries: [
            {
              language: { code: "fr", name: "French" },
              partOfSpeech: "noun",
              senses: [{ definition: "house", examples: [], synonyms: [], antonyms: [] }]
            }
          ],
          source: { url: "https://en.wiktionary.org/wiki/maison" }
        })
      });
    vi.stubGlobal("fetch", fetchMock);

    const entry = await createDictionaryRepository().lookupWord("maison");

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://freedictionaryapi.com/api/v1/entries/all/maison"
    );
    expect(entry?.meanings[0]?.definitions[0]?.definition).toBe("house");
  });
});
