import {
  createSavedDictionary,
  normalizeInsightKey,
  parseDictionaryApiResponse,
  parseSavedDictionary,
  serializeSavedDictionary,
  type DictionaryEntry,
  type SavedDictionary
} from "@readex/learning";

const savedDictionaryKey = "readex.dictionary.saved.v1";
const dictionaryApiUrl = "https://api.dictionaryapi.dev/api/v2/entries/en";

export interface DictionaryRepository {
  lookupWord(surface: string): Promise<DictionaryEntry | null>;
  loadSavedDictionary(): SavedDictionary;
  saveSavedDictionary(savedDictionary: SavedDictionary): void;
}

export function createDictionaryRepository(): DictionaryRepository {
  return {
    async lookupWord(surface) {
      const key = normalizeInsightKey(surface);
      if (key.length === 0) return null;

      const response = await fetch(`${dictionaryApiUrl}/${encodeURIComponent(key)}`);
      if (response.status === 404) return null;
      if (!response.ok) throw new Error("Dictionary lookup needs attention.");

      return parseDictionaryApiResponse(surface, await response.json());
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
