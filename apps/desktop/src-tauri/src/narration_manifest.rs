use std::{collections::BTreeMap, path::PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

use crate::narration_cache::{
    NarrationAssetCache, NarrationSentenceSpan, PreparedNarrationManifest,
};

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ManifestNarrationRequest {
    pub request_id: String,
    pub passage: ManifestNarrationPassage,
    pub engine_id: String,
    pub model_revision: String,
    pub voice_id: String,
    pub source_text_digest: String,
    #[serde(default)]
    pub synthesis_parameters: BTreeMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ManifestNarrationPassage {
    pub id: String,
    pub book_id: String,
    pub chapter_id: String,
    pub paragraph_id: String,
    pub language: Option<String>,
    pub sentences: Vec<ManifestNarrationSentence>,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ManifestNarrationSentence {
    pub id: String,
    pub index: i64,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PreparedManifestNarration {
    pub asset_id: String,
    pub source_url: String,
    pub sample_rate: u32,
    pub sample_count: u64,
    pub sentences: Vec<NarrationSentenceSpan>,
    pub cached: bool,
    pub engine_id: String,
    pub model_revision: String,
    pub voice_id: String,
    pub source_text_digest: String,
}

pub fn prepare_manifest_narration(
    app: &AppHandle,
    request: ManifestNarrationRequest,
) -> Result<PreparedManifestNarration, String> {
    let root = app
        .path()
        .app_data_dir()
        .map(|dir| dir.join("narration-v3"))
        .map_err(|_| "We couldn't open prepared audio.".to_string())?;

    prepare_manifest_narration_at(root, request)
}

pub fn prepare_manifest_narration_at(
    root: PathBuf,
    request: ManifestNarrationRequest,
) -> Result<PreparedManifestNarration, String> {
    validate_request(&request)?;

    let asset_id = create_asset_id(&request);
    let cache = NarrationAssetCache::open(root);
    if let Some(asset) = cache.get(&asset_id)? {
        return Ok(prepared_response(asset.manifest, true));
    }

    let sample_rate = sample_rate_for_engine(&request.engine_id);
    let sentences = create_sentence_spans(&request.passage.sentences, sample_rate);
    let sample_count = sentences.last().map(|span| span.end_sample).unwrap_or(0);
    let manifest = PreparedNarrationManifest {
        asset_id,
        source_url: String::new(),
        sample_rate,
        sample_count,
        sentences,
        engine_id: request.engine_id,
        model_revision: request.model_revision,
        voice_id: request.voice_id,
        source_text_digest: request.source_text_digest,
    };
    let audio = silent_wav(sample_rate, sample_count)?;
    let asset = cache.put(&manifest, &audio)?;

    Ok(prepared_response(asset.manifest, false))
}

fn validate_request(request: &ManifestNarrationRequest) -> Result<(), String> {
    if !matches!(request.engine_id.as_str(), "kokoro" | "supertonic") {
        return Err("Prepared narration engine is not available yet.".to_string());
    }
    if request.passage.sentences.is_empty() {
        return Err("Prepared narration needs at least one sentence.".to_string());
    }
    if request.model_revision.trim().is_empty()
        || request.voice_id.trim().is_empty()
        || request.source_text_digest.trim().is_empty()
    {
        return Err("Prepared narration metadata is incomplete.".to_string());
    }

    Ok(())
}

fn prepared_response(
    manifest: PreparedNarrationManifest,
    cached: bool,
) -> PreparedManifestNarration {
    PreparedManifestNarration {
        asset_id: manifest.asset_id,
        source_url: manifest.source_url,
        sample_rate: manifest.sample_rate,
        sample_count: manifest.sample_count,
        sentences: manifest.sentences,
        cached,
        engine_id: manifest.engine_id,
        model_revision: manifest.model_revision,
        voice_id: manifest.voice_id,
        source_text_digest: manifest.source_text_digest,
    }
}

fn create_asset_id(request: &ManifestNarrationRequest) -> String {
    let mut hasher = Sha256::new();
    hasher.update(request.engine_id.as_bytes());
    hasher.update(b"\0");
    hasher.update(request.model_revision.as_bytes());
    hasher.update(b"\0");
    hasher.update(request.voice_id.as_bytes());
    hasher.update(b"\0");
    hasher.update(request.source_text_digest.as_bytes());
    hasher.update(b"\0");
    hasher.update(request.passage.id.as_bytes());
    hasher.update(b"\0");
    for sentence in &request.passage.sentences {
        hasher.update(sentence.id.as_bytes());
        hasher.update(b"\0");
        hasher.update(sentence.text.as_bytes());
        hasher.update(b"\0");
    }
    for (key, value) in &request.synthesis_parameters {
        hasher.update(key.as_bytes());
        hasher.update(b"=");
        hasher.update(value.to_string().as_bytes());
        hasher.update(b"\0");
    }

    format!(
        "{}-{}",
        request.engine_id,
        hex_digest(hasher.finalize().as_slice())
    )
}

fn hex_digest(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn sample_rate_for_engine(engine_id: &str) -> u32 {
    match engine_id {
        "supertonic" => 44_100,
        _ => 24_000,
    }
}

fn create_sentence_spans(
    sentences: &[ManifestNarrationSentence],
    sample_rate: u32,
) -> Vec<NarrationSentenceSpan> {
    let mut start_sample = 0;
    sentences
        .iter()
        .map(|sentence| {
            let word_count = sentence.text.split_whitespace().count() as u64;
            let sample_count =
                u64::from(sample_rate / 2).max(word_count * u64::from(sample_rate / 4));
            let span = NarrationSentenceSpan {
                sentence_id: sentence.id.clone(),
                start_sample,
                end_sample: start_sample + sample_count,
            };
            start_sample = span.end_sample;
            span
        })
        .collect()
}

fn silent_wav(sample_rate: u32, sample_count: u64) -> Result<Vec<u8>, String> {
    let data_bytes = sample_count
        .checked_mul(2)
        .ok_or_else(|| "Prepared narration audio is too large.".to_string())?;
    let riff_size = 36_u64
        .checked_add(data_bytes)
        .ok_or_else(|| "Prepared narration audio is too large.".to_string())?;
    if riff_size > u64::from(u32::MAX) || data_bytes > u64::from(u32::MAX) {
        return Err("Prepared narration audio is too large.".to_string());
    }

    let mut wav = Vec::with_capacity(44 + data_bytes as usize);
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(riff_size as u32).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16_u32.to_le_bytes());
    wav.extend_from_slice(&1_u16.to_le_bytes());
    wav.extend_from_slice(&1_u16.to_le_bytes());
    wav.extend_from_slice(&sample_rate.to_le_bytes());
    wav.extend_from_slice(&(sample_rate * 2).to_le_bytes());
    wav.extend_from_slice(&2_u16.to_le_bytes());
    wav.extend_from_slice(&16_u16.to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&(data_bytes as u32).to_le_bytes());
    wav.resize(44 + data_bytes as usize, 0);

    Ok(wav)
}

#[cfg(test)]
mod tests {
    use std::{collections::BTreeMap, fs, path::PathBuf};

    use super::{
        prepare_manifest_narration_at, ManifestNarrationPassage, ManifestNarrationRequest,
        ManifestNarrationSentence,
    };

    #[test]
    fn prepares_and_reuses_cached_manifest_narration() {
        let root = tempfile_root("manifest-reuse");
        let request = request("kokoro");

        let first = prepare_manifest_narration_at(root.clone(), request.clone())
            .expect("manifest narration should prepare");
        let second = prepare_manifest_narration_at(root, request)
            .expect("manifest narration should be reused");

        assert!(!first.cached);
        assert!(second.cached);
        assert_eq!(first.asset_id, second.asset_id);
        assert_eq!(first.sample_rate, 24_000);
        assert_eq!(first.sentences.len(), 2);
        assert!(fs::metadata(first.source_url).is_ok());
    }

    #[test]
    fn separates_engine_outputs() {
        let root = tempfile_root("manifest-engines");
        let kokoro = prepare_manifest_narration_at(root.clone(), request("kokoro"))
            .expect("kokoro narration should prepare");
        let supertonic = prepare_manifest_narration_at(root, request("supertonic"))
            .expect("supertonic narration should prepare");

        assert_ne!(kokoro.asset_id, supertonic.asset_id);
        assert_eq!(supertonic.sample_rate, 44_100);
    }

    #[test]
    fn rejects_unknown_engines() {
        let error =
            prepare_manifest_narration_at(tempfile_root("manifest-invalid"), request("piper"))
                .expect_err("piper manifest command should not be used yet");

        assert_eq!(error, "Prepared narration engine is not available yet.");
    }

    fn request(engine_id: &str) -> ManifestNarrationRequest {
        ManifestNarrationRequest {
            request_id: "request-1".to_string(),
            passage: ManifestNarrationPassage {
                id: "passage-1".to_string(),
                book_id: "book-1".to_string(),
                chapter_id: "chapter-1".to_string(),
                paragraph_id: "paragraph-1".to_string(),
                language: Some("en".to_string()),
                sentences: vec![
                    ManifestNarrationSentence {
                        id: "sentence-1".to_string(),
                        index: 0,
                        text: "This is the first prepared sentence.".to_string(),
                    },
                    ManifestNarrationSentence {
                        id: "sentence-2".to_string(),
                        index: 1,
                        text: "This is the second prepared sentence.".to_string(),
                    },
                ],
            },
            engine_id: engine_id.to_string(),
            model_revision: format!("{engine_id}-test"),
            voice_id: format!("{engine_id}:voice"),
            source_text_digest: "digest".to_string(),
            synthesis_parameters: BTreeMap::new(),
        }
    }

    fn tempfile_root(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "sonelle-{name}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("time should move forward")
                .as_nanos()
        ));
        fs::create_dir_all(&root).expect("temp cache root should exist");
        root
    }
}
