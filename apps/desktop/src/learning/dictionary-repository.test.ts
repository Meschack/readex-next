// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { createDictionaryRepository } from "./dictionary-repository";

describe("dictionary repository", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns a French definition from the French Wiktionary endpoint", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        parse: {
          title: "croyance",
          pageid: 156249,
          text: `<div class="mw-parser-output">
            <div class="mw-heading mw-heading2"><h2><span class="sectionlangue" id="fr">Français</span></h2></div>
            <div class="mw-heading mw-heading3"><h3><span class="titredef" id="fr-nom-1">Nom commun</span></h3></div>
            <p><b>croyance</b> <span class="API" title="Prononciation API">\\kʁwa.jɑ̃s\\</span></p>
            <ol><li>Connaissance considérée comme irréfutable sans qu’elle soit basée sur des preuves.
              <ul><li><span class="example"><q>Cette croyance résiste aux faits.</q></span></li></ul>
            </li></ol>
            <div class="mw-heading mw-heading2"><h2><span class="sectionlangue" id="en">Anglais</span></h2></div>
            <div class="mw-heading mw-heading3"><h3><span class="titredef">Noun</span></h3></div>
            <ol><li>belief</li></ol>
          </div>`
        }
      })
    }));
    vi.stubGlobal("fetch", fetchMock);

    const entry = await createDictionaryRepository().lookupWord("croyance", "fr-FR");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://fr.wiktionary.org/w/api.php?action=parse&page=croyance&prop=text&format=json&formatversion=2&origin=*"
    );
    expect(entry).toMatchObject({
      key: "croyance",
      word: "croyance",
      phonetic: "/kʁwa.jɑ̃s/",
      sourceUrl: "https://fr.wiktionary.org/wiki/croyance",
      meanings: [
        {
          partOfSpeech: "Nom commun",
          definitions: [
            {
              definition:
                "Connaissance considérée comme irréfutable sans qu’elle soit basée sur des preuves.",
              example: "Cette croyance résiste aux faits."
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
