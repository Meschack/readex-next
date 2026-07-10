import {
  createSavedDictionary,
  normalizeInsightKey,
  parseDictionaryApiResponse,
  parseFreeDictionaryApiResponse,
  parseSavedDictionary,
  serializeSavedDictionary,
  type DictionaryEntry,
  type SavedDictionary
} from "@sonelle/learning";
import { normalizeLanguageCode } from "@sonelle/domain";

const savedDictionaryKey = "sonelle.dictionary.saved.v1";
const englishDictionaryApiUrl = "https://api.dictionaryapi.dev/api/v2/entries/en";
const multilingualDictionaryApiUrl = "https://freedictionaryapi.com/api/v1/entries";

export interface DictionaryRepository {
  lookupWord(surface: string, language?: string | null): Promise<DictionaryEntry | null>;
  loadSavedDictionary(): SavedDictionary;
  saveSavedDictionary(savedDictionary: SavedDictionary): void;
}

export function createDictionaryRepository(): DictionaryRepository {
  return {
    async lookupWord(surface, language) {
      const key = normalizeInsightKey(surface);
      if (key.length === 0) return null;

      const languageCode = normalizeLanguageCode(language) ?? "en";
      const response = await fetch(
        languageCode === "en"
          ? `${englishDictionaryApiUrl}/${encodeURIComponent(key)}`
          : `${multilingualDictionaryApiUrl}/${languageCode}/${encodeURIComponent(key)}`
      );
      if (response.status === 404) {
        if (languageCode !== "en") return null;

        return lookupAcrossLanguages(surface, key);
      }
      if (!response.ok) throw new Error("Dictionary lookup needs attention.");

      const payload = await response.json();
      return languageCode === "en"
        ? parseDictionaryApiResponse(surface, payload)
        : parseFreeDictionaryApiResponse(surface, payload, languageCode);
    },

    loadSavedDictionary() {
      if (typeof window === "undefined") return createSavedDictionary();

      try {
        return parseSavedDictionary(window.localStorage.getItem(savedDictionaryKey));
      } catch {
        return createSavedDictionary();
      }
    },

    saveSavedDictionary(savedDictionary) {
      if (typeof window === "undefined") return;

      try {
        window.localStorage.setItem(savedDictionaryKey, serializeSavedDictionary(savedDictionary));
      } catch {
        return;
      }
    }
  };
}

async function lookupAcrossLanguages(
  surface: string,
  key: string
): Promise<DictionaryEntry | null> {
  const response = await fetch(`${multilingualDictionaryApiUrl}/all/${encodeURIComponent(key)}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Dictionary lookup needs attention.");

  return parseFreeDictionaryApiResponse(surface, await response.json());
}
