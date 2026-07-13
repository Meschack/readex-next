import { normalizeLanguageCode } from "@sonelle/domain";
import narrationVoiceConfig from "./narration-voices.json";
import type {
  NarrationGateway,
  PrefetchingNarrationGateway,
  SentenceNarration,
  SentenceNarrationRequest
} from "./legacy-narration";

export * from "./legacy-narration";
export * from "./narration-contracts";
export * from "./narration-catalog";
export * from "./narration-manifest";
export * from "./narration-fakes";
export * from "./narration-identity";
export * from "./narration-outline";
export * from "./narration-player";
export * from "./narration-preparation";
export * from "./narration-routing";
export * from "./narration-session";
export * from "./piper-compatibility";

export interface NarrationVoice {
  id: string;
  label: string;
  locale: string;
  description: string;
}

export interface AudioSettings {
  playbackRate: number;
  volume: number;
  autoAdvance: boolean;
  voiceId: string;
  voicePreferences: Readonly<Record<string, string>>;
}

interface SerializedAudioSettingsV2 extends AudioSettings {
  schemaVersion: 2;
}

export class FakeNarrationGateway implements NarrationGateway {
  private readonly prepared = new Map<string, SentenceNarration>();

  async prepareSentenceAudio(request: SentenceNarrationRequest): Promise<SentenceNarration> {
    const key = narrationRequestKey(request);
    const existing = this.prepared.get(key);
    if (existing != null) return { ...existing, cached: true };

    const narration: SentenceNarration = {
      bookId: request.bookId,
      chapterId: request.chapterId,
      sentenceId: request.sentenceId,
      readiness: "ready",
      durationSec: estimateSentenceDurationSec(request.text),
      sourceUrl: createSilentWavDataUrl(estimateSentenceDurationSec(request.text)),
      playbackMode: "html-audio",
      cached: false,
      message: null
    };

    this.prepared.set(key, narration);
    return narration;
  }

  async playPreparedSentenceAudio(): Promise<void> {
    return undefined;
  }

  async stopPreparedSentenceAudio(): Promise<void> {
    return undefined;
  }
}

interface PrefetchingNarrationOptions {
  maxEntries?: number;
}

export function createPrefetchingNarrationGateway(
  gateway: NarrationGateway,
  options: PrefetchingNarrationOptions = {}
): PrefetchingNarrationGateway {
  const maxEntries = Math.max(1, options.maxEntries ?? 4);
  const prepared = new Map<string, Promise<SentenceNarration>>();

  const prepare = (request: SentenceNarrationRequest) => {
    const key = narrationRequestKey(request);
    const existing = prepared.get(key);
    if (existing != null) return existing;

    const pending = gateway.prepareSentenceAudio(request).catch((error) => {
      prepared.delete(key);
      throw error;
    });

    prepared.set(key, pending);
    trimPreparedNarrations(prepared, maxEntries);
    return pending;
  };

  return {
    prepareSentenceAudio(request) {
      return prepare(request);
    },

    async prefetchSentenceAudio(request) {
      await prepare(request);
    },

    playPreparedSentenceAudio(request, narration) {
      return gateway.playPreparedSentenceAudio(request, narration);
    },

    stopPreparedSentenceAudio() {
      return gateway.stopPreparedSentenceAudio();
    },

    clearPrefetchedNarrations() {
      prepared.clear();
    }
  };
}

export const DEFAULT_NARRATION_VOICE_ID = narrationVoiceConfig.defaultVoiceId;

export const SUPPORTED_NARRATION_VOICES =
  narrationVoiceConfig.voices satisfies readonly NarrationVoice[];

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  playbackRate: 0.9,
  volume: 1.2,
  voiceId: DEFAULT_NARRATION_VOICE_ID,
  voicePreferences: { en: DEFAULT_NARRATION_VOICE_ID },
  autoAdvance: true
};

