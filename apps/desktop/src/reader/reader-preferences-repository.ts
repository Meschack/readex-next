import {
  parseReaderPreferences,
  serializeReaderPreferences,
  type ReaderPreferences
} from "@readex/reader";

const readerPreferencesStorageKey = "readex.reader.preferences.v1";

export interface ReaderPreferencesRepository {
  load(): ReaderPreferences;
  save(preferences: ReaderPreferences): void;
}

export function createReaderPreferencesRepository(): ReaderPreferencesRepository {
  return {
    load() {
      if (typeof localStorage === "undefined") return parseReaderPreferences(null);
      return parseReaderPreferences(localStorage.getItem(readerPreferencesStorageKey));
    },

    save(preferences) {
      if (typeof localStorage === "undefined") return;
      localStorage.setItem(readerPreferencesStorageKey, serializeReaderPreferences(preferences));
    }
  };
}
