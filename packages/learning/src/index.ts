export type DictionaryLookupStatus = "idle" | "loading" | "ready" | "not-found" | "error";

export interface DictionaryDefinition {
  definition: string;
  example: string | null;
  synonyms: string[];
  antonyms: string[];
}

export interface DictionaryMeaning {
  partOfSpeech: string;
  definitions: DictionaryDefinition[];
}

export interface DictionaryEntry {
  key: string;
  surface: string;
  word: string;
  phonetic: string | null;
  audioUrl: string | null;
  meanings: DictionaryMeaning[];
  sourceUrl: string;
  fetchedAt: string;
}

export interface SavedDictionaryEntry extends DictionaryEntry {
  savedAt: string;
}

export interface SavedDictionary {
  entries: Record<string, SavedDictionaryEntry>;
}

export interface DictionaryLookupResult {
  status: DictionaryLookupStatus;
  entry: DictionaryEntry | null;
  message: string | null;
}

export interface WordInsight {
  key: string;
  surface: string;
  status: DictionaryLookupStatus;
  entry: DictionaryEntry | null;
  saved: boolean;
  message: string | null;
}

interface DictionaryApiEntry {
  word?: unknown;
  phonetic?: unknown;
  phonetics?: unknown;
  meanings?: unknown;
  sourceUrls?: unknown;
}

interface DictionaryApiMeaning {
  partOfSpeech?: unknown;
  definitions?: unknown;
}

interface DictionaryApiDefinition {
  definition?: unknown;
  example?: unknown;
  synonyms?: unknown;
  antonyms?: unknown;
}

interface DictionaryApiPhonetic {
  text?: unknown;
  audio?: unknown;
}

export function createSavedDictionary(
  entries: Record<string, SavedDictionaryEntry> = {}
): SavedDictionary {
  return { entries: { ...entries } };
}

export function createWordInsight(
  surface: string,
  savedDictionary: SavedDictionary = createSavedDictionary(),
  lookup: DictionaryLookupResult | null = null
): WordInsight {
  const key = normalizeInsightKey(surface);
  const savedEntry = savedDictionary.entries[key];
  if (savedEntry != null) {
    return {
      key,
      surface,
      status: "ready",
      entry: savedEntry,
      saved: true,
      message: null
    };
  }

  return {
    key,
    surface,
    status: lookup?.status ?? "idle",
    entry: lookup?.entry ?? null,
    saved: false,
    message: lookup?.message ?? null
  };
}

export function loadingDictionaryLookup(): DictionaryLookupResult {
  return {
    status: "loading",
    entry: null,
    message: "Looking up definition..."
  };
}

export function dictionaryLookupReady(entry: DictionaryEntry): DictionaryLookupResult {
  return {
    status: "ready",
    entry,
    message: null
  };
}

export function dictionaryLookupNotFound(surface: string): DictionaryLookupResult {
  return {
    status: "not-found",
    entry: null,
    message: `No dictionary definition found for "${surface}".`
  };
}

export function dictionaryLookupFailed(): DictionaryLookupResult {
  return {
    status: "error",
    entry: null,
    message: "Dictionary lookup needs attention. Please try again."
  };
}

export function saveDictionaryEntry(
  savedDictionary: SavedDictionary,
  entry: DictionaryEntry,
  savedAt = new Date().toISOString()
): SavedDictionary {
  return {
    entries: {
      ...savedDictionary.entries,
      [entry.key]: {
        ...entry,
        savedAt
      }
    }
  };
}

export function forgetDictionaryEntry(
  savedDictionary: SavedDictionary,
  surface: string
): SavedDictionary {
  const key = normalizeInsightKey(surface);
  if (savedDictionary.entries[key] == null) return savedDictionary;

  const { [key]: _forgotten, ...entries } = savedDictionary.entries;
  return { entries };
}

export function listSavedDictionaryEntries(
  savedDictionary: SavedDictionary
): SavedDictionaryEntry[] {
  return Object.values(savedDictionary.entries).sort((first, second) => {
    const saved = second.savedAt.localeCompare(first.savedAt);
    return saved === 0 ? first.surface.localeCompare(second.surface) : saved;
  });
}

export function parseDictionaryApiResponse(
  surface: string,
  payload: unknown,
  fetchedAt = new Date().toISOString()
): DictionaryEntry | null {
  if (!Array.isArray(payload)) return null;

  const entries = payload
    .map((item) => parseApiEntry(surface, item, fetchedAt))
    .filter((entry): entry is DictionaryEntry => entry != null);
  const firstWithDefinitions = entries.find((entry) => entry.meanings.length > 0);

  return firstWithDefinitions ?? null;
}

