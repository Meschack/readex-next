# Narration

## Owns

- voice catalog metadata and language-aware voice resolution
- engine-independent chapter outlines, paragraph passage construction, and engine routing
- prepared narration, sentence-span validation, request identity, stale preparation cancellation, and
  manifest-aware narration-session orchestration
- generic native narration-pack installation and V3 prepared audio/manifest cache primitives
- Kokoro English sentence alignment, paragraph-preparation fallback policy, and hybrid routing guard
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
- Kokoro model redistribution, G2P packaging, and listening-QA voice selection until release gates
  finish

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

The native `narration_engine_pack` module turns the pinned Kokoro and Supertonic spike catalog into
desktop installable engine packs. It exposes readiness and installation commands for the hybrid
engines, stores verified model artifacts under the app data directory, and emits progress facts
without asking reader UI code to know model repositories, revisions, or file hashes.

The native `narration_cache` module owns V3 prepared narration assets. A cache entry stores
`audio.wav` beside `manifest.json`, writes through a temporary directory, validates complete
sentence sample timelines before saving or reading, tracks asset count, covered sentence count, and
audio bytes, and keeps model revisions separated through asset identity.

The native `narration_manifest` command is the desktop boundary for future Kokoro and Supertonic
preparation. It accepts engine-independent passage requests, builds deterministic asset identity
from engine, voice, model revision, source text, and synthesis parameters, and stores prepared
audio in the V3 cache. Until real model adapters land, it writes validated silent manifests so the
IPC and cache contract can be exercised without shipping unfinished inference.

`KokoroNarrationAdapter` owns the engine-independent English passage contract. It accepts only
confidently English requests, asks an injected engine for paragraph synthesis, maps timed Kokoro
tokens back to Sonelle sentence IDs with monotonic punctuation-tolerant alignment, validates the
manifest, and falls back to independent sentence synthesis when paragraph alignment cannot be
trusted. The fallback trades paragraph prosody for honest highlighting; it does not approximate
sentence boundaries. `routeNarrationEngine` supports an explicit `legacy-piper` routing mode so the
working Piper path remains selectable while the hybrid path is still behind development wiring.

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

The reader projects manifest playback events through `projectNarrationEventToPlayback`, keeping
highlight and transport state driven by domain facts rather than by engine/cache details in Solid
components.

Desktop manifest playback starts prepared passage audio at the requested sentence sample offset and
stops at the requested sentence or passage boundary, so paragraph-level assets can still drive
sentence-level reader state.

The desktop app can route playback through the manifest-aware `NarrationSession` by setting
`VITE_SONELLE_NARRATION_SESSION=legacy-piper` during development. That mode keeps Piper as the
preparation adapter while exercising the new session, manifest playback, and event projection path.
Setting `VITE_SONELLE_NARRATION_SESSION=hybrid-v1` uses the desktop native manifest command for
Kokoro and Supertonic routes, allowing the new cache and IPC boundary to be tested before real
model inference is wired in.

## Tests

Package tests cover passage splitting, manifest validation, routing, catalog integrity, settings
migration, cache identity, stale cancellation, deterministic adapters, narration-session playback
transitions, Piper compatibility, voice selection, and prefetch behavior. Reader tests verify that
the UI projection becomes an
engine-independent outline without carrying Solid state into the audio module. Rust tests
cover native request validation, cache behavior, the shared default voice catalog, platform
selection, safe extraction, and verified voice files without making network requests.
Kokoro tests cover punctuation-heavy English alignment, missing-token rejection, paragraph manifest
preparation, repeated cache hits, per-sentence fallback after invalid alignment, and non-English
request rejection.
Reader playback tests cover projection of manifest narration events into active sentence and
transport state.
Desktop playback tests cover manifest sample-range playback and scheduled sentence-entry callbacks.
Native pack tests cover reuse, corruption retry, interrupted-download cleanup, progress projection,
and unsafe path rejection. Native V3 cache tests cover atomic writes, invalid manifests, empty
audio, model-revision separation, tampered metadata, statistics, and clearing.
Native engine-pack tests cover catalog projection, unavailable engine rejection, and readiness
status from installed pack records.
Desktop playback tests verify complete-buffer completion, persistent output routing, volume and
speed changes, explicit stopping, playback failures, prepared-source cleanup, and HTML compatibility
manifest playback.
Workflow tests verify that each installation request produces one persisted ready or failed
lifecycle. Native fake-download tests cover successful streaming and partial-file cleanup after an
interrupted transfer.
Native checks on each release target compile the platform-specific background process adapter.
