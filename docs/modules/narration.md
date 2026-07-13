# Narration

## Owns

- voice catalog metadata and language-aware voice resolution
- engine-independent chapter outlines, paragraph passage construction, and engine routing
- prepared narration, sentence-span validation, request identity, stale preparation cancellation, and
  manifest-aware narration-session orchestration
- generic native narration-pack installation and V3 prepared audio/manifest cache primitives
- versioned audio settings and per-language voice preference migration
- deterministic passage and sentence-batch adapters for contract tests
- the desktop adapter for native Piper preparation and playback
- selected-voice installation status, progress, verification, and retry

## Refuses To Own

- reader UI state, chapter navigation, or reading progress
- book-language detection and EPUB metadata extraction
- persisted reader preferences
- native decoded playback implementation details beyond the manifest-aware player interface
- model inference and engine-specific cache key construction, which remain native adapter concerns

## Interface

The current reader workflow still depends on `PrefetchingNarrationGateway` while production native
Kokoro and Supertonic adapters are pending. New engine adapters implement
`NarrationPreparationAdapter` and return `PreparedNarration` with a complete ordered sample
timeline. `createNarrationPassages` preserves paragraph boundaries and only splits oversized
passages between existing Sonelle sentences. `validatePreparedNarration` rejects missing,
reordered, overlapping, gapped, or out-of-range sentence spans before they can drive the reader.

`createNarrationSession` owns chapter opening, anchor-sentence playback, clicked-sentence moves,
pause, close, bounded one-passage-ahead prefetch, stale foreground cancellation, and projection of
manifest facts into narration lifecycle domain events. The session receives output settings, but
only passes playback rate and volume to the player; auto-advance remains session policy. The
manifest-aware player receives prepared assets and emits sentence-entry observations without
knowing about reader state, settings persistence, or voice installation.

The native `narration_pack` module owns generic installed-pack preparation for future Kokoro and
Supertonic artifacts. It verifies every artifact by SHA-256, installs into a temporary directory,
writes a pack record only after all files are present, reuses ready packs, retries corrupt packs, and
cleans partial downloads after interruption. Piper's current installer remains available for
compatibility until the production catalog is switched to installed packs.

The native `narration_cache` module owns V3 prepared narration assets. A cache entry stores
`audio.wav` beside `manifest.json`, writes through a temporary directory, validates complete
sentence sample timelines before saving or reading, tracks asset count, covered sentence count, and
audio bytes, and keeps model revisions separated through asset identity.

`routeNarrationEngine` selects contextual Kokoro passages for English and bounded Supertonic
sentence batches for supported non-English languages, using Supertonic's `na` mode when language is
missing or unsupported. The catalog schema keeps selectable voices separate from engine-native
voice IDs, model revisions, and installed file packs. Candidate production voices remain absent
until listening and license review finish.

Audio settings serialize as schema V2 with per-language preferences and a compatibility `voiceId`.
Legacy V1 settings derive a preference from the persisted Piper voice. The desktop repository reads
both storage keys and writes only V2; the old entry remains available for rollback.

`PiperCompatibilityAdapter` projects one prepared Piper sentence into a one-span manifest. Its
1,000-sample-per-second timeline is compatibility metadata, not word timing; the only boundary is
the media element's existing sentence end. The desktop `HtmlManifestNarrationPlayer` consumes those
one-span compatibility manifests through the existing HTML audio player. It intentionally rejects
unsupported mid-passage stop requests until the decoded passage player can seek and stop at sample
boundaries.

Voice labels, locales, descriptions, and the default compatibility voice come from
`packages/audio/src/narration-voices.json`. Browser media lifecycle is hidden behind the injected
`HtmlAudioPlayer` interface. Native voice progress projects cumulative downloaded bytes, total
bytes, and percentage into the reader without exposing network details.
Playback volume is persisted with the reader's audio settings. `HtmlAudioPlayer` owns ordinary
media fallback and the primary decoded-buffer playback path. Prepared sentence bytes are decoded
into Web Audio buffers and connected to one persistent gain bus, allowing a modest narration boost
without putting audio graph details into Solid components or rebuilding the output path between
sentences.
`ReaderVoiceInstallationWorkflow` owns the requested, ready, and failed event lifecycle; the Solid
reader supplies only selected-voice access and UI projection callbacks. The native installer uses a
streaming download-client interface so transport failures can be tested without network access,
while verified temporary-file replacement remains hidden inside the installer.
Transient narration notices are presented only as dismissible notifications. The playback bar
keeps book context on the left, transport and reading progress in the center, and volume plus the
active-sentence bookmark action on the right. It does not contain a competing status-message slot.
Native Piper and Python commands are created through the background-process platform adapter so
voice preparation never opens a console window over the reader on Windows.

## Domain Events

`AudioPreparationRequested`, `SentenceAudioReady`, and `AudioPreparationFailed` remain during Piper
compatibility. `PassageNarrationReady`, `NarrationSentenceEntered`, `NarrationPlaybackPaused`,
`NarrationPlaybackEnded`, and `NarrationPlaybackFailed` describe the manifest-aware lifecycle
without publishing high-frequency media-clock updates. `VoiceInstallationRequested`,
`VoiceInstallationReady`, and `VoiceInstallationFailed` describe the separately managed offline
voice lifecycle.

## Tests

Package tests cover passage splitting, manifest validation, routing, catalog integrity, settings
migration, cache identity, stale cancellation, deterministic adapters, narration-session playback
transitions, Piper compatibility, voice selection, and prefetch behavior. Reader tests verify that
the UI projection becomes an
engine-independent outline without carrying Solid state into the audio module. Rust tests
cover native request validation, cache behavior, the shared default voice catalog, platform
selection, safe extraction, and verified voice files without making network requests.
Native pack tests cover reuse, corruption retry, interrupted-download cleanup, progress projection,
and unsafe path rejection. Native V3 cache tests cover atomic writes, invalid manifests, empty
audio, model-revision separation, tampered metadata, statistics, and clearing.
Desktop playback tests verify complete-buffer completion, persistent output routing, volume and
speed changes, explicit stopping, playback failures, prepared-source cleanup, and HTML compatibility
manifest playback.
Workflow tests verify that each installation request produces one persisted ready or failed
lifecycle. Native fake-download tests cover successful streaming and partial-file cleanup after an
interrupted transfer.
Native checks on each release target compile the platform-specific background process adapter.
