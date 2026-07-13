"""Run the pinned Kokoro reference without making Python a product dependency.

This development harness owns reference G2P, inference, ONNX comparison, and
sentence-span evidence. It does not own Sonelle's production manifest contract,
runtime selection, cache, playback, or UI.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import platform
import resource
import sys
from dataclasses import dataclass
from pathlib import Path
from time import perf_counter
from typing import Any

import espeakng_loader


REPO_ROOT = Path(__file__).resolve().parents[2]
SPIKE_ROOT = REPO_ROOT / ".sonelle" / "narration-spike"
KOKORO_SOURCE = SPIKE_ROOT / "sources" / "kokoro"
KOKORO_ONNX = SPIKE_ROOT / "kokoro-onnx" / "kokoro.onnx"
CORPUS_PATH = REPO_ROOT / "tools" / "narration-spike" / "alignment-corpus.json"
RESULTS_DIR = SPIKE_ROOT / "results" / "kokoro"
SAMPLE_RATE = 24_000


@dataclass(frozen=True)
class TimedToken:
    text_start: int
    text_end: int
    sample_start: int
    sample_end: int


def configure_espeak() -> str:
    """Prefer the OS eSpeak library when Linux's bundled wheel is not relocatable."""

    if platform.system() != "Linux":
        return "bundled"

    library_candidates = [
        *Path("/lib").glob("*/libespeak-ng.so.1"),
        *Path("/usr/lib").glob("*/libespeak-ng.so.1"),
    ]
    data_candidates = [
        *Path("/usr/lib").glob("*/espeak-ng-data"),
        Path("/usr/share/espeak-ng-data"),
    ]
    library = next((path for path in library_candidates if path.is_file()), None)
    data = next((path for path in data_candidates if (path / "phontab").is_file()), None)
    if library is None or data is None:
        raise RuntimeError(
            "The Linux Kokoro reference requires libespeak-ng and espeak-ng-data. "
            "Install the distribution's espeak-ng packages before running the spike."
        )

    espeakng_loader.get_library_path = lambda: str(library)
    espeakng_loader.get_data_path = lambda: str(data)
    return f"system:{library}"


def load_reference_modules() -> tuple[Any, Any, Any, Any, Any, Any]:
    configure_espeak()
    import numpy
    import onnxruntime
    import soundfile
    import torch
    from kokoro import KModel, KPipeline

    return KModel, KPipeline, numpy, onnxruntime, soundfile, torch


def smoke_test() -> None:
    _, KPipeline, _, onnxruntime, _, torch = load_reference_modules()
    pipeline = KPipeline(
        lang_code="a",
        model=False,
        repo_id="hexgrad/Kokoro-82M",
        device="cpu",
    )
    phonemes, tokens = pipeline.g2p("Sonelle keeps narration aligned with the text.")
    if not phonemes or not tokens:
        raise RuntimeError("Kokoro English G2P returned no usable output.")
    print(
        "Kokoro reference ready:",
        f"torch={torch.__version__}",
        f"onnxruntime={onnxruntime.__version__}",
        f"espeak={configure_espeak()}",
    )


