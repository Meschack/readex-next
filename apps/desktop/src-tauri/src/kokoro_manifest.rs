use ort::session::RunOptions;
use std::{
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};

use crate::error_log::record_native_error;
use crate::kokoro_narration::{
    prepare_kokoro_input_from_phonemes, KokoroRuntime, KOKORO_SAMPLE_RATE,
};
use crate::kokoro_text::{
    phonemize_kokoro_english_sentences, KokoroEnglishDialect, KokoroTextSentence,
};
use crate::narration_cache::NarrationSentenceSpan;
use crate::narration_manifest::ensure_narration_not_cancelled;
use crate::narration_manifest::ManifestNarrationRequest;
use crate::narration_rendered_audio::RenderedManifestAudio;
use crate::narration_wav::float_wav;

const KOKORO_TEXT_CHUNK_TARGET_CHARS: usize = 260;
const KOKORO_TEXT_SPLIT_DEPTH_LIMIT: usize = 8;
static KOKORO_RUNTIME: OnceLock<Mutex<Option<KokoroRuntime>>> = OnceLock::new();

pub(crate) struct KokoroAssets {
    config: PathBuf,
    voice: PathBuf,
    model: PathBuf,
}

#[cfg(test)]
pub fn render_kokoro_manifest(
    engine_installation_path: &Path,
    request: &ManifestNarrationRequest,
) -> Result<RenderedManifestAudio, String> {
    let run_options =
        RunOptions::new().map_err(|_| "Sonelle couldn't start English narration.".to_string())?;
    render_kokoro_manifest_with_options(engine_installation_path, request, &run_options)
}

pub fn render_kokoro_manifest_with_options(
    engine_installation_path: &Path,
    request: &ManifestNarrationRequest,
    run_options: &RunOptions,
) -> Result<RenderedManifestAudio, String> {
    let assets = resolve_kokoro_assets(engine_installation_path, &request.voice_id)?;
    let voice_file = kokoro_voice_file(&request.voice_id);
    let dialect = kokoro_dialect_for_voice_file(&voice_file);
    let mut runtime_guard = KOKORO_RUNTIME
        .get_or_init(|| Mutex::new(None))
        .lock()
        .map_err(|_| "English narration is already busy. Please try again.".to_string())?;
    if runtime_guard
        .as_ref()
        .is_none_or(|runtime| !runtime.matches(&assets.model))
    {
        *runtime_guard = Some(KokoroRuntime::open(&assets.model)?);
    }
    let runtime = runtime_guard
        .as_mut()
        .ok_or_else(|| "Sonelle couldn't start English narration.".to_string())?;
    let mut audio = Vec::new();
    let mut spans = Vec::with_capacity(request.passage.sentences.len());
    let mut start_sample = 0_u64;

    for sentence in &request.passage.sentences {
        ensure_narration_not_cancelled(&request.request_id)?;
        let sentence_text = sentence.text.trim();
        let sentence_audio = match phonemize_kokoro_sentence(&sentence.id, sentence_text, dialect) {
            Ok(phonemes) => render_kokoro_sentence_audio(
                &assets.config,
                &assets.voice,
                runtime,
                dialect,
                sentence_text,
                &phonemes,
                run_options,
            )?,
            Err(error) => return Err(error),
        };
        let sentence_samples = u64::try_from(sentence_audio.len())
            .map_err(|_| "Prepared narration audio is too large.".to_string())?;
        if sentence_samples == 0 {
            return Err("English narration returned invalid audio.".to_string());
        }
        let end_sample = start_sample
            .checked_add(sentence_samples)
            .ok_or_else(|| "Prepared narration audio is too large.".to_string())?;
        spans.push(NarrationSentenceSpan {
            sentence_id: sentence.id.clone(),
            start_sample,
            end_sample,
        });
        audio.extend(sentence_audio);
        start_sample = end_sample;
    }

    Ok(RenderedManifestAudio {
        sample_rate: KOKORO_SAMPLE_RATE,
        sample_count: start_sample,
        sentences: spans,
        wav: float_wav(KOKORO_SAMPLE_RATE, &audio)?,
    })
}

