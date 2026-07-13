# 0018: Kokoro Native Runtime Boundary

## Status

Accepted for the hybrid development path. English text preprocessing remains pending.

## Context

The Supertonic path already renders real audio from installed ONNX files. Kokoro still needs two
separate pieces before English books can be tested end to end:

- a native ONNX inference boundary that can run the exported Kokoro model;
- English text preprocessing that converts Sonelle passage text into Kokoro input IDs, style
  vectors, and validated sentence timing.

Those pieces should not be welded together. The native runtime must be testable against the pinned
fixture before the text preprocessing layer starts calling it.

## Decision

The `kokoro_narration` module owns prepared Kokoro model inference:

- mapping already-phonemized text through Kokoro's model vocabulary;
- preparing a single Kokoro passage from sentence-level phoneme segments;
- validating prepared input dimensions;
- loading the selected Kokoro voice style row for a prepared phoneme length;
- loading the Kokoro ONNX session;
- passing `input_ids`, `style`, and `speed` into ONNX Runtime;
- returning waveform samples and duration outputs;
- projecting Kokoro duration units into contiguous Sonelle sentence spans when the caller supplies
  sentence-level phoneme ownership.

It refuses to own:

- English grapheme-to-phoneme conversion;
- tokenization, punctuation normalization, or sentence splitting;
- cache writes, playback, or UI state.

The module intentionally takes already-prepared model input or already-phonemized sentence
segments. The next Kokoro slice can build the grapheme-to-phoneme layer without hiding that work
behind an inference helper.

The pinned Kokoro ONNX asset for Sonelle must expose both `waveform` and `duration`. The public
community ONNX package that only returns `waveform` is not sufficient for the reader-first path,
because sentence highlighting would have to become estimated or separately force-aligned.

## Events

No domain event is introduced by this slice. It is a native adapter boundary used by future
`AudioPreparationRequested` handling.

## Testing

Portable tests cover phoneme-to-input preparation, sentence-level passage preparation, duration
projection into Sonelle sentence spans, invalid prepared input rejection, voice style loading,
invalid voice style files, and shared PCM WAV encoding. An ignored test runs the real Kokoro ONNX
model against the pinned native fixture from the narration spike and checks both waveform sample
count and duration output equality.
