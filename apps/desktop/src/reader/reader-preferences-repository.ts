import {
  createReaderPreferences,
  DEFAULT_READER_PREFERENCES,
  parseReaderPreferences,
  serializeReaderPreferences,
  type ReaderPreferences
} from "@sonelle/reader";

const readerPreferencesStorageKey = "sonelle.reader.preferences.v2";
const legacyReaderPreferencesStorageKey = "sonelle.reader.preferences.v1";

export interface ReaderPreferencesRepository {
  load(): ReaderPreferences;
  save(preferences: ReaderPreferences): void;
}

export function createReaderPreferencesRepository(): ReaderPreferencesRepository {
  return {
    load() {
      if (typeof localStorage === "undefined") return parseReaderPreferences(null);
      const current = localStorage.getItem(readerPreferencesStorageKey);
      if (current != null) return parseReaderPreferences(current);

      const legacy = parseReaderPreferences(
        localStorage.getItem(legacyReaderPreferencesStorageKey)
      );
      return createReaderPreferences({
        ...legacy,
        libraryRailWidth: DEFAULT_READER_PREFERENCES.libraryRailWidth,
        inspectorRailWidth: DEFAULT_READER_PREFERENCES.inspectorRailWidth
      });
    },

    save(preferences) {
      if (typeof localStorage === "undefined") return;
      localStorage.setItem(readerPreferencesStorageKey, serializeReaderPreferences(preferences));
    }
  };
}