export function createAudioSettings(input: Partial<AudioSettings> = {}): AudioSettings {
  const voiceId = normalizeNarrationVoiceId(input.voiceId);
  return {
    playbackRate: clampPlaybackRate(input.playbackRate ?? DEFAULT_AUDIO_SETTINGS.playbackRate),
    volume: clampVolume(input.volume ?? DEFAULT_AUDIO_SETTINGS.volume),
    voiceId,
    voicePreferences: normalizeVoicePreferences(input.voicePreferences, voiceId),
    autoAdvance:
      typeof input.autoAdvance === "boolean"
        ? input.autoAdvance
        : DEFAULT_AUDIO_SETTINGS.autoAdvance
  };
}

export function serializeAudioSettings(settings: AudioSettings): string {
  const normalized = createAudioSettings(settings);
  const serialized: SerializedAudioSettingsV2 = { schemaVersion: 2, ...normalized };
  return JSON.stringify(serialized);
}

export function parseAudioSettings(value: string | null): AudioSettings {
  if (value == null) return DEFAULT_AUDIO_SETTINGS;

  try {
    const parsed = JSON.parse(value) as Partial<SerializedAudioSettingsV2> | null;
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return DEFAULT_AUDIO_SETTINGS;
    }
    if (parsed.schemaVersion != null && parsed.schemaVersion !== 2) {
      return DEFAULT_AUDIO_SETTINGS;
    }
    return createAudioSettings(parsed);
  } catch {
    return DEFAULT_AUDIO_SETTINGS;
  }
}

export function selectNarrationVoicePreference(
  settings: AudioSettings,
  language: string | null | undefined,
  voiceId: string
): AudioSettings {
  const normalizedVoiceId = normalizeNarrationVoiceId(voiceId);
  const languageCode = normalizeLanguageCode(language) ?? "*";
  return createAudioSettings({
    ...settings,
    voiceId: normalizedVoiceId,
    voicePreferences: {
      ...settings.voicePreferences,
      [languageCode]: normalizedVoiceId
    }
  });
}

export function activateAudioSettingsForLanguage(
  settings: AudioSettings,
  language: string | null | undefined
): AudioSettings {
  const languageCode = normalizeLanguageCode(language);
  const preferredVoiceId =
    (languageCode == null
      ? settings.voicePreferences["*"]
      : settings.voicePreferences[languageCode]) ?? settings.voicePreferences["*"];
  const voiceId = resolveNarrationVoiceForLanguage(language, preferredVoiceId ?? settings.voiceId);
  return createAudioSettings({ ...settings, voiceId });
}

export function estimateSentenceDurationSec(text: string): number {
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1.1, Math.min(12, wordCount * 0.34 + 0.5));
}

export function isSupportedNarrationVoiceId(voiceId: string): boolean {
  return SUPPORTED_NARRATION_VOICES.some((voice) => voice.id === voiceId);
}

export function narrationVoiceLabel(voiceId: string): string {
  return (
    SUPPORTED_NARRATION_VOICES.find((voice) => voice.id === voiceId)?.label ??
    SUPPORTED_NARRATION_VOICES[0].label
  );
}

export function resolveNarrationVoiceForLanguage(
  language: string | null | undefined,
  currentVoiceId: string
): string {
  const languageCode = normalizeLanguageCode(language);
  const currentVoice = SUPPORTED_NARRATION_VOICES.find((voice) => voice.id === currentVoiceId);
  if (languageCode == null || currentVoice == null) return currentVoiceId;

  const currentVoiceLanguage = normalizeLanguageCode(currentVoice.locale);
  if (currentVoiceLanguage === languageCode) return currentVoiceId;

  const exactLocaleVoice = SUPPORTED_NARRATION_VOICES.find(
    (voice) => normalizeLocale(voice.locale) === normalizeLocale(language)
  );
  if (exactLocaleVoice != null) return exactLocaleVoice.id;

  return (
    SUPPORTED_NARRATION_VOICES.find((voice) => normalizeLanguageCode(voice.locale) === languageCode)
      ?.id ?? DEFAULT_NARRATION_VOICE_ID
  );
}

