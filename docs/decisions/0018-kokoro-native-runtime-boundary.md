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

- validating prepared input dimensions;
- loading the selected Kokoro voice style row for a prepared phoneme length;
- loading the Kokoro ONNX session;
- passing `input_ids`, `style`, and `speed` into ONNX Runtime;
- returning waveform samples and duration outputs.

It refuses to own:

- English grapheme-to-phoneme conversion;
- tokenization, punctuation normalization, or sentence splitting;
- sentence-span projection;
- cache writes, playback, or UI state.

The module intentionally takes already-prepared model input. The next Kokoro slice can build the
text-preparation layer and then project duration outputs into Sonelle sentence spans without hiding
that work behind an inference helper.

## Events

No domain event is introduced by this slice. It is a native adapter boundary used by future
`AudioPreparationRequested` handling.

## Testing

Portable tests cover invalid prepared input rejection, voice style loading, invalid voice style
files, and shared PCM WAV encoding. An ignored test runs the real Kokoro ONNX model against the
pinned native fixture from the narration spike and checks both waveform sample count and duration
output equality.
