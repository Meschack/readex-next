import { normalizeLanguageCode } from "@sonelle/domain";

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

interface FreeDictionaryApiResponse {
  word?: unknown;
  entries?: unknown;
  source?: unknown;
}

interface FreeDictionaryApiEntry {
  language?: unknown;
  partOfSpeech?: unknown;
  pronunciations?: unknown;
  senses?: unknown;
  synonyms?: unknown;
  antonyms?: unknown;
}

interface FreeDictionaryApiSense {
  definition?: unknown;
  examples?: unknown;
  synonyms?: unknown;
  antonyms?: unknown;
}

interface FrenchWiktionaryApiResponse {
  parse?: unknown;
}

interface FrenchWiktionaryParseResult {
  title?: unknown;
  text?: unknown;
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

export function parseFreeDictionaryApiResponse(
  surface: string,
  payload: unknown,
  preferredLanguage?: string,
  fetchedAt = new Date().toISOString()
): DictionaryEntry | null {
  if (payload == null || typeof payload !== "object") return null;

  const response = payload as FreeDictionaryApiResponse;
  const sourceUrl =
    response.source != null && typeof response.source === "object"
      ? (readString((response.source as { url?: unknown }).url) ?? "")
      : "";
  const language = normalizeLanguageCode(preferredLanguage);
  const entries = readArray(response.entries)
    .map((item) => parseFreeApiEntry(surface, response.word, sourceUrl, item, fetchedAt))
    .filter((entry): entry is ParsedFreeDictionaryEntry => entry != null);
  const languageEntries = language
    ? entries.filter((entry) => entry.languageCode === language)
    : entries;
  const firstWithDefinitions = (languageEntries.length > 0 ? languageEntries : entries).find(
    (entry) => entry.entry.meanings.length > 0
  );

  return firstWithDefinitions?.entry ?? null;
}

export function parseFrenchWiktionaryApiResponse(
  surface: string,
  payload: unknown,
  fetchedAt = new Date().toISOString()
): DictionaryEntry | null {
  if (payload == null || typeof payload !== "object" || typeof DOMParser === "undefined") {
    return null;
  }

  const response = payload as FrenchWiktionaryApiResponse;
  if (response.parse == null || typeof response.parse !== "object") return null;

  const parsed = response.parse as FrenchWiktionaryParseResult;
  const html = readString(parsed.text);
  const key = normalizeInsightKey(surface);
  if (html == null || key.length === 0) return null;

  const document = new DOMParser().parseFromString(html, "text/html");
  const languageHeading = document.querySelector(".sectionlangue#fr")?.closest(".mw-heading2");
  if (languageHeading == null) return null;

  const languageNodes = collectLanguageSection(languageHeading);
  const meanings = languageNodes
    .map((node, index) => parseFrenchMeaning(languageNodes, node, index))
    .filter((meaning): meaning is DictionaryMeaning => meaning != null);
  if (meanings.length === 0) return null;

  const title = readString(parsed.title) ?? surface;
  const phonetic = languageNodes
    .map((node) => readString(node.querySelector('[title="Prononciation API"]')?.textContent))
    .find((value): value is string => value != null);

  return {
    key,
    surface,
    word: title,
    phonetic: normalizeFrenchPhonetic(phonetic ?? null),
    audioUrl: null,
    meanings,
    sourceUrl: `https://fr.wiktionary.org/wiki/${encodeURIComponent(title)}`,
    fetchedAt
  };
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

interface ParsedFreeDictionaryEntry {
  entry: DictionaryEntry;
  languageCode: string | null;
}

function parseFreeApiEntry(
  surface: string,
  responseWord: unknown,
  sourceUrl: string,
  item: unknown,
  fetchedAt: string
): ParsedFreeDictionaryEntry | null {
  if (item == null || typeof item !== "object") return null;

  const apiEntry = item as FreeDictionaryApiEntry;
  const key = normalizeInsightKey(surface);
  if (key.length === 0) return null;

  const partOfSpeech = readString(apiEntry.partOfSpeech) ?? "unknown";
  const meanings = readArray(apiEntry.senses)
    .map((sense) => parseFreeMeaning(sense, partOfSpeech))
    .filter((meaning): meaning is DictionaryMeaning => meaning != null);
  const pronunciations = readArray(apiEntry.pronunciations);
  const phonetic = pronunciations
    .map((pronunciation) => {
      if (pronunciation == null || typeof pronunciation !== "object") return null;
      return readString((pronunciation as { text?: unknown }).text);
    })
    .find((text): text is string => text != null);

  return {
    entry: {
      key,
      surface,
      word: readString(responseWord) ?? surface,
      phonetic: phonetic ?? null,
      audioUrl: null,
      meanings,
      sourceUrl,
      fetchedAt
    },
    languageCode: readLanguageCode(apiEntry.language)
  };
}

function parseFreeMeaning(item: unknown, partOfSpeech: string): DictionaryMeaning | null {
  if (item == null || typeof item !== "object") return null;

  const sense = item as FreeDictionaryApiSense;
  const definition = readString(sense.definition);
  if (definition == null) return null;

  return {
    partOfSpeech,
    definitions: [
      {
        definition,
        example: readArray(sense.examples).map(readString).find(Boolean) ?? null,
        synonyms: readStringArray(sense.synonyms),
        antonyms: readStringArray(sense.antonyms)
      }
    ]
  };
}

function collectLanguageSection(languageHeading: Element): Element[] {
  const nodes: Element[] = [];
  let node = languageHeading.nextElementSibling;

  while (node != null && !node.matches(".mw-heading2")) {
    nodes.push(node);
    node = node.nextElementSibling;
  }

  return nodes;
}

function parseFrenchMeaning(
  languageNodes: Element[],
  node: Element,
  nodeIndex: number
): DictionaryMeaning | null {
  const partOfSpeech = readString(node.querySelector(".titredef")?.textContent);
  if (!node.matches(".mw-heading3") || partOfSpeech == null) return null;

  const definitionList = findFrenchDefinitionList(languageNodes, nodeIndex + 1);
  if (definitionList == null) return null;

  const definitions = Array.from(definitionList.children)
    .filter((candidate) => candidate.tagName === "LI")
    .map(parseFrenchDefinition)
    .filter((definition): definition is DictionaryDefinition => definition != null);

  return definitions.length > 0 ? { partOfSpeech, definitions } : null;
}

function findFrenchDefinitionList(languageNodes: Element[], startIndex: number): Element | null {
  for (let index = startIndex; index < languageNodes.length; index += 1) {
    const candidate = languageNodes[index];
    if (candidate.matches(".mw-heading2, .mw-heading3")) return null;

    const list = candidate.matches("ol") ? candidate : candidate.querySelector(":scope > ol");
    if (list != null) return list;
  }

  return null;
}

function parseFrenchDefinition(item: Element): DictionaryDefinition | null {
  const definitionNode = item.cloneNode(true) as Element;
  definitionNode
    .querySelectorAll("ul, ol, dl, sup, .reference, .mw-editsection")
    .forEach((node) => node.remove());
  const definition = normalizeHtmlText(definitionNode.textContent);
  if (definition == null) return null;

  const example = normalizeHtmlText(
    item.querySelector(".example q")?.textContent ?? item.querySelector(".example")?.textContent
  );

  return {
    definition,
    example,
    synonyms: [],
    antonyms: []
  };
}

function normalizeFrenchPhonetic(value: string | null): string | null {
  if (value == null) return null;
  if (value.startsWith("\\") && value.endsWith("\\")) {
    return `/${value.slice(1, -1)}/`;
  }
  return value;
}

function normalizeHtmlText(value: string | null | undefined): string | null {
  return readString(value?.replace(/\s+/gu, " "));
}

function readLanguageCode(value: unknown): string | null {
  if (typeof value === "string") return normalizeLanguageCode(value);
  if (value == null || typeof value !== "object") return null;
  return normalizeLanguageCode(readString((value as { code?: unknown }).code) ?? undefined);
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
