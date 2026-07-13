# Narration

## Owns

- voice catalog metadata and language-aware voice resolution
- narration request identity, prefetching, and playback readiness contracts
- the desktop adapter for native Piper preparation and playback
- selected-voice installation status, progress, verification, and retry

## Refuses To Own

- reader UI state, chapter navigation, or reading progress
- book-language detection and EPUB metadata extraction
- persisted reader preferences

## Interface

Reader workflows depend on `PrefetchingNarrationGateway`. Voice labels, locales, descriptions, and
the default voice come from `packages/audio/src/narration-voices.json`. Browser media lifecycle is
hidden behind the injected `HtmlAudioPlayer` interface. Native voice progress projects cumulative
downloaded bytes, total bytes, and percentage into the reader without exposing network details.
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

`AudioPreparationRequested`, `SentenceAudioReady`, and `AudioPreparationFailed` describe the
reader-visible narration lifecycle. `VoiceInstallationRequested`, `VoiceInstallationReady`, and
`VoiceInstallationFailed` describe the separately managed offline voice lifecycle.

## Tests

Package tests cover voice selection, settings, request identity, and prefetch behavior. Rust tests
cover native request validation, cache behavior, the shared default voice catalog, platform
selection, safe extraction, and verified voice files without making network requests.
Desktop playback tests verify complete-buffer completion, persistent output routing, volume and
speed changes, explicit stopping, playback failures, and prepared-source cleanup.
Workflow tests verify that each installation request produces one persisted ready or failed
lifecycle. Native fake-download tests cover successful streaming and partial-file cleanup after an
interrupted transfer.
Native checks on each release target compile the platform-specific background process adapter.
