# 0019: Kokoro English G2P Boundary

## Status

Accepted for the hybrid development path. Listening QA and final license review remain release
gates.

## Context

Kokoro needs English grapheme-to-phoneme conversion before Sonelle can build model inputs from real
book text. The Python reference uses Misaki and an eSpeak fallback, but shipping Python inside the
desktop app would add runtime weight, packaging risk, and another platform failure surface.

The Rust `misaki-rs` crate provides a Kokoro-oriented English G2P implementation with embedded
lexicons and tagger data. Its default feature enables an eSpeak fallback, so Sonelle must opt out of
default features until the fallback's licensing, platform packaging, and runtime behavior are
explicitly approved.

## Decision

Sonelle adds a native `kokoro_text` module that owns English text preprocessing for Kokoro:

- accepting Sonelle sentence IDs and text;
- selecting American or British English phonemization;
- calling `misaki-rs` with default features disabled;
- rejecting empty text or unknown phoneme output before model preparation;
- returning `KokoroSentencePhonemes` for the native Kokoro inference boundary.

The module refuses to own:

- Kokoro ONNX inference;
- voice style loading;
- sentence duration projection;
- cache writes, playback, or UI state;
- eSpeak fallback packaging.

The initial path deliberately favors a narrower offline dependency over maximum out-of-vocabulary
coverage. If real-book QA shows unacceptable unknown-word behavior, the fallback decision must be
made explicitly with license and platform evidence instead of quietly enabling the default feature.

## Events

No domain event is introduced by this slice. The module is preparation plumbing for future
`AudioPreparationRequested` handling.

## Testing

Portable tests cover American and British English phonemization, sentence ID preservation, empty
sentence rejection, and unknown phoneme rejection. Dependency checks confirm `espeak-rs` is not part
of the native dependency tree.