pub(crate) fn resolve_kokoro_assets(
    engine_installation_path: &Path,
    voice_id: &str,
) -> Result<KokoroAssets, String> {
    let voice_file = kokoro_voice_file(voice_id);
    let config = first_existing_path(
        engine_installation_path,
        &[
            "assets/config.json",
            "checkpoints/config.json",
            "config.json",
            "sources/kokoro/checkpoints/config.json",
        ],
    )?;
    let voice = first_existing_path(
        engine_installation_path,
        &[
            &format!("assets/voices/{voice_file}"),
            &format!("voices/{voice_file}"),
            &format!("checkpoints/voices/{voice_file}"),
            &format!("sources/kokoro/kokoro.js/voices/{voice_file}"),
        ],
    )?;
    let model = first_existing_path(
        engine_installation_path,
        &[
            "assets/kokoro.onnx",
            "kokoro.onnx",
            "assets/onnx/kokoro.onnx",
            "kokoro-onnx/kokoro.onnx",
        ],
    )?;

    Ok(KokoroAssets {
        config,
        voice,
        model,
    })
}

fn render_kokoro_sentence_audio(
    config_path: &Path,
    voice_path: &Path,
    runtime: &mut KokoroRuntime,
    dialect: KokoroEnglishDialect,
    text: &str,
    phonemes: &str,
    run_options: &RunOptions,
) -> Result<Vec<f32>, String> {
    let first_attempt =
        render_kokoro_phonemes(config_path, voice_path, runtime, phonemes, run_options);
    match first_attempt {
        Ok(samples) => Ok(samples),
        Err(error) if is_kokoro_input_too_long(&error) => {
            let mut audio = Vec::new();
            for chunk in split_kokoro_text_for_model(text) {
                audio.extend(render_kokoro_text_chunk(
                    config_path,
                    voice_path,
                    runtime,
                    dialect,
                    &chunk,
                    0,
                    run_options,
                )?);
            }
            Ok(audio)
        }
        Err(error) => Err(error),
    }
}

fn render_kokoro_text_chunk(
    config_path: &Path,
    voice_path: &Path,
    runtime: &mut KokoroRuntime,
    dialect: KokoroEnglishDialect,
    text: &str,
    depth: usize,
    run_options: &RunOptions,
) -> Result<Vec<f32>, String> {
    let text = text.trim();
    if text.is_empty() {
        return Err("English narration input is invalid.".to_string());
    }

    let phonemes = phonemize_kokoro_english_sentences(
        &[KokoroTextSentence {
            sentence_id: "kokoro-render-part".to_string(),
            text: text.to_string(),
        }],
        dialect,
    )?;
    let phonemes = phonemes
        .first()
        .ok_or_else(|| "English narration input is invalid.".to_string())?;

    match render_kokoro_phonemes(
        config_path,
        voice_path,
        runtime,
        &phonemes.phonemes,
        run_options,
    ) {
        Ok(samples) => Ok(samples),
        Err(error) if is_kokoro_input_too_long(&error) && depth < KOKORO_TEXT_SPLIT_DEPTH_LIMIT => {
            let (left, right) = split_text_roughly_in_half(text).ok_or(error)?;
            let mut audio = render_kokoro_text_chunk(
                config_path,
                voice_path,
                runtime,
                dialect,
                left,
                depth + 1,
                run_options,
            )?;
            audio.extend(render_kokoro_text_chunk(
                config_path,
                voice_path,
                runtime,
                dialect,
                right,
                depth + 1,
                run_options,
            )?);
            Ok(audio)
        }
        Err(error) => Err(error),
    }
}

fn render_kokoro_phonemes(
    config_path: &Path,
    voice_path: &Path,
    runtime: &mut KokoroRuntime,
    phonemes: &str,
    run_options: &RunOptions,
) -> Result<Vec<f32>, String> {
    let prepared = prepare_kokoro_input_from_phonemes(config_path, voice_path, phonemes, 1)?;
    let rendered = runtime.render_with_options(&prepared, run_options)?;
    Ok(rendered.samples)
}

