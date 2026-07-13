# Narration Runtime Spike

## Status

In progress. Started 2026-07-13 on `featt/narration-phase-0`.

This report records the evidence required before Sonelle commits its production runtime to Kokoro
and Supertonic. It is deliberately separate from the migration plan: the plan says what must be
learned, while this file records what the machines actually did.

## Pinned Inputs

| Input                      | Revision                                   | Purpose                                                          |
| -------------------------- | ------------------------------------------ | ---------------------------------------------------------------- |
| `hexgrad/kokoro`           | `dfb907a02bba8152ca444717ca5d78747ccb4bec` | Official Python reference and ONNX export                        |
| `hexgrad/Kokoro-82M`       | `f3ff3571791e39611d31c381e3a41a3af07b4987` | Kokoro model, configuration, and initial American/British voices |
| `supertone-inc/supertonic` | `dff55dc00064c398736080c78195f577527832ae` | Official native Rust ONNX reference                              |
| `Supertone/supertonic-3`   | `3cadd1ee6394adea1bd021217a0e650ede09a323` | Supertonic 3 model and initial F1/M1 styles                      |

Artifact sizes and SHA-256 digests live in
[`../../tools/narration-spike/engines.json`](../../tools/narration-spike/engines.json). Spike setup
rejects a file unless both values match.

## Reproduction

Prepare the pinned source repositories without downloading models:

```bash
pnpm spike:narration:setup
```

Download and verify the approximately 730 MB initial model set:

```bash
pnpm spike:narration:models
```

Verify an existing source and model workspace without changing it:

```bash
pnpm spike:narration:verify
```

Create the pinned, CPU-only official Kokoro Python reference environment:

```bash
pnpm spike:narration:kokoro-reference
```

Export the official Kokoro checkpoint to ONNX after preparing that environment:

```bash
pnpm spike:narration:kokoro-export
```

Generate reference and ONNX audio plus sentence-span evidence for the checked-in corpus:

```bash
pnpm spike:narration:kokoro-corpus
```

Build the pinned Rust ONNX Runtime harness and compare default versus bounded allocation while
loading, switching, dropping, and reloading both engines:

```bash
pnpm spike:narration:native-lifecycle
```

Use `--engine=kokoro` or `--engine=supertonic` after `--` to prepare one engine. Everything is
stored beneath the ignored `.sonelle/narration-spike/` directory.

## Questions To Resolve

1. Can a shared native ONNX Runtime dependency support both engines on every desktop release target?
2. Can Sonelle reproduce Kokoro's English G2P and duration mapping without shipping Python?
3. Are Kokoro sentence spans accurate across the checked-in alignment corpus and configured books?
4. Does Supertonic batch inference materially improve throughput over sequential sentence calls?
5. What are the cold load, warm inference, peak memory, and release-size costs of each candidate?
6. Can an active engine unload cleanly before the other engine loads?
7. What native libraries must be bundled, signed, attributed, and updated per platform?

## Reference Machine Results

Record the exact hardware, OS, power mode, compiler, and runtime versions with every result.

First Linux run:

- Ubuntu 24.04.3 LTS, kernel `6.17.0-35-generic`, x86_64;
- Intel Core i5-1235U, 10 cores / 12 logical CPUs;
- 15 GiB RAM with existing system swap pressure during the run;
- Rust/Cargo 1.95.0, Node 22.16.0, pnpm 11.7.0;
- Supertonic official Rust example built in release mode on CPU;
- Supertonic F1, French, eight inference steps, speed 1.05;
- source revision and model snapshot exactly matching the pinned-input table.

These are preliminary feasibility measurements, not final acceptance baselines. The machine was not
isolated, power mode was not pinned, and the official CLI starts and loads the model for every
measurement.

