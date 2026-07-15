use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs,
    path::PathBuf,
    sync::{Arc, Mutex, OnceLock},
};

use ort::session::RunOptions;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

use crate::kokoro_manifest::render_kokoro_manifest_with_options;
use crate::narration_cache::{
    NarrationAssetCache, NarrationCacheStats, NarrationSentenceSpan, PreparedNarrationManifest,
};
use crate::narration_engine_pack::{
    engine_installation_path, engine_is_ready, engine_model_revision,
};
use crate::narration_rendered_audio::RenderedManifestAudio;
use crate::supertonic_narration::render_supertonic_manifest_with_options;

static CANCELLED_NARRATIONS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
static ACTIVE_NARRATIONS: OnceLock<Mutex<HashMap<String, Arc<RunOptions>>>> = OnceLock::new();
static MANIFEST_PREPARATION_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

trait NarrationProvider: Sync {
    fn preparation_revision(&self) -> &'static str;

    fn render(
        &self,
        engine_path: &std::path::Path,
        request: &ManifestNarrationRequest,
        run_options: &RunOptions,
    ) -> Result<RenderedManifestAudio, String>;
}

struct KokoroProvider;
struct SupertonicProvider;

impl NarrationProvider for KokoroProvider {
    fn preparation_revision(&self) -> &'static str {
        "kokoro-text-v2"
    }

    fn render(
        &self,
        engine_path: &std::path::Path,
        request: &ManifestNarrationRequest,
        run_options: &RunOptions,
    ) -> Result<RenderedManifestAudio, String> {
        render_kokoro_manifest_with_options(engine_path, request, run_options)
    }
}

impl NarrationProvider for SupertonicProvider {
    fn preparation_revision(&self) -> &'static str {
        "supertonic-text-v2"
    }

    fn render(
        &self,
        engine_path: &std::path::Path,
        request: &ManifestNarrationRequest,
        run_options: &RunOptions,
    ) -> Result<RenderedManifestAudio, String> {
        render_supertonic_manifest_with_options(engine_path, request, run_options)
    }
}

static KOKORO_PROVIDER: KokoroProvider = KokoroProvider;
static SUPERTONIC_PROVIDER: SupertonicProvider = SupertonicProvider;

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
    let cancellation = NarrationCancellation::new(request.request_id.clone())?;
    ensure_narration_not_cancelled(&request.request_id)?;
    let installed_model_revision = engine_model_revision(&request.engine_id)?;
    if request.model_revision != installed_model_revision {
        #[cfg(debug_assertions)]
        eprintln!(
            "[sonelle][native][manifest:revision] engine={} requested={} installed={} error=model-revision-mismatch",
            request.engine_id, request.model_revision, installed_model_revision
        );
        return Err("Narration files changed. Please try again.".to_string());
    }
    log_manifest_request("prepare", &request);
    let root = app
        .path()
        .app_data_dir()
        .map(|dir| dir.join("narration-v3"))
        .map_err(|_| "We couldn't open prepared audio.".to_string())?;
    if let Some(prepared) =
        cached_manifest_narration_at(root.clone(), &request).inspect_err(|error| {
            log_manifest_error("cache", &request, error);
        })?
    {
        ensure_narration_not_cancelled(&request.request_id)?;
        return Ok(prepared);
    }

    let _preparation = MANIFEST_PREPARATION_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "Narration preparation was interrupted.".to_string())?;
    ensure_narration_not_cancelled(&request.request_id)?;
    if let Some(prepared) =
        cached_manifest_narration_at(root.clone(), &request).inspect_err(|error| {
            log_manifest_error("cache", &request, error);
        })?
    {
        return Ok(prepared);
    }

    if !engine_is_ready(app, &request.engine_id)? {
        return Err("Download narration files to listen offline.".to_string());
    }

    let engine_path = engine_installation_path(app, &request.engine_id)?;
    let provider = narration_provider(&request.engine_id)?;
    let rendered_audio = Some(
        provider
            .render(&engine_path, &request, cancellation.run_options())
            .inspect_err(|error| {
                log_manifest_error(&format!("{}-render", request.engine_id), &request, error);
            })?,
    );
    ensure_narration_not_cancelled(&request.request_id)?;

    let request_for_cache_log = request.clone();
    prepare_manifest_narration_at(root, request, rendered_audio).inspect_err(|error| {
        log_manifest_error("cache", &request_for_cache_log, error);
    })
}

pub fn cancel_manifest_narration(request_id: String) {
    let Ok(mut cancelled) = CANCELLED_NARRATIONS
        .get_or_init(|| Mutex::new(HashSet::new()))
        .lock()
    else {
        return;
    };
    cancelled.insert(request_id.clone());
    if let Ok(active) = ACTIVE_NARRATIONS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
    {
        if let Some(run_options) = active.get(&request_id) {
            let _ = run_options.terminate();
        }
    }
}