fn split_kokoro_text_for_model(text: &str) -> Vec<String> {
    let mut chunks = Vec::new();
    let mut current = String::new();

    for word in text.split_whitespace() {
        let separator = usize::from(!current.is_empty());
        if !current.is_empty()
            && current.len() + separator + word.len() > KOKORO_TEXT_CHUNK_TARGET_CHARS
        {
            chunks.push(current);
            current = String::new();
        }

        if !current.is_empty() {
            current.push(' ');
        }
        current.push_str(word);

        if current.len() >= KOKORO_TEXT_CHUNK_TARGET_CHARS / 2 && ends_with_soft_break(word) {
            chunks.push(current);
            current = String::new();
        }
    }

    if !current.is_empty() {
        chunks.push(current);
    }

    chunks
}

fn split_text_roughly_in_half(text: &str) -> Option<(&str, &str)> {
    let trimmed = text.trim();
    let midpoint = trimmed.len() / 2;
    let split_index = trimmed
        .char_indices()
        .filter_map(|(index, character)| character.is_whitespace().then_some(index))
        .min_by_key(|index| index.abs_diff(midpoint))?;
    let (left, right) = trimmed.split_at(split_index);
    let right = right.trim_start();
    if left.trim().is_empty() || right.is_empty() {
        return None;
    }

    Some((left.trim(), right))
}

fn ends_with_soft_break(word: &str) -> bool {
    word.ends_with([',', ';', ':', '.', '?', '!']) || word.ends_with("\",") || word.ends_with("\".")
}

fn is_kokoro_input_too_long(error: &str) -> bool {
    error == "English narration input is too long."
}

fn phonemize_kokoro_sentence(
    sentence_id: &str,
    text: &str,
    dialect: KokoroEnglishDialect,
) -> Result<String, String> {
    let phonemes = phonemize_kokoro_english_sentences(
        &[KokoroTextSentence {
            sentence_id: sentence_id.to_string(),
            text: text.to_string(),
        }],
        dialect,
    )?;
    phonemes
        .first()
        .map(|sentence| sentence.phonemes.clone())
        .ok_or_else(|| "English narration input is invalid.".to_string())
}

fn first_existing_path(root: &Path, relative_paths: &[&str]) -> Result<PathBuf, String> {
    let candidates = relative_paths
        .iter()
        .map(|relative| root.join(relative))
        .collect::<Vec<_>>();
    if let Some(path) = candidates.iter().find(|path| path.is_file()) {
        return Ok(path.clone());
    }

    record_native_error(
        "kokoro.assets",
        &format!(
            "root={} missing={}",
            root.display(),
            candidates
                .iter()
                .map(|path| path.display().to_string())
                .collect::<Vec<_>>()
                .join(",")
        ),
    );
    Err("Sonelle couldn't open English narration files.".to_string())
}

fn kokoro_voice_file(voice_id: &str) -> String {
    let normalized = voice_id
        .split(':')
        .next_back()
        .unwrap_or(voice_id)
        .replace('-', "_")
        .to_ascii_lowercase();

    if normalized.ends_with(".bin") {
        normalized
    } else if normalized.is_empty() || normalized == "voice" {
        "af_heart.bin".to_string()
    } else {
        format!("{normalized}.bin")
    }
}

fn kokoro_dialect_for_voice_file(voice_file: &str) -> KokoroEnglishDialect {
    if voice_file.starts_with("bf_") || voice_file.starts_with("bm_") {
        KokoroEnglishDialect::British
    } else {
        KokoroEnglishDialect::American
    }
}

#[cfg(test)]
mod tests {
    use std::{collections::BTreeMap, path::PathBuf};

    use super::{kokoro_dialect_for_voice_file, kokoro_voice_file, render_kokoro_manifest};
    use crate::kokoro_text::KokoroEnglishDialect;
    use crate::narration_manifest::{
        ManifestNarrationPassage, ManifestNarrationRequest, ManifestNarrationSentence,
    };

