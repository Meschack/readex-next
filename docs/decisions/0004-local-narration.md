# 0004: Local Sentence Narration

## Status

Accepted.

## Decision

Sonelle plays narration one sentence at a time and prefetches upcoming sentence audio while the current sentence is playing.

The renderer talks to a small `NarrationGateway` from `packages/audio`. The gateway exposes three actions:

- prepare sentence audio
- play prepared sentence audio
- stop prepared sentence audio

The desktop app provides the real gateway through Tauri commands. Browser and test workflows use a deterministic fake gateway.

Native audio preparation caches sentence narration locally. The native layer prefers Piper, stores
`sentence.wav`, and returns a scoped asset URL. The renderer converts that local asset into a
disposable media URL before playback. Robotic system speech is not acceptable as normal narration;
if no neural local voice is configured, Sonelle reports that narration needs attention.

The renderer wraps the active gateway with a small bounded prefetch cache. When playback starts for a sentence, the next sentence begins preparing in the background so the handoff feels closer to continuous reading instead of isolated sentence clips.

## Why

Sentence narration needs native capabilities, but reader UI should not know about subprocesses, cache paths, or installed speech tools.

This boundary keeps responsibilities clean:

- `packages/audio` owns the narration contract and fake adapter.
- Tauri commands own local process and cache access.
- Reader UI owns playback intent, sentence highlighting, and friendly status text.
- Reader UI owns prefetch timing, because it knows the current reading order.

The fake adapter is intentionally deterministic so tests and fixture workflows do not depend on machine voices, codecs, or timing metadata.

## Alternatives Considered

Word-level audio:

- Requires word timestamp metadata or engine-specific alignment.
- Adds timing churn to the reading surface.
- Conflicts with the sentence-level highlighting decision.

Renderer-owned TTS:

- Easier for a prototype.
- Would leak platform details into UI code.
- Makes offline desktop behavior harder to test cleanly.

Remote TTS first:

- Useful later for better voices.
- Wrong first dependency for an offline-first local reader.

## Consequences

The first native adapter is intentionally local and quality-gated:

- It prefers cached Piper WAV files.
- It generates new sentence WAV files with Piper when a local voice is configured.
- It reports `needs attention` when no neural local voice exists.
- It does not play Speech Dispatcher or eSpeak fallback voices as normal narration.

The renderer advances highlighting when the active sentence finishes playing. It does not expose cache generation, subprocess work, chunks, queues, or other internals to the user.

Future adapters can add richer voices, remote synthesis, or better timing without changing reader UI.

## User-Facing Language

Use:

- ready to listen
- preparing audio
- needs attention

Avoid:

- chunk
- worker
- job
- queue
- synthesis pipeline
