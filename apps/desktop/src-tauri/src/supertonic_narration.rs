use std::path::Path;

use crate::narration_cache::NarrationSentenceSpan;
use crate::narration_manifest::{ManifestNarrationRequest, ManifestNarrationSentence};
use crate::narration_rendered_audio::RenderedManifestAudio;
use crate::narration_wav::float_wav;
use crate::supertonic_helper;

pub fn render_supertonic_manifest(
    engine_installation_path: &Path,
    request: &ManifestNarrationRequest,
) -> Result<RenderedManifestAudio, String> {
    let assets = engine_installation_path.join("assets");
    let onnx_dir = assets.join("onnx");
    let style_path = assets
        .join("voice_styles")
        .join(supertonic_voice_style_file(&request.voice_id));
    let style_path = style_path
        .to_str()
        .ok_or_else(|| "Sonelle couldn't open offline narration files.".to_string())?
        .to_string();
    let language = supertonic_language(request.passage.language.as_deref());
    let mut tts = supertonic_helper::load_text_to_speech(
        onnx_dir
            .to_str()
            .ok_or_else(|| "Sonelle couldn't open offline narration files.".to_string())?,
        false,
    )
    .map_err(|_| "Sonelle couldn't start offline narration.".to_string())?;
    let style = supertonic_helper::load_voice_style(&[style_path], false)
        .map_err(|_| "Sonelle couldn't open the selected narration voice.".to_string())?;
    let mut sentence_audio = Vec::with_capacity(request.passage.sentences.len());

    for sentence in &request.passage.sentences {
        let (audio, _duration) = tts
            .call(sentence.text.trim(), &language, &style, 8, 1.05, 0.3)
            .map_err(|_| "Sonelle couldn't prepare this narration.".to_string())?;
        sentence_audio.push(audio);
    }

    render_sentence_audio_to_manifest(
        &request.passage.sentences,
        tts.sample_rate as u32,
        sentence_audio,
    )
}

pub fn render_sentence_audio_to_manifest(
    sentences: &[ManifestNarrationSentence],
    sample_rate: u32,
    sentence_audio: Vec<Vec<f32>>,
) -> Result<RenderedManifestAudio, String> {
    if sentences.len() != sentence_audio.len() {
        return Err("Prepared narration did not match the requested sentences.".to_string());
    }

    let mut start_sample = 0_u64;
    let mut spans = Vec::with_capacity(sentences.len());
    let mut audio = Vec::new();
    for (sentence, samples) in sentences.iter().zip(sentence_audio) {
        let sample_count = samples.len() as u64;
        let end_sample = start_sample
            .checked_add(sample_count)
            .ok_or_else(|| "Prepared narration audio is too large.".to_string())?;
        spans.push(NarrationSentenceSpan {
            sentence_id: sentence.id.clone(),
            start_sample,
            end_sample,
        });
        audio.extend(samples);
        start_sample = end_sample;
    }

    Ok(RenderedManifestAudio {
        sample_rate,
        sample_count: start_sample,
        sentences: spans,
        wav: float_wav(sample_rate, &audio)?,
    })
}

fn supertonic_voice_style_file(voice_id: &str) -> &'static str {
    if voice_id.to_ascii_lowercase().contains("m1") {
        "M1.json"
    } else {
        "F1.json"
    }
}

fn supertonic_language(language: Option<&str>) -> String {
    let normalized = language
        .and_then(|value| value.split(['-', '_']).next())
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| supertonic_helper::is_valid_lang(value));

    normalized.unwrap_or_else(|| "na".to_string())
}

#[cfg(test)]
mod tests {
    use std::{collections::BTreeMap, path::PathBuf};

    use super::{render_sentence_audio_to_manifest, render_supertonic_manifest};
    use crate::narration_manifest::{
        ManifestNarrationPassage, ManifestNarrationRequest, ManifestNarrationSentence,
    };

    #[test]
    fn renders_sentence_spans_from_synthesized_audio() {
        let rendered = render_sentence_audio_to_manifest(
            &[
                sentence("sentence-1", 0, "Bonjour."),
                sentence("sentence-2", 1, "Nous continuons."),
            ],
            44_100,
            vec![vec![0.1; 3], vec![-0.2; 5]],
        )
        .expect("manifest audio should render");

        assert_eq!(rendered.sample_rate, 44_100);
        assert_eq!(rendered.sample_count, 8);
        assert_eq!(rendered.sentences[0].start_sample, 0);
        assert_eq!(rendered.sentences[0].end_sample, 3);
        assert_eq!(rendered.sentences[1].start_sample, 3);
        assert_eq!(rendered.sentences[1].end_sample, 8);
        assert_eq!(&rendered.wav[..4], b"RIFF");
    }

    #[test]
    fn rejects_mismatched_sentence_audio() {
        let error = render_sentence_audio_to_manifest(
            &[sentence("sentence-1", 0, "Bonjour.")],
            44_100,
            vec![],
        )
        .expect_err("missing audio should fail");

        assert_eq!(
            error,
            "Prepared narration did not match the requested sentences."
        );
    }

    #[test]
    #[ignore = "runs the real Supertonic ONNX runtime against local spike assets"]
    fn renders_real_supertonic_audio_from_local_assets() {
        let root = std::env::var("SONELLE_SUPERTONIC_FIXTURE_ROOT")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("../../.sonelle/narration-spike/sources/supertonic"));
        let rendered = render_supertonic_manifest(&root, &request())
            .expect("real Supertonic synthesis should render");

        assert_eq!(rendered.sample_rate, 44_100);
        assert!(rendered.sample_count > 1_000);
        assert_eq!(rendered.sentences.len(), 1);
        assert_eq!(&rendered.wav[..4], b"RIFF");
    }

    fn sentence(id: &str, index: i64, text: &str) -> ManifestNarrationSentence {
        ManifestNarrationSentence {
            id: id.to_string(),
            index,
            text: text.to_string(),
        }
    }

    fn request() -> ManifestNarrationRequest {
        ManifestNarrationRequest {
            request_id: "request-1".to_string(),
            passage: ManifestNarrationPassage {
                id: "passage-1".to_string(),
                book_id: "book-1".to_string(),
                chapter_id: "chapter-1".to_string(),
                paragraph_id: "paragraph-1".to_string(),
                language: Some("fr".to_string()),
                sentences: vec![sentence(
                    "sentence-1",
                    0,
                    "La lecture attentive révèle ce que la première impression avait caché.",
                )],
            },
            engine_id: "supertonic".to_string(),
            model_revision: "supertonic-test".to_string(),
            voice_id: "supertonic:F1".to_string(),
            source_text_digest: "digest".to_string(),
            synthesis_parameters: BTreeMap::new(),
        }
    }
}
