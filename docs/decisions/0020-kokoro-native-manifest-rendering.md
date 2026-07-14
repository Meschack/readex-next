# 0020: Kokoro Native Manifest Rendering

## Status

Accepted for the hybrid development path. Production pack hosting and listening QA remain pending.

## Context

Sonelle had separate Kokoro pieces: English G2P, prepared model input construction, native ONNX
inference, duration projection, and WAV encoding. Actual testing needs those pieces connected behind
one native renderer so an English passage can produce a normal prepared narration manifest.

## Decision

Sonelle adds a native `kokoro_manifest` module that owns Kokoro manifest rendering orchestration:

- resolving Kokoro model, config, and voice-style files from an installed engine pack;
- selecting American or British English from the Kokoro voice ID;
- phonemizing Sonelle sentence text through `kokoro_text`;
- preparing Kokoro model input through `kokoro_narration`;
- running the duration-preserving Kokoro ONNX model;
- projecting duration output into Sonelle sentence spans;
- encoding the rendered waveform as PCM WAV.

The module refuses to own:

- artifact download policy or engine readiness;
- cache writes and asset identity;
- reader UI state or playback;
- eSpeak fallback packaging;
- accepting a `waveform`-only Kokoro ONNX model.

The app-level manifest command now calls the Kokoro renderer when a Kokoro pack is ready. The
direct cache helper still rejects Kokoro without supplied rendered audio so tests cannot accidentally
fall back to silent English passages.

## Events

No domain event is introduced by this slice. Rendering remains a consequence of future
`AudioPreparationRequested` handling.

## Testing

Portable tests cover Kokoro voice-file and dialect resolution. An ignored real-model test renders a
Kokoro manifest from the local spike assets and verifies the output sample timeline and WAV header.
