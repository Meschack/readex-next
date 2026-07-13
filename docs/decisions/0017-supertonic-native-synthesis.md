# 0017: Supertonic Native Synthesis

## Status

Accepted for the hybrid development path. Kokoro native synthesis remains pending.

## Context

The hybrid narration path needs real local audio before user testing can mean anything. Supertonic is
the lowest-risk first runtime because Sonelle already installs its ONNX files and voice styles as one
verified offline narration pack. Kokoro still needs a production ONNX artifact in the engine catalog;
the current Kokoro pack downloads the upstream PyTorch checkpoint and voices.

## Decision

Sonelle prepares Supertonic requests inside the native manifest command when `engineId` is
`supertonic`.

The `supertonic_narration` module owns:

- loading the installed Supertonic ONNX assets and selected voice style;
- rendering each Sonelle sentence independently;
- converting returned samples into one WAV asset;
- projecting exact sentence spans from returned sample lengths.

It refuses to own:

- routing a book to an engine;
- installing or verifying engine files;
- cache identity and cache writes;
- playback and sentence highlighting;
- Kokoro preprocessing or alignment.

The manifest command remains the interface used by the desktop frontend. It receives a
`ManifestNarrationRequest` and returns the same `PreparedManifestNarration` shape whether audio came
from Supertonic synthesis, cache, or the temporary Kokoro placeholder.

## Events

No new user-facing event is introduced by this slice. The existing preparation command is still
triggered from `AudioPreparationRequested`, and playback still projects sentence entry from the
prepared manifest.

## Testing

Automated tests cover:

- rendering sentence spans from synthesized sample counts;
- rejecting mismatched synthesized sentence output;
- storing rendered Supertonic audio through the manifest cache path;
- preserving existing placeholder behavior for Kokoro until its ONNX pack is added.

An ignored test can run real Supertonic ONNX synthesis against local spike assets with
`SONELLE_SUPERTONIC_FIXTURE_ROOT`.

## Consequences

French and other non-English hybrid requests can now produce real local audio after the Supertonic
offline files are installed. English hybrid requests still route to Kokoro and therefore still need
the next slice: adding the production Kokoro ONNX artifact and native Kokoro synthesis/alignment.

The current pinned ONNX Runtime static build requires the Linux bundle job to run on Ubuntu 24.04.
Ubuntu 22.04 verification remains useful for non-linking checks, but release packaging must use the
newer runner until Sonelle owns a lower-glibc ONNX Runtime build or a proven dynamic-loading bundle.

The same static ONNX Runtime package does not provide a prebuilt `x86_64-apple-darwin` distribution.
Until Sonelle owns a compatible Intel macOS runtime bundle or switches to a proven dynamic-loading
strategy, release candidate and release packaging target macOS Apple Silicon, Linux x64, and Windows
x64 only.