pub fn ensure_narration_not_cancelled(request_id: &str) -> Result<(), String> {
    let cancelled = CANCELLED_NARRATIONS
        .get_or_init(|| Mutex::new(HashSet::new()))
        .lock()
        .map_err(|_| "Narration preparation was interrupted.".to_string())?;
    if cancelled.contains(request_id) {
        return Err("Narration preparation was cancelled.".to_string());
    }
    Ok(())
}

struct NarrationCancellation {
    request_id: String,
    run_options: Arc<RunOptions>,
}

impl NarrationCancellation {
    fn new(request_id: String) -> Result<Self, String> {
        let run_options = Arc::new(
            RunOptions::new()
                .map_err(|_| "Sonelle couldn't start narration preparation.".to_string())?,
        );
        let cancelled = CANCELLED_NARRATIONS
            .get_or_init(|| Mutex::new(HashSet::new()))
            .lock()
            .map_err(|_| "Narration preparation was interrupted.".to_string())?;
        let mut active = ACTIVE_NARRATIONS
            .get_or_init(|| Mutex::new(HashMap::new()))
            .lock()
            .map_err(|_| "Narration preparation was interrupted.".to_string())?;
        if cancelled.contains(&request_id) {
            let _ = run_options.terminate();
        }
        active.insert(request_id.clone(), Arc::clone(&run_options));
        drop(active);
        drop(cancelled);
        Ok(Self {
            request_id,
            run_options,
        })
    }

    fn run_options(&self) -> &RunOptions {
        &self.run_options
    }
}

impl Drop for NarrationCancellation {
    fn drop(&mut self) {
        let Ok(mut cancelled) = CANCELLED_NARRATIONS
            .get_or_init(|| Mutex::new(HashSet::new()))
            .lock()
        else {
            return;
        };
        if let Ok(mut active) = ACTIVE_NARRATIONS
            .get_or_init(|| Mutex::new(HashMap::new()))
            .lock()
        {
            active.remove(&self.request_id);
        }
        cancelled.remove(&self.request_id);
    }
}

fn narration_provider(engine_id: &str) -> Result<&'static dyn NarrationProvider, String> {
    match engine_id {
        "kokoro" => Ok(&KOKORO_PROVIDER),
        "supertonic" => Ok(&SUPERTONIC_PROVIDER),
        _ => Err("Prepared narration engine is not available yet.".to_string()),
    }
}

pub fn manifest_cache_summary(
    app: &AppHandle,
    book_id: &str,
) -> Result<NarrationCacheStats, String> {
    NarrationAssetCache::open(manifest_cache_root(app)?).book_stats(book_id)
}

pub fn clear_manifest_cache(app: &AppHandle, book_id: &str) -> Result<NarrationCacheStats, String> {
    NarrationAssetCache::open(manifest_cache_root(app)?).clear_book(book_id)
}

fn manifest_cache_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("narration-v3"))
        .map_err(|_| "We couldn't open prepared audio.".to_string())
}

fn cached_manifest_narration_at(
    root: PathBuf,
    request: &ManifestNarrationRequest,
) -> Result<Option<PreparedManifestNarration>, String> {
    validate_request(request)?;

    let asset_id = create_asset_id(request)?;
    let cache = NarrationAssetCache::open(root);
    Ok(cache
        .get(&asset_id)?
        .map(|asset| prepared_response(asset.manifest, true)))
}