| Measurement               | Kokoro native default | Kokoro native bounded | Kokoro Python reference | Supertonic native default | Supertonic native bounded |
| ------------------------- | --------------------: | --------------------: | ----------------------: | ------------------------: | ------------------------: |
| Downloaded model bytes    |           351,775,811 |           351,775,811 |             328,261,422 |               398,960,177 |               398,960,177 |
| Added Linux runtime bytes |            27,949,440 |            27,949,440 |                 Pending |                27,949,440 |                27,949,440 |
| Cold model/session load   |          1.206-1.518s |          0.992-1.294s |                  2.167s |              0.738-0.897s |              0.689-0.709s |
| Warm paragraph RTF        |           0.395-0.465 |           0.556-0.595 |             0.629-1.056 |               0.511-0.574 |               0.290-0.362 |
| Corpus RTF                |               Pending |               Pending |                   0.872 |                       N/A |                       N/A |
| Peak observed RSS         |             1,220 MiB |               689 MiB |   2.58 GiB combined run |                   485 MiB |                   476 MiB |
| RSS after drop            |           138-203 MiB |            82-405 MiB |                 Pending |               456-482 MiB |               306-471 MiB |
| RSS after glibc trim      |             33-34 MiB |             33-34 MiB |                     N/A |                 35-36 MiB |                 35-36 MiB |
| Destructor time           |               44-83ms |               16-40ms |                 Pending |                   11-13ms |                   15-30ms |

The Kokoro corpus contains 170.9 seconds of audio. Its ONNX and Python timings were collected in one
process, so the 2.58 GiB peak is deliberately labeled as a combined reference cost, not a native
production estimate. Native lifecycle figures come from two non-isolated runs per allocation mode
and are not yet p50 or p95 acceptance baselines. The 27.9 MB unstripped harness statically contains
ONNX Runtime and dynamically links only standard Linux runtime libraries.

The native reference compiled successfully in 65 seconds after dependency download. Its preliminary
Linux executable has no separately linked ONNX Runtime library, but production bundle measurements
must include stripping, licenses, platform runtime files, and Tauri integration.

### Early Native Findings

- The official Supertonic Rust manifest declares `ort = "2.0.0-rc.7"` without committing a lockfile.
  The native harness pins `ort` and `ort-sys` 2.0.0-rc.12 exactly and commits its standalone
  lockfile. The eventual production crate must keep that exact-version policy.
- The official example calls `mem::forget` and `libc::_exit(0)` to avoid an ONNX Runtime mutex cleanup
  issue documented for macOS. Sonelle cannot copy that lifecycle because it must unload or switch
  engines inside a long-running Tauri process. The Linux harness reached ordinary Rust destruction
  after loading Kokoro, switching to Supertonic, switching back, and validating Kokoro again. This
  passes the Linux lifecycle gate but does not close the documented macOS risk.
- Both allocation modes rejected a deliberately malformed ONNX model as a recoverable error. This
  proves the tested model-load failure path can report an error without terminating the host
  process; missing files and incompatible model revisions still need explicit coverage.
- Default ONNX Runtime allocation reached 1,220 MiB RSS while bounded allocation reduced the highest
  observed sample to 689 MiB, but the bounded Kokoro run was slower and these are single-run,
  non-isolated measurements. Repeated p50/p95 measurements are required before selecting the
  production allocation policy.
- RSS remained hundreds of MiB immediately after ordinary destructors, then returned to 33-36 MiB
  after a diagnostic `malloc_trim(0)` on glibc. That strongly suggests allocator-retained freed pages
  rather than live model sessions on this Linux run. Trimming is evidence tooling, not yet a
  production policy, and equivalent evidence is still required on Windows and macOS.
- Batch inference improved the preliminary RTF by roughly 16% compared with the short and paragraph
  single-call runs, while raising peak memory. A persistent-session sequential baseline is still
  required before choosing the production Supertonic prefetch batch size.
- The verified setup download resumed a 256 MB interrupted artifact from its partial file. The
  first attempt exposed that retry must cover the streamed response body, not only connection
  establishment; the setup tool now retries the full transfer from the last received byte.

### Early Kokoro Reference Findings

- Kokoro's pinned upstream `uv.lock` contains Misaki 0.9.2 while the same source revision requires
  `misaki[en]>=0.9.4` in `pyproject.toml`. The reference harness follows the source requirement and
  pins Misaki 0.9.4.