export function serializeSavedDictionary(savedDictionary: SavedDictionary): string {
  return JSON.stringify({ entries: savedDictionary.entries });
}

export function parseSavedDictionary(value: string | null): SavedDictionary {
  if (value == null || value.trim().length === 0) return createSavedDictionary();

  try {
    const parsed = JSON.parse(value) as Partial<SavedDictionary>;
    if (parsed == null || typeof parsed !== "object" || parsed.entries == null) {
      return createSavedDictionary();
    }

    return createSavedDictionary(normalizeSavedEntries(parsed.entries));
  } catch {
    return createSavedDictionary();
  }
}

export function primaryDefinition(entry: DictionaryEntry | null): DictionaryDefinition | null {
  return entry?.meanings[0]?.definitions[0] ?? null;
}

export function normalizeInsightKey(surface: string): string {
  return surface
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

function parseApiEntry(surface: string, item: unknown, fetchedAt: string): DictionaryEntry | null {
  if (item == null || typeof item !== "object") return null;

  const apiEntry = item as DictionaryApiEntry;
  const word = readString(apiEntry.word) ?? surface;
  const key = normalizeInsightKey(surface);
  if (key.length === 0) return null;

  const phonetics = readArray(apiEntry.phonetics)
    .map((phonetic) => parsePhonetic(phonetic))
    .filter((phonetic): phonetic is DictionaryApiPhonetic => phonetic != null);
  const phoneticText =
    readString(apiEntry.phonetic) ??
    phonetics.map((phonetic) => readString(phonetic.text)).find(Boolean) ??
    null;
  const audioUrl = phonetics
    .map((phonetic) => normalizeAudioUrl(readString(phonetic.audio)))
    .find((audio): audio is string => audio != null);

  return {
    key,
    surface,
    word,
    phonetic: phoneticText,
    audioUrl: audioUrl ?? null,
    meanings: readArray(apiEntry.meanings)
      .map((meaning) => parseMeaning(meaning))
      .filter((meaning): meaning is DictionaryMeaning => meaning != null),
    sourceUrl: readArray(apiEntry.sourceUrls).map(readString).find(Boolean) ?? "",
    fetchedAt
  };
}

function parseMeaning(item: unknown): DictionaryMeaning | null {
  if (item == null || typeof item !== "object") return null;

  const meaning = item as DictionaryApiMeaning;
  const partOfSpeech = readString(meaning.partOfSpeech);
  const definitions = readArray(meaning.definitions)
    .map((definition) => parseDefinition(definition))
    .filter((definition): definition is DictionaryDefinition => definition != null);

  if (partOfSpeech == null || definitions.length === 0) return null;

  return {
    partOfSpeech,
    definitions
  };
}

function parseDefinition(item: unknown): DictionaryDefinition | null {
  if (item == null || typeof item !== "object") return null;

  const definition = item as DictionaryApiDefinition;
  const text = readString(definition.definition);
  if (text == null) return null;

  return {
    definition: text,
    example: readString(definition.example),
    synonyms: readStringArray(definition.synonyms),
    antonyms: readStringArray(definition.antonyms)
  };
}

function parsePhonetic(item: unknown): DictionaryApiPhonetic | null {
  if (item == null || typeof item !== "object") return null;
  return item as DictionaryApiPhonetic;
}

function normalizeSavedEntries(entries: unknown): Record<string, SavedDictionaryEntry> {
  if (entries == null || typeof entries !== "object") return {};

  return Object.entries(entries as Record<string, Partial<SavedDictionaryEntry>>).reduce(
    (normalized, [rawKey, entry]) => {
      const surface = readString(entry.surface) ?? rawKey;
      const key = normalizeInsightKey(surface);
      if (key.length === 0 || !Array.isArray(entry.meanings)) return normalized;

      normalized[key] = {
        key,
        surface,
        word: readString(entry.word) ?? surface,
        phonetic: readString(entry.phonetic),
        audioUrl: readString(entry.audioUrl),
        meanings: entry.meanings,
        sourceUrl: readString(entry.sourceUrl) ?? "",
        fetchedAt: readString(entry.fetchedAt) ?? new Date(0).toISOString(),
        savedAt:
          readString(entry.savedAt) ?? readString(entry.fetchedAt) ?? new Date(0).toISOString()
      };

      return normalized;
    },
    {} as Record<string, SavedDictionaryEntry>
  );
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readStringArray(value: unknown): string[] {
  return readArray(value).filter((item): item is string => typeof item === "string");
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const clean = value.trim();
  return clean.length > 0 ? clean : null;
}

function normalizeAudioUrl(value: string | null): string | null {
  if (value == null) return null;
  if (value.startsWith("//")) return `https:${value}`;
  return value;
}