def run_corpus() -> None:
    KModel, KPipeline, numpy, onnxruntime, soundfile, _ = load_reference_modules()
    if not KOKORO_ONNX.is_file():
        raise RuntimeError(
            "Kokoro ONNX is missing. Run pnpm spike:narration:kokoro-export first."
        )

    corpus = json.loads(CORPUS_PATH.read_text(encoding="utf-8"))
    config = KOKORO_SOURCE / "checkpoints" / "config.json"
    checkpoint = KOKORO_SOURCE / "checkpoints" / "kokoro-v1_0.pth"
    voice = KOKORO_SOURCE / "checkpoints" / "voices" / "af_heart.pt"
    for required in (config, checkpoint, voice):
        if not required.is_file():
            raise RuntimeError(
                f"Missing {required}. Run pnpm spike:narration:models before the corpus."
            )

    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    model_started = perf_counter()
    model = KModel(
        repo_id="hexgrad/Kokoro-82M",
        config=str(config),
        model=str(checkpoint),
        disable_complex=True,
    ).to("cpu").eval()
    pipeline = KPipeline(
        lang_code="a",
        model=model,
        repo_id="hexgrad/Kokoro-82M",
        device="cpu",
    )
    model_load_seconds = perf_counter() - model_started

    onnx_started = perf_counter()
    session = onnxruntime.InferenceSession(
        str(KOKORO_ONNX), providers=["CPUExecutionProvider"]
    )
    onnx_load_seconds = perf_counter() - onnx_started
    voice_pack = pipeline.load_voice(str(voice)).to("cpu")

    passages: list[dict[str, Any]] = []
    corpus_started = perf_counter()
    for passage in corpus["passages"]:
        passages.append(
            run_passage(
                passage,
                pipeline,
                session,
                voice_pack,
                str(voice),
                model,
                numpy,
                soundfile,
            )
        )

    output = {
        "schemaVersion": 1,
        "engine": "kokoro-python-reference-with-exported-onnx",
        "sampleRate": SAMPLE_RATE,
        "modelLoadSeconds": round(model_load_seconds, 6),
        "onnxLoadSeconds": round(onnx_load_seconds, 6),
        "corpusSeconds": round(perf_counter() - corpus_started, 6),
        "peakResidentMemoryKiB": peak_resident_memory_kib(),
        "passages": passages,
    }
    result_path = RESULTS_DIR / "alignment-results.json"
    result_path.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")

    invalid = [passage["id"] for passage in passages if not passage["manifestValid"]]
    mismatched = [passage["id"] for passage in passages if not passage["onnxDurationsMatch"]]
    print(
        f"Kokoro corpus: {len(passages) - len(invalid)}/{len(passages)} valid manifests; "
        f"{len(passages) - len(mismatched)}/{len(passages)} ONNX duration matches."
    )
    print(f"Evidence: {result_path.relative_to(REPO_ROOT)}")
    if invalid or mismatched:
        raise RuntimeError(
            f"Reference validation failed; invalid={invalid}, duration_mismatch={mismatched}"
        )


def write_native_fixture() -> None:
    _, KPipeline, numpy, onnxruntime, _, torch = load_reference_modules()
    if not KOKORO_ONNX.is_file():
        raise RuntimeError(
            "Kokoro ONNX is missing. Run pnpm spike:narration:kokoro-export first."
        )

    corpus = json.loads(CORPUS_PATH.read_text(encoding="utf-8"))
    passage = corpus["passages"][0]
    text = " ".join(passage["sentences"])
    config_path = KOKORO_SOURCE / "checkpoints" / "config.json"
    voice_path = KOKORO_SOURCE / "checkpoints" / "voices" / "af_heart.pt"
    if not config_path.is_file() or not voice_path.is_file():
        raise RuntimeError("Kokoro config or voice is missing. Run the model setup first.")

    pipeline = KPipeline(
        lang_code="a",
        model=False,
        repo_id="hexgrad/Kokoro-82M",
        device="cpu",
    )
    _, tokens = pipeline.g2p(text)
    prepared = list(pipeline.en_tokenize(tokens))
    if len(prepared) != 1:
        raise RuntimeError("The native fixture passage must fit one Kokoro model invocation.")
    _, phonemes, _ = prepared[0]

    config = json.loads(config_path.read_text(encoding="utf-8"))
    input_ids = [config["vocab"].get(phoneme) for phoneme in phonemes]
    input_ids = [token_id for token_id in input_ids if token_id is not None]
    input_ids = [0, *input_ids, 0]
    voice_pack = torch.load(voice_path, map_location="cpu", weights_only=True)
    style = voice_pack[len(phonemes) - 1].detach().cpu().numpy()
    speed = numpy.asarray([1], dtype=numpy.int32)

    session = onnxruntime.InferenceSession(
        str(KOKORO_ONNX), providers=["CPUExecutionProvider"]
    )
    waveform, durations = session.run(
        None,
        {
            "input_ids": numpy.asarray([input_ids], dtype=numpy.int64),
            "style": style,
            "speed": speed,
        },
    )
    fixture = {
        "schemaVersion": 1,
        "passageId": passage["id"],
        "textSha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
        "sampleRate": SAMPLE_RATE,
        "inputIds": input_ids,
        "style": style.reshape(-1).tolist(),
        "speed": int(speed[0]),
        "expectedDurations": durations.reshape(-1).tolist(),
        "expectedWaveformSamples": int(waveform.size),
    }
    fixture_path = RESULTS_DIR / "native-fixture.json"
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    fixture_path.write_text(json.dumps(fixture, indent=2) + "\n", encoding="utf-8")
    print(f"Native Kokoro fixture: {fixture_path.relative_to(REPO_ROOT)}")


