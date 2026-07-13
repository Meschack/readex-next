import { parseAudioSettings, serializeAudioSettings, type AudioSettings } from "@sonelle/audio";

const audioSettingsStorageKey = "sonelle.audio.settings.v2";
const legacyAudioSettingsStorageKey = "sonelle.audio.settings.v1";

export interface AudioSettingsRepository {
  load(): AudioSettings;
  save(settings: AudioSettings): void;
}

export function createAudioSettingsRepository(): AudioSettingsRepository {
  return {
    load() {
      if (typeof localStorage === "undefined") return parseAudioSettings(null);
      return parseAudioSettings(
        localStorage.getItem(audioSettingsStorageKey) ??
          localStorage.getItem(legacyAudioSettingsStorageKey)
      );
    },

    save(settings) {
      if (typeof localStorage === "undefined") return;
      localStorage.setItem(audioSettingsStorageKey, serializeAudioSettings(settings));
    }
  };
}