    #[test]
    fn resolves_kokoro_voice_files_from_voice_ids() {
        assert_eq!(kokoro_voice_file("kokoro:af-heart"), "af_heart.bin");
        assert_eq!(kokoro_voice_file("bf_emma"), "bf_emma.bin");
        assert_eq!(kokoro_voice_file("bf_emma.bin"), "bf_emma.bin");
        assert_eq!(kokoro_voice_file("kokoro:voice"), "af_heart.bin");
    }

    #[test]
    fn resolves_dialect_from_voice_file() {
        assert_eq!(
            kokoro_dialect_for_voice_file("af_heart.bin"),
            KokoroEnglishDialect::American
        );
        assert_eq!(
            kokoro_dialect_for_voice_file("bf_emma.bin"),
            KokoroEnglishDialect::British
        );
    }

    #[test]
    fn splits_long_kokoro_text_for_model_at_readable_boundaries() {
        let chunks = super::split_kokoro_text_for_model(
            "The Industrial Revolution and its consequences have been a disaster for the human race. \
             They have greatly increased the life expectancy of those of us who live in advanced countries, \
             but they have destabilized society, have made life unfulfilling, and have subjected human beings \
             to indignities that should still be narrated without blowing up the model input.",
        );

        assert!(chunks.len() > 1);
        assert!(chunks.iter().all(|chunk| !chunk.trim().is_empty()));
        assert_eq!(
            chunks.join(" "),
            "The Industrial Revolution and its consequences have been a disaster for the human race. \
             They have greatly increased the life expectancy of those of us who live in advanced countries, \
             but they have destabilized society, have made life unfulfilling, and have subjected human beings \
             to indignities that should still be narrated without blowing up the model input."
        );
    }

    #[test]
    fn splits_stubborn_text_roughly_in_half() {
        let (left, right) =
            super::split_text_roughly_in_half("alpha beta gamma delta epsilon zeta")
                .expect("text should split");

        assert_eq!(
            format!("{left} {right}"),
            "alpha beta gamma delta epsilon zeta"
        );
        assert!(!left.is_empty());
        assert!(!right.is_empty());
    }

    #[test]
    #[ignore = "runs real Kokoro G2P and ONNX rendering against local spike assets"]
    fn renders_real_kokoro_manifest_from_local_spike_assets() {
        let root = std::env::var("SONELLE_KOKORO_FIXTURE_ROOT")
            .map(PathBuf::from)
            .unwrap_or_else(|_| {
                [
                    PathBuf::from(".sonelle/narration-spike"),
                    PathBuf::from("../../.sonelle/narration-spike"),
                    PathBuf::from("../../../.sonelle/narration-spike"),
                ]
                .into_iter()
                .find(|candidate| candidate.join("kokoro-onnx/kokoro.onnx").is_file())
                .expect("local Kokoro fixture should exist")
            });
        let rendered =
            render_kokoro_manifest(&root, &request()).expect("real Kokoro manifest should render");

        assert_eq!(rendered.sample_rate, 24_000);
        assert!(rendered.sample_count > 1_000);
        assert_eq!(rendered.sentences.len(), 1);
        assert_eq!(rendered.sentences[0].start_sample, 0);
        assert_eq!(rendered.sentences[0].end_sample, rendered.sample_count);
        assert_eq!(&rendered.wav[..4], b"RIFF");
    }

    fn request() -> ManifestNarrationRequest {
        ManifestNarrationRequest {
            request_id: "request-1".to_string(),
            passage: ManifestNarrationPassage {
                id: "passage-1".to_string(),
                book_id: "book-1".to_string(),
                chapter_id: "chapter-1".to_string(),
                paragraph_id: "paragraph-1".to_string(),
                language: Some("en".to_string()),
                sentences: vec![ManifestNarrationSentence {
                    id: "sentence-1".to_string(),
                    index: 0,
                    text: "Kaczynski described the trade-offs in emphatic terms.".to_string(),
                }],
            },
            engine_id: "kokoro".to_string(),
            model_revision: "kokoro-test".to_string(),
            voice_id: "kokoro:af-heart".to_string(),
            source_text_digest: "digest".to_string(),
            synthesis_parameters: BTreeMap::new(),
        }
    }
}