pub fn prepare_manifest_narration_at(
    root: PathBuf,
    request: ManifestNarrationRequest,
    rendered_audio: Option<RenderedManifestAudio>,
) -> Result<PreparedManifestNarration, String> {
    validate_request(&request)?;

    let asset_id = create_asset_id(&request)?;
    let cache = NarrationAssetCache::open(root);
    if let Some(mut asset) = cache.get(&asset_id)? {
        if asset.manifest.book_id.is_empty() {
            asset.manifest.book_id = request.passage.book_id.clone();
            asset.manifest.chapter_id = request.passage.chapter_id.clone();
            let audio = fs::read(&asset.audio_path)
                .map_err(|_| "We couldn't refresh prepared audio.".to_string())?;
            asset = cache.put(&asset.manifest, &audio)?;
        }
        return Ok(prepared_response(asset.manifest, true));
    }

    let rendered_audio = match rendered_audio {
        Some(audio) => audio,
        None => return Err("Prepared narration audio is not ready yet.".to_string()),
    };
    let manifest = PreparedNarrationManifest {
        asset_id,
        book_id: request.passage.book_id,
        chapter_id: request.passage.chapter_id,
        source_url: String::new(),
        sample_rate: rendered_audio.sample_rate,
        sample_count: rendered_audio.sample_count,
        sentences: rendered_audio.sentences,
        engine_id: request.engine_id,
        model_revision: request.model_revision,
        voice_id: request.voice_id,
        source_text_digest: request.source_text_digest,
    };
    let asset = cache.put(&manifest, &rendered_audio.wav)?;

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

fn create_asset_id(request: &ManifestNarrationRequest) -> Result<String, String> {
    let provider = narration_provider(&request.engine_id)?;
    Ok(create_asset_id_for_revision(
        request,
        provider.preparation_revision(),
    ))
}

fn create_asset_id_for_revision(
    request: &ManifestNarrationRequest,
    preparation_revision: &str,
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(request.engine_id.as_bytes());
    hasher.update(b"\0");
    hasher.update(preparation_revision.as_bytes());
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

fn log_manifest_request(stage: &str, request: &ManifestNarrationRequest) {
    #[cfg(debug_assertions)]
    eprintln!(
        "[sonelle][native][manifest:{stage}] engine={} voice={} passage={} sentences={} chars={}",
        request.engine_id,
        request.voice_id,
        request.passage.id,
        request.passage.sentences.len(),
        request
            .passage
            .sentences
            .iter()
            .map(|sentence| sentence.text.chars().count())
            .sum::<usize>()
    );
}

fn log_manifest_error(stage: &str, request: &ManifestNarrationRequest, error: &str) {
    #[cfg(debug_assertions)]
    eprintln!(
        "[sonelle][native][manifest:{stage}] engine={} voice={} passage={} error={}",
        request.engine_id, request.voice_id, request.passage.id, error
    );
}

#[cfg(test)]
mod tests {
    use std::{collections::BTreeMap, fs, path::PathBuf};

    use super::{
        create_asset_id_for_revision, prepare_manifest_narration_at, ManifestNarrationPassage,
        ManifestNarrationRequest, ManifestNarrationSentence,
    };
    use crate::supertonic_narration::render_sentence_audio_to_manifest;

    #[test]
    fn prepares_and_reuses_cached_manifest_narration() {
        let root = tempfile_root("manifest-reuse");
        let request = request("supertonic");
        let rendered = render_sentence_audio_to_manifest(
            &request.passage.sentences,
            44_100,
            vec![vec![0.25; 4], vec![-0.25; 6]],
        )
        .expect("rendered audio should be valid");

        let first = prepare_manifest_narration_at(root.clone(), request.clone(), Some(rendered))
            .expect("manifest narration should prepare");
        let second = prepare_manifest_narration_at(root, request, None)
            .expect("manifest narration should be reused");

        assert!(!first.cached);
        assert!(second.cached);
        assert_eq!(first.asset_id, second.asset_id);
        assert_eq!(first.sample_rate, 44_100);
        assert_eq!(first.sentences.len(), 2);
        assert!(fs::metadata(first.source_url).is_ok());
    }

    #[test]
    fn separates_prepared_audio_when_provider_text_rules_change() {
        let request = request("kokoro");

        assert_ne!(
            create_asset_id_for_revision(&request, "kokoro-text-v1"),
            create_asset_id_for_revision(&request, "kokoro-text-v2")
        );
    }

    #[test]
    fn rejects_kokoro_without_a_native_rendered_manifest() {
        let error = prepare_manifest_narration_at(
            tempfile_root("manifest-kokoro-pending"),
            request("kokoro"),
            None,
        )
        .expect_err("kokoro should not use placeholder audio");

        assert_eq!(error, "Prepared narration audio is not ready yet.");
    }

    #[test]
    fn reuses_cached_kokoro_manifest_without_rendering_again() {
        let root = tempfile_root("manifest-kokoro-reuse");
        let request = request("kokoro");
        let rendered = render_sentence_audio_to_manifest(
            &request.passage.sentences,
            24_000,
            vec![vec![0.25; 4], vec![-0.25; 6]],
        )
        .expect("rendered audio should be valid");

        let first = prepare_manifest_narration_at(root.clone(), request.clone(), Some(rendered))
            .expect("kokoro narration should prepare once");
        let second = prepare_manifest_narration_at(root, request, None)
            .expect("kokoro narration should be reused from cache");

        assert!(!first.cached);
        assert!(second.cached);
        assert_eq!(first.asset_id, second.asset_id);
        assert_eq!(first.source_url, second.source_url);
    }

    #[test]
    fn stores_rendered_supertonic_audio() {
        let root = tempfile_root("manifest-rendered");
        let request = request("supertonic");
        let rendered = render_sentence_audio_to_manifest(
            &request.passage.sentences,
            44_100,
            vec![vec![0.25; 4], vec![-0.25; 6]],
        )
        .expect("rendered audio should be valid");

        let prepared = prepare_manifest_narration_at(root, request, Some(rendered))
            .expect("rendered narration should prepare");

        assert_eq!(prepared.sample_rate, 44_100);
        assert_eq!(prepared.sample_count, 10);
        assert_eq!(prepared.sentences[0].start_sample, 0);
        assert_eq!(prepared.sentences[0].end_sample, 4);
        assert_eq!(prepared.sentences[1].start_sample, 4);
        assert_eq!(prepared.sentences[1].end_sample, 10);
        assert!(fs::metadata(prepared.source_url).is_ok());
    }

    #[test]
    fn rejects_unknown_engines() {
        let error = prepare_manifest_narration_at(
            tempfile_root("manifest-invalid"),
            request("piper"),
            None,
        )
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