function clampPlaybackRate(rate: number): number {
  if (!Number.isFinite(rate)) return DEFAULT_AUDIO_SETTINGS.playbackRate;
  return Math.min(1.5, Math.max(0.75, rate));
}

function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) return DEFAULT_AUDIO_SETTINGS.volume;
  return Math.min(1.5, Math.max(0, volume));
}

function normalizeNarrationVoiceId(voiceId: string | undefined): string {
  if (voiceId != null && isSupportedNarrationVoiceId(voiceId)) return voiceId;
  return DEFAULT_AUDIO_SETTINGS.voiceId;
}

function normalizeVoicePreferences(
  preferences: Readonly<Record<string, string>> | undefined,
  activeVoiceId: string
): Readonly<Record<string, string>> {
  const normalized: Record<string, string> = {};
  for (const [language, voiceId] of Object.entries(preferences ?? {})) {
    if (!isSupportedNarrationVoiceId(voiceId)) continue;
    const languageCode = language === "*" ? "*" : normalizeLanguageCode(language);
    if (languageCode == null) continue;
    const voice = SUPPORTED_NARRATION_VOICES.find((candidate) => candidate.id === voiceId);
    if (
      languageCode !== "*" &&
      normalizeLanguageCode(voice?.locale) !== normalizeLanguageCode(languageCode)
    ) {
      continue;
    }
    normalized[languageCode] = voiceId;
  }

  const activeVoice = SUPPORTED_NARRATION_VOICES.find((voice) => voice.id === activeVoiceId);
  const languageCode = normalizeLanguageCode(activeVoice?.locale) ?? "*";
  if (normalized[languageCode] == null) {
    normalized[languageCode] = activeVoiceId;
  }
  return normalized;
}

function normalizeLocale(language: string | null | undefined): string | null {
  if (language == null) return null;
  const locale = language.trim().toLocaleLowerCase().replace(/_/gu, "-");
  return locale.length > 0 ? locale : null;
}

function narrationRequestKey(request: SentenceNarrationRequest): string {
  return [
    request.bookId,
    request.chapterId,
    request.sentenceId,
    request.sentenceIndex,
    request.voiceId,
    request.text
  ].join("\u001f");
}

function trimPreparedNarrations(
  prepared: Map<string, Promise<SentenceNarration>>,
  maxEntries: number
) {
  while (prepared.size > maxEntries) {
    const oldestKey = prepared.keys().next().value as string | undefined;
    if (oldestKey == null) return;
    prepared.delete(oldestKey);
  }
}

function createSilentWavDataUrl(durationSec: number): string {
  const sampleRate = 8000;
  const sampleCount = Math.max(1, Math.round(durationSec * sampleRate));
  const headerSize = 44;
  const bytes = new Uint8Array(headerSize + sampleCount);
  const view = new DataView(bytes.buffer);

  writeAscii(bytes, 0, "RIFF");
  view.setUint32(4, 36 + sampleCount, true);
  writeAscii(bytes, 8, "WAVE");
  writeAscii(bytes, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  writeAscii(bytes, 36, "data");
  view.setUint32(40, sampleCount, true);
  bytes.fill(128, headerSize);

  return `data:audio/wav;base64,${encodeBase64(bytes)}`;
}

function writeAscii(bytes: Uint8Array, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    bytes[offset + index] = value.charCodeAt(index);
  }
}

function encodeBase64(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let output = "";

  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    const hasSecond = index + 1 < bytes.length;
    const hasThird = index + 2 < bytes.length;
    const triplet = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);

    output += alphabet[(triplet >> 18) & 63];
    output += alphabet[(triplet >> 12) & 63];
    output += hasSecond ? alphabet[(triplet >> 6) & 63] : "=";
    output += hasThird ? alphabet[triplet & 63] : "=";
  }

  return output;
}
