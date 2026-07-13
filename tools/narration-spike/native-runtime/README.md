# Native Narration Runtime Spike

## Owns

- repeatable native ONNX Runtime loading, inference, switching, and shutdown evidence;
- comparison of native Kokoro outputs with a fixture produced by the pinned Python reference;
- Linux resident-memory samples around engine transitions;
- proof that malformed model files return errors instead of terminating the app process.

## Refuses To Own

- Sonelle's production narration interfaces, cache, playback, UI, or installer;
- English G2P beyond consuming the development-only reference fixture;
- copied Supertonic architecture. The spike compiles the helper from the exact source revision
  prepared under `.sonelle/narration-spike/`.

## Interface

Run `pnpm spike:narration:native-lifecycle`. The command writes structured evidence to the ignored
`.sonelle/narration-spike/results/native-lifecycle-default.json` and
`.sonelle/narration-spike/results/native-lifecycle-bounded.json` files. The default run preserves
upstream ONNX Runtime allocation behavior; the bounded run disables memory patterns and the CPU
arena so their memory and latency costs can be compared. On Linux, the harness also records a
diagnostic glibc allocator trim after each engine drop. That separates allocator-retained pages from
live session memory; it is not a proposed production cleanup mechanism.

## Testing

The JavaScript launcher has path-resolution coverage in the repository test suite. The Rust binary
validates output shapes and durations during every real-model run. `cargo test` covers its portable
argument and span-independent helpers without loading model files.