def run_passage(
    passage: dict[str, Any],
    pipeline: Any,
    session: Any,
    voice_pack: Any,
    voice_path: str,
    model: Any,
    numpy: Any,
    soundfile: Any,
) -> dict[str, Any]:
    text = " ".join(passage["sentences"])
    inference_started = perf_counter()
    results = list(
        pipeline(text, voice=voice_path, speed=1.0, split_pattern=None, model=model)
    )
    reference_seconds = perf_counter() - inference_started
    if not results:
        raise RuntimeError(f"Kokoro returned no audio for {passage['id']}.")

    audio_parts = [result.audio.detach().cpu().numpy() for result in results]
    audio = numpy.concatenate(audio_parts)
    timed_tokens = collect_timed_tokens(text, results)
    sentence_ranges = locate_sentences(text, passage["sentences"])
    spans = build_sentence_spans(sentence_ranges, timed_tokens, len(audio))
    manifest_valid = validate_spans(spans, len(audio), len(passage["sentences"]))

    onnx_started = perf_counter()
    duration_matches: list[bool] = []
    waveform_differences: list[float] = []
    onnx_audio_parts: list[Any] = []
    for result in results:
        input_ids = [model.vocab.get(phoneme) for phoneme in result.phonemes]
        input_ids = [token_id for token_id in input_ids if token_id is not None]
        inputs = {
            "input_ids": numpy.asarray([[0, *input_ids, 0]], dtype=numpy.int64),
            "style": voice_pack[len(result.phonemes) - 1].detach().cpu().numpy(),
            "speed": numpy.asarray([1], dtype=numpy.int32),
        }
        onnx_audio, onnx_duration = session.run(None, inputs)
        onnx_audio_parts.append(onnx_audio)
        reference_duration = result.pred_dur.detach().cpu().numpy()
        duration_matches.append(numpy.array_equal(onnx_duration, reference_duration))
        reference_audio = result.audio.detach().cpu().numpy()
        if onnx_audio.shape != reference_audio.shape:
            waveform_differences.append(float("inf"))
        else:
            waveform_differences.append(
                float(numpy.max(numpy.abs(onnx_audio - reference_audio)))
            )
    onnx_seconds = perf_counter() - onnx_started

    onnx_audio = numpy.concatenate(onnx_audio_parts)
    reference_wav = RESULTS_DIR / f"{passage['id']}-reference.wav"
    onnx_wav = RESULTS_DIR / f"{passage['id']}-onnx.wav"
    soundfile.write(reference_wav, audio, SAMPLE_RATE, subtype="PCM_16")
    soundfile.write(onnx_wav, onnx_audio, SAMPLE_RATE, subtype="PCM_16")
    audio_seconds = len(audio) / SAMPLE_RATE
    return {
        "id": passage["id"],
        "category": passage["category"],
        "sentenceCount": len(passage["sentences"]),
        "resultCount": len(results),
        "audioSamples": len(audio),
        "audioSeconds": round(audio_seconds, 6),
        "referenceInferenceSeconds": round(reference_seconds, 6),
        "referenceRealTimeFactor": round(reference_seconds / audio_seconds, 6),
        "onnxInferenceSeconds": round(onnx_seconds, 6),
        "onnxRealTimeFactor": round(onnx_seconds / audio_seconds, 6),
        "onnxDurationsMatch": all(duration_matches),
        "onnxWaveformMaxAbsoluteDifference": max(waveform_differences),
        "referenceAudioFile": reference_wav.name,
        "onnxAudioFile": onnx_wav.name,
        "manifestValid": manifest_valid,
        "spans": spans,
    }