- Installing the official source plus Misaki 0.9.4 on Python 3.12 resolved spaCy 3.8.14 and Typer
  0.26.8, but the resulting environment did not contain `click` and failed during `import kokoro`.
  The harness pins Click 8.1.8 explicitly. This reinforces that a bundled Python environment would
  need a Sonelle-owned, fully locked dependency set rather than the upstream ranges alone.
- Misaki downloads `en_core_web_sm` the first time English G2P is constructed. The harness now pins
  version 3.8.0 and its SHA-256 so a benchmark cannot quietly fetch mutable tooling during a run.
- The `espeakng-loader` 0.2.4 Linux library contains its GitHub Actions build path and failed before
  G2P with a missing `phontab`. The reference harness uses the distribution's `libespeak-ng` and
  data on Linux. A production native G2P path must own this dependency and packaging explicitly.
- All ten corpus passages produced structurally valid, gap-free sentence spans, and the exported
  ONNX duration tensors exactly matched the pinned PyTorch reference. The maximum absolute waveform
  sample difference was 0.180, so both audio versions are retained for listening QA rather than
  treating duration equality as proof of audio equivalence.

## Cross-Platform Results

| Platform            | Build   | Clean start | Synthesis | Shutdown | Candidate bundle | Notes                                                      |
| ------------------- | ------- | ----------- | --------- | -------- | ---------------- | ---------------------------------------------------------- |
| Windows x64         | Pending | Pending     | Pending   | Pending  | Pending          |                                                            |
| Linux x64           | Pass    | Pass        | Pass      | Pass     | Pending          | Native harness; bundle sizing and Tauri integration remain |
| macOS Intel         | Pending | Pending     | Pending   | Pending  | Pending          |                                                            |
| macOS Apple Silicon | Pending | Pending     | Pending   | Pending  | Pending          |                                                            |

## Alignment Results

Record manifest validity separately from perceived prosody. A pleasant voice with dishonest
highlighting still fails.

| Corpus category                 | Passages | Valid manifests | Sentence fallback | Audible mismatch | Notes                          |
| ------------------------------- | -------: | --------------: | ----------------: | ---------------: | ------------------------------ |
| Plain prose                     |        1 |               1 |                 0 |          Pending | ONNX durations match reference |
| Dialogue and quotations         |        1 |               1 |                 0 |          Pending | ONNX durations match reference |
| Numbers and abbreviations       |        2 |               2 |                 0 |          Pending | ONNX durations match reference |
| Complex punctuation             |        3 |               3 |                 0 |          Pending | ONNX durations match reference |
| Headings and short paragraphs   |        2 |               2 |                 0 |          Pending | ONNX durations match reference |
| Long sentences and model limits |        1 |               1 |                 0 |          Pending | ONNX durations match reference |

## License Review

| Dependency or model       | Pinned license       | Redistribution reviewed | Notices prepared | Decision |
| ------------------------- | -------------------- | ----------------------- | ---------------- | -------- |
| Kokoro source and weights | Apache-2.0           | Pending                 | Pending          | Pending  |
| Misaki / English G2P data | Pending verification | Pending                 | Pending          | Pending  |
| `espeak-ng` fallback      | Pending verification | Pending                 | Pending          | Pending  |
| Supertonic source         | MIT                  | Pending                 | Pending          | Pending  |
| Supertonic 3 model        | OpenRAIL-M           | Pending                 | Pending          | Pending  |
| ONNX Runtime              | Pending verification | Pending                 | Pending          | Pending  |

## Exit Decision

Phase 0 is not complete until this report names:

- the production runtime shape;
- the pinned engine and model revisions;
- the Kokoro preprocessing and timing strategy;
- the model installation and unloading policy;
- accepted performance budgets;
- platform-specific packaging requirements;
- license obligations and prepared notices;
- rejected alternatives with measured reasons.

Until then, production narration contracts remain unchanged and Piper remains the working adapter.
