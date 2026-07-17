# 0015: In-App Offline Voice Installation

## Status

Accepted.

## Decision

Sonelle installs the selected offline narration voice from inside the desktop app. The native
narration module owns platform selection, downloads, integrity checks, archive extraction, and
app-data paths. The reader sees only whether the selected voice is ready, being prepared, or needs
attention.

Voice installation is event-driven. The reader emits `VoiceInstallationRequested`, and completion
is represented by `VoiceInstallationReady` or `VoiceInstallationFailed`. Native progress events
project the active download into an indeterminate or percentage-based reader view without putting
network or filesystem details into Solid components.

The desktop runtime is pinned per supported operating system and architecture. Voice model and
configuration hashes live beside the shared voice catalog. Downloads use temporary files and are
renamed only after their expected SHA-256 digest is verified.

Windows releases bundle the small Microsoft C++ runtime files needed by the downloaded Piper
executable and Sonelle's native narration library. The files sit beside `sonelle.exe` so Windows can
load the application on a clean system, then Sonelle copies the same files beside Piper when it
prepares offline voice support. Sonelle does not ask users to install system software or run an
elevated installer.

## Why

Bundling a default voice would make every installer substantially larger, including for readers who
want another language or never use narration. Requiring Python, command-line setup, environment
variables, or an administrator-installed runtime is not acceptable for a reader-facing release.

Installing only the selected voice keeps the release small while preserving fully offline playback
after preparation completes.

## Consequences

- The first voice preparation requires an internet connection and roughly 80-90 MB of data.
- Additional voices reuse the installed desktop runtime and need only their model files.
- Playback never silently substitutes a robotic system voice.
- Sonelle release updates are responsible for delivering current Microsoft C++ runtime files.
- Removing installed voices and cancelling active downloads remain future work.
- Mobile narration continues to use its platform adapter and does not use this desktop runtime.