def collect_timed_tokens(text: str, results: list[Any]) -> list[TimedToken]:
    timed_tokens: list[TimedToken] = []
    text_cursor = 0
    sample_offset = 0
    for result in results:
        result_start = text.find(result.graphemes, text_cursor)
        if result_start < 0:
            raise RuntimeError("Kokoro result text could not be mapped back to the passage.")
        token_cursor = 0
        for token in result.tokens or []:
            token_start = result.graphemes.find(token.text, token_cursor)
            if token_start < 0:
                raise RuntimeError(f"Kokoro token {token.text!r} could not be mapped to its result.")
            token_end = token_start + len(token.text)
            token_cursor = token_end + len(token.whitespace)
            if token.start_ts is None or token.end_ts is None:
                continue
            timed_tokens.append(
                TimedToken(
                    text_start=result_start + token_start,
                    text_end=result_start + token_end,
                    sample_start=sample_offset + round(token.start_ts * SAMPLE_RATE),
                    sample_end=sample_offset + round(token.end_ts * SAMPLE_RATE),
                )
            )
        text_cursor = result_start + len(result.graphemes)
        sample_offset += result.audio.numel()
    return timed_tokens


def locate_sentences(text: str, sentences: list[str]) -> list[tuple[int, int]]:
    ranges: list[tuple[int, int]] = []
    cursor = 0
    for sentence in sentences:
        start = text.find(sentence, cursor)
        if start < 0:
            raise RuntimeError(f"Sentence could not be located in passage: {sentence!r}")
        end = start + len(sentence)
        ranges.append((start, end))
        cursor = end
    return ranges


def build_sentence_spans(
    sentence_ranges: list[tuple[int, int]],
    timed_tokens: list[TimedToken],
    audio_samples: int,
) -> list[dict[str, Any]]:
    token_starts: list[int] = []
    for sentence_start, sentence_end in sentence_ranges:
        sentence_tokens = [
            token
            for token in timed_tokens
            if token.text_start < sentence_end and token.text_end > sentence_start
        ]
        if not sentence_tokens:
            raise RuntimeError("A sentence has no timed Kokoro tokens.")
        token_starts.append(sentence_tokens[0].sample_start)

    boundaries = [0, *token_starts[1:], audio_samples]
    return [
        {
            "sentenceIndex": index,
            "sampleStart": boundaries[index],
            "sampleEnd": boundaries[index + 1],
            "startSeconds": round(boundaries[index] / SAMPLE_RATE, 6),
            "endSeconds": round(boundaries[index + 1] / SAMPLE_RATE, 6),
        }
        for index in range(len(sentence_ranges))
    ]


def validate_spans(
    spans: list[dict[str, Any]], audio_samples: int, sentence_count: int
) -> bool:
    if len(spans) != sentence_count or not spans:
        return False
    if spans[0]["sampleStart"] != 0 or spans[-1]["sampleEnd"] != audio_samples:
        return False
    return all(
        span["sampleStart"] < span["sampleEnd"]
        and span["sampleEnd"] == spans[index + 1]["sampleStart"]
        for index, span in enumerate(spans[:-1])
    ) and spans[-1]["sampleStart"] < spans[-1]["sampleEnd"]


def peak_resident_memory_kib() -> int:
    value = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return round(value / 1024) if platform.system() == "Darwin" else value


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--smoke", action="store_true", help="verify English G2P dependencies")
    mode.add_argument("--corpus", action="store_true", help="generate alignment evidence")
    mode.add_argument(
        "--native-fixture",
        action="store_true",
        help="export one pinned ONNX input and expected output",
    )
    return parser.parse_args()


if __name__ == "__main__":
    arguments = parse_args()
    try:
        if arguments.smoke:
            smoke_test()
        elif arguments.corpus:
            run_corpus()
        else:
            write_native_fixture()
    except Exception as error:
        print(f"Kokoro reference failed: {error}", file=sys.stderr)
        raise
