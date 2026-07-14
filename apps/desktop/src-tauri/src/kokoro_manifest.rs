use std::path::{Path, PathBuf};

use crate::kokoro_narration::{
    prepare_kokoro_passage_from_sentence_phonemes, project_kokoro_sentence_spans,
    render_kokoro_prepared_input, KOKORO_SAMPLE_RATE,
};
use crate::kokoro_text::{
    phonemize_kokoro_english_sentences, KokoroEnglishDialect, KokoroTextSentence,
};
use crate::narration_manifest::ManifestNarrationRequest;
use crate::narration_rendered_audio::RenderedManifestAudio;
use crate::narration_wav::float_wav;

pub fn render_kokoro_manifest(
    engine_installation_path: &Path,
    request: &ManifestNarrationRequest,
) -> Result<RenderedManifestAudio, String> {
    let voice_file = kokoro_voice_file(&request.voice_id);
    let dialect = kokoro_dialect_for_voice_file(&voice_file);
    let sentences = request
        .passage
        .sentences
        .iter()
        .map(|sentence| KokoroTextSentence {
            sentence_id: sentence.id.clone(),
            text: sentence.text.clone(),
        })
        .collect::<Vec<_>>();
    let sentence_phonemes = phonemize_kokoro_english_sentences(&sentences, dialect)?;
    let config_path = first_existing_path(
        engine_installation_path,
        &[
            "assets/config.json",
            "checkpoints/config.json",
            "config.json",
            "sources/kokoro/checkpoints/config.json",
        ],
    )?;
    let voice_path = first_existing_path(
        engine_installation_path,
        &[
            &format!("assets/voices/{voice_file}"),
            &format!("voices/{voice_file}"),
            &format!("checkpoints/voices/{voice_file}"),
            &format!("sources/kokoro/kokoro.js/voices/{voice_file}"),
        ],
    )?;
    let model_path = first_existing_path(
        engine_installation_path,
        &[
            "assets/kokoro.onnx",
            "kokoro.onnx",
            "assets/onnx/kokoro.onnx",
            "kokoro-onnx/kokoro.onnx",
        ],
    )?;
    let prepared = prepare_kokoro_passage_from_sentence_phonemes(
        &config_path,
        &voice_path,
        &sentence_phonemes,
        1,
    )?;
    let rendered = render_kokoro_prepared_input(&model_path, &prepared.input)?;
    let sample_count = u64::try_from(rendered.samples.len())
        .map_err(|_| "Prepared narration audio is too large.".to_string())?;
    let sentences = project_kokoro_sentence_spans(&prepared, sample_count, &rendered.durations)?;

    Ok(RenderedManifestAudio {
        sample_rate: KOKORO_SAMPLE_RATE,
        sample_count,
        sentences,
        wav: float_wav(KOKORO_SAMPLE_RATE, &rendered.samples)?,
    })
}

fn first_existing_path(root: &Path, relative_paths: &[&str]) -> Result<PathBuf, String> {
    relative_paths
        .iter()
        .map(|relative| root.join(relative))
        .find(|path| path.is_file())
        .ok_or_else(|| "Sonelle couldn't open English narration files.".to_string())
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
                    text: "Sonelle keeps narration aligned with the text.".to_string(),
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
