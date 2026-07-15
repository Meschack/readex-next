use std::{
    fs,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::narration_pack::{
    adopt_compatible_installed_pack, install_narration_pack, NarrationPack, NarrationPackArtifact,
    NarrationPackDownloadClient, NarrationPackDownloadError,
};

const ENGINE_CATALOG: &str = include_str!("../../../../tools/narration-spike/engines.json");
const ENGINE_INSTALLATION_PROGRESS_EVENT: &str = "narration-engine-installation-progress";

static ENGINE_INSTALLATION_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NarrationEngineInstallationStatus {
    pub engine_id: String,
    pub status: &'static str,
    pub model_revision: String,
    pub download_size_bytes: u64,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct NarrationEngineInstallationProgress {
    engine_id: String,
    status: &'static str,
    progress: Option<u8>,
    downloaded_bytes: u64,
    total_bytes: u64,
    message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EngineCatalog {
    engines: Vec<EngineCatalogEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EngineCatalogEntry {
    id: String,
    model: EngineModelCatalogEntry,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EngineModelCatalogEntry {
    repository: String,
    revision: String,
    artifacts: Vec<EngineArtifactCatalogEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EngineArtifactCatalogEntry {
    remote_path: String,
    target_path: String,
    size_bytes: u64,
    sha256: String,
    url: Option<String>,
}

struct NativeEngineDownloadClient;

impl NarrationPackDownloadClient for NativeEngineDownloadClient {
    fn stream(
        &self,
        url: &str,
        on_chunk: &mut dyn FnMut(&[u8]) -> Result<(), String>,
    ) -> Result<(), String> {
        if let Some(path) = file_url_path(url) {
            let mut file = fs::File::open(path).map_err(|_| {
                "The narration files couldn't be opened. Check the catalog and retry.".to_string()
            })?;
            let mut buffer = [0_u8; 64 * 1024];

            loop {
                let count = file.read(&mut buffer).map_err(|_| {
                    "The narration file read was interrupted. Please retry.".to_string()
                })?;
                if count == 0 {
                    return Ok(());
                }
                on_chunk(&buffer[..count])?;
            }
        }

        let mut response = ureq::get(url)
            .header("User-Agent", "Sonelle narration engine installer")
            .call()
            .map_err(|_| {
                "The narration files couldn't be downloaded. Check your connection and retry."
                    .to_string()
            })?;
        let mut reader = response.body_mut().as_reader();
        let mut buffer = [0_u8; 64 * 1024];

        loop {
            let count = reader
                .read(&mut buffer)
                .map_err(|_| "The narration download was interrupted. Please retry.".to_string())?;
            if count == 0 {
                return Ok(());
            }
            on_chunk(&buffer[..count])?;
        }
    }

    fn stream_range(
        &self,
        url: &str,
        start_byte: u64,
        on_chunk: &mut dyn FnMut(&[u8]) -> Result<(), String>,
    ) -> Result<(), NarrationPackDownloadError> {
        if let Some(path) = file_url_path(url) {
            let mut file = fs::File::open(path).map_err(|_| {
                NarrationPackDownloadError::Failed(
                    "The narration files couldn't be opened. Check the catalog and retry."
                        .to_string(),
                )
            })?;
            file.seek(SeekFrom::Start(start_byte)).map_err(|_| {
                NarrationPackDownloadError::Failed(
                    "The narration file read was interrupted. Please retry.".to_string(),
                )
            })?;
            let mut buffer = [0_u8; 64 * 1024];

            loop {
                let count = file.read(&mut buffer).map_err(|_| {
                    NarrationPackDownloadError::Failed(
                        "The narration file read was interrupted. Please retry.".to_string(),
                    )
                })?;
                if count == 0 {
                    return Ok(());
                }
                on_chunk(&buffer[..count]).map_err(NarrationPackDownloadError::Failed)?;
            }
        }

        let mut response = ureq::get(url)
            .header("User-Agent", "Sonelle narration engine installer")
            .header("Range", format!("bytes={start_byte}-"))
            .call()
            .map_err(|_| {
                NarrationPackDownloadError::Failed(
                    "The narration files couldn't be downloaded. Check your connection and retry."
                        .to_string(),
                )
            })?;
        if response.status().as_u16() != 206 {
            return Err(NarrationPackDownloadError::UnsupportedResume);
        }

        let mut reader = response.body_mut().as_reader();
        let mut buffer = [0_u8; 64 * 1024];
        loop {
            let count = reader.read(&mut buffer).map_err(|_| {
                NarrationPackDownloadError::Failed(
                    "The narration download was interrupted. Please retry.".to_string(),
                )
            })?;
            if count == 0 {
                return Ok(());
            }
            on_chunk(&buffer[..count]).map_err(NarrationPackDownloadError::Failed)?;
        }
    }
}

pub fn engine_status(
    app: &AppHandle,
    engine_id: &str,
) -> Result<NarrationEngineInstallationStatus, String> {
    let root = engine_pack_root(app)?;
    engine_status_at(&root, engine_id)
}

pub fn engine_is_ready(app: &AppHandle, engine_id: &str) -> Result<bool, String> {
    let root = engine_pack_root(app)?;
    engine_is_ready_at(&root, engine_id)
}

pub fn engine_installation_path(app: &AppHandle, engine_id: &str) -> Result<PathBuf, String> {
    let root = engine_pack_root(app)?;
    let pack = engine_pack(engine_id)?;
    Ok(pack_destination(&root, &pack))
}

pub fn install_engine(
    app: &AppHandle,
    engine_id: &str,
) -> Result<NarrationEngineInstallationStatus, String> {
    let root = engine_pack_root(app)?;
    let app = app.clone();
    install_engine_at(
        &root,
        engine_id,
        &NativeEngineDownloadClient,
        &mut |done, total| {
            emit_engine_progress(
                &app,
                engine_id,
                "downloading",
                "Preparing offline narration",
                done,
                total,
            );
        },
    )
}

pub fn engine_status_at(
    root: &Path,
    engine_id: &str,
) -> Result<NarrationEngineInstallationStatus, String> {
    let pack = engine_pack(engine_id)?;
    let ready = adopt_compatible_installed_pack(root, &pack)?;

    Ok(NarrationEngineInstallationStatus {
        engine_id: engine_id.to_string(),
        status: if ready { "ready" } else { "not-installed" },
        model_revision: pack.revision.clone(),
        download_size_bytes: if ready { 0 } else { pack_size_bytes(&pack) },
        message: if ready {
            "Ready to listen offline.".to_string()
        } else {
            "Download narration files to listen offline.".to_string()
        },
    })
}

pub fn engine_model_revision(engine_id: &str) -> Result<String, String> {
    Ok(engine_pack(engine_id)?.revision)
}

fn engine_is_ready_at(root: &Path, engine_id: &str) -> Result<bool, String> {
    let pack = engine_pack(engine_id)?;
    adopt_compatible_installed_pack(root, &pack)
}

fn install_engine_at(
    root: &Path,
    engine_id: &str,
    client: &dyn NarrationPackDownloadClient,
    on_progress: &mut dyn FnMut(u64, u64),
) -> Result<NarrationEngineInstallationStatus, String> {
    let pack = engine_pack(engine_id)?;
    let _guard = ENGINE_INSTALLATION_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "Narration setup is already busy. Please try again.".to_string())?;
    fs::create_dir_all(root)
        .map_err(|_| "Sonelle couldn't prepare offline narration files.".to_string())?;

    let _ = install_narration_pack(root, &pack, client, on_progress)?;
    engine_status_at(root, engine_id)
}

fn engine_pack_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("narration-engines"))
        .map_err(|_| "Sonelle couldn't open its offline narration folder.".to_string())
}

fn engine_pack(engine_id: &str) -> Result<NarrationPack, String> {
    engine_pack_from_catalog_json(engine_id, &engine_catalog_json()?)
}

fn engine_pack_from_catalog_json(
    engine_id: &str,
    catalog_json: &str,
) -> Result<NarrationPack, String> {
    let catalog: EngineCatalog = serde_json::from_str(catalog_json)
        .map_err(|_| "Offline narration catalog is invalid.".to_string())?;
    let entry = catalog
        .engines
        .into_iter()
        .find(|entry| entry.id == engine_id)
        .ok_or_else(|| "Narration engine is not available yet.".to_string())?;

    Ok(NarrationPack {
        id: entry.id,
        revision: entry.model.revision.clone(),
        artifacts: entry
            .model
            .artifacts
            .into_iter()
            .map(|artifact| NarrationPackArtifact {
                id: artifact.target_path.clone(),
                relative_path: PathBuf::from(&artifact.target_path),
                url: artifact.url.unwrap_or_else(|| {
                    format!(
                        "https://huggingface.co/{}/resolve/{}/{}",
                        entry.model.repository, entry.model.revision, artifact.remote_path
                    )
                }),
                sha256: artifact.sha256,
                size_bytes: artifact.size_bytes,
            })
            .collect(),
    })
}

fn engine_catalog_json() -> Result<String, String> {
    match std::env::var("SONELLE_NARRATION_ENGINE_CATALOG") {
        Ok(path) if !path.trim().is_empty() => {
            let path = resolve_catalog_path(Path::new(path.trim())).ok_or_else(|| {
                #[cfg(debug_assertions)]
                eprintln!(
                    "[sonelle][native][narration-catalog:resolve] error=catalog-path-unavailable"
                );
                "Offline narration catalog couldn't be opened. Check the local catalog path and retry."
                    .to_string()
            })?;

            fs::read_to_string(&path).map_err(|error| {
                #[cfg(debug_assertions)]
                eprintln!(
                    "[sonelle][native][narration-catalog:read] error={}",
                    error.to_string().replace(['\r', '\n'], " ")
                );
                "Offline narration catalog couldn't be opened. Check the local catalog path and retry."
                    .to_string()
            })
        }
        _ => Ok(ENGINE_CATALOG.to_string()),
    }
}

fn resolve_catalog_path(path: &Path) -> Option<PathBuf> {
    if path.is_absolute() {
        return path.is_file().then(|| path.to_path_buf());
    }

    let cwd = std::env::current_dir().ok()?;
    for base in cwd.ancestors() {
        let candidate = base.join(path);
        if candidate.is_file() {
            return Some(candidate);
        }
    }

    None
}

fn file_url_path(url: &str) -> Option<PathBuf> {
    let path = url.strip_prefix("file://")?;
    if cfg!(windows) {
        Some(PathBuf::from(path.strip_prefix('/').unwrap_or(path)))
    } else {
        Some(PathBuf::from(path))
    }
}

fn pack_destination(root: &Path, pack: &NarrationPack) -> PathBuf {
    root.join(&pack.id).join(&pack.revision)
}

fn pack_size_bytes(pack: &NarrationPack) -> u64 {
    pack.artifacts
        .iter()
        .map(|artifact| artifact.size_bytes)
        .sum()
}

fn emit_engine_progress(
    app: &AppHandle,
    engine_id: &str,
    status: &'static str,
    message: &str,
    downloaded_bytes: u64,
    total_bytes: u64,
) {
    let progress = (total_bytes > 0)
        .then(|| ((downloaded_bytes.saturating_mul(100) / total_bytes).min(100)) as u8);
    let _ = app.emit(
        ENGINE_INSTALLATION_PROGRESS_EVENT,
        NarrationEngineInstallationProgress {
            engine_id: engine_id.to_string(),
            status,
            progress,
            downloaded_bytes,
            total_bytes,
            message: message.to_string(),
        },
    );
}

#[cfg(test)]
mod tests {
    use super::{
        engine_is_ready_at, engine_pack, engine_status_at, file_url_path, resolve_catalog_path,
        NativeEngineDownloadClient,
    };
    use crate::kokoro_manifest::render_kokoro_manifest;
    use crate::narration_manifest::{
        ManifestNarrationPassage, ManifestNarrationRequest, ManifestNarrationSentence,
    };
    use crate::narration_pack::{
        install_narration_pack, installed_pack_is_ready, NarrationPackDownloadClient,
    };
    use crate::supertonic_narration::render_supertonic_manifest;
    use std::collections::BTreeMap;
    use std::{
        fs,
        path::{Path, PathBuf},
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn builds_pinned_engine_packs_from_the_catalog() {
        let kokoro = engine_pack("kokoro").expect("kokoro pack should exist");
        let supertonic = engine_pack("supertonic").expect("supertonic pack should exist");

        assert_eq!(kokoro.id, "kokoro");
        assert_eq!(kokoro.artifacts.len(), 4);
        assert!(kokoro.artifacts[0]
            .url
            .starts_with("https://huggingface.co/hexgrad/Kokoro-82M/resolve/"));
        assert_eq!(supertonic.id, "supertonic");
        assert_eq!(supertonic.artifacts.len(), 10);
    }

    #[test]
    fn honors_explicit_catalog_artifact_urls() {
        let root = test_root("engine-catalog-override");
        let catalog = root.join("engines.json");
        fs::write(
            &catalog,
            r#"{
              "schemaVersion": 1,
              "engines": [
                {
                  "id": "kokoro",
                  "model": {
                    "repository": "local/sonelle-kokoro",
                    "revision": "0123456789012345678901234567890123456789",
                    "artifacts": [
                      {
                        "remotePath": "ignored.bin",
                        "targetPath": "assets/kokoro.onnx",
                        "sizeBytes": 7,
                        "sha256": "8328d302e64b688068affcad021367dad44992236ca84add38713735f9a9a1f0",
                        "url": "file:///tmp/kokoro.onnx"
                      }
                    ]
                  }
                }
              ]
            }"#,
        )
        .expect("catalog should write");
        let catalog_json = fs::read_to_string(&catalog).expect("catalog should read");
        let pack = super::engine_pack_from_catalog_json("kokoro", &catalog_json)
            .expect("override catalog should load");

        assert_eq!(pack.revision, "0123456789012345678901234567890123456789");
        assert_eq!(
            pack.artifacts[0].relative_path,
            PathBuf::from("assets/kokoro.onnx")
        );
        assert_eq!(pack.artifacts[0].url, "file:///tmp/kokoro.onnx");
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn native_client_streams_local_catalog_files() {
        let root = test_root("engine-file-url");
        let source = root.join("model.onnx");
        fs::write(&source, b"Sonelle").expect("source file");
        let mut contents = Vec::new();
        let client = NativeEngineDownloadClient;

        client
            .stream(
                &format!("file://{}", source.to_string_lossy()),
                &mut |chunk| {
                    contents.extend_from_slice(chunk);
                    Ok(())
                },
            )
            .expect("local file should stream");

        assert_eq!(contents, b"Sonelle");
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn resolves_file_urls_to_paths() {
        assert_eq!(file_url_path("https://example.test/model.onnx"), None);
        assert!(file_url_path("file:///tmp/model.onnx")
            .expect("file URL")
            .ends_with("model.onnx"));
    }

    #[test]
    fn resolves_catalog_paths_from_cwd_ancestors() {
        let root = test_root("catalog-ancestor");
        let nested = root.join("apps/desktop/src-tauri");
        let catalog = root.join(".sonelle/narration-spike/local-engine-catalog.json");
        fs::create_dir_all(&nested).expect("nested dir should write");
        fs::create_dir_all(catalog.parent().expect("catalog parent")).expect("catalog dir");
        fs::write(&catalog, "{}").expect("catalog should write");
        let previous_cwd = std::env::current_dir().expect("cwd should load");

        std::env::set_current_dir(&nested).expect("cwd should switch");
        let resolved = resolve_catalog_path(Path::new(
            ".sonelle/narration-spike/local-engine-catalog.json",
        ))
        .expect("catalog should resolve from an ancestor");
        std::env::set_current_dir(previous_cwd).expect("cwd should restore");

        assert_eq!(resolved, catalog);
        fs::remove_dir_all(root).ok();
    }

    #[test]
    #[ignore = "installs the local Kokoro runtime pack and renders with the real ONNX model"]
    fn installs_local_kokoro_catalog_and_renders_from_the_installed_pack() {
        let catalog = local_engine_catalog();
        let catalog_json = fs::read_to_string(catalog).expect("catalog should read");
        let pack = super::engine_pack_from_catalog_json("kokoro", &catalog_json)
            .expect("Kokoro pack should load");
        let root = test_root("kokoro-local-pack-smoke");
        let mut progress = Vec::new();

        install_narration_pack(
            &root,
            &pack,
            &NativeEngineDownloadClient,
            &mut |done, total| {
                progress.push((done, total));
            },
        )
        .expect("local Kokoro pack should install");
        let destination = root.join(&pack.id).join(&pack.revision);
        assert!(installed_pack_is_ready(&destination, &pack));
        let total_bytes = super::pack_size_bytes(&pack);
        assert_eq!(progress.last(), Some(&(total_bytes, total_bytes)));

        let rendered = render_kokoro_manifest(&destination, &kokoro_request())
            .expect("installed Kokoro pack should render");

        assert_eq!(rendered.sample_rate, 24_000);
        assert!(rendered.sample_count > 1_000);
        assert_eq!(rendered.sentences.len(), 1);
        assert_eq!(&rendered.wav[..4], b"RIFF");
        fs::remove_dir_all(root).ok();
    }

    #[test]
    #[ignore = "installs the local Supertonic runtime pack and renders with the real ONNX models"]
    fn installs_local_supertonic_catalog_and_renders_from_the_installed_pack() {
        let catalog_json = fs::read_to_string(local_engine_catalog()).expect("catalog should read");
        let pack = super::engine_pack_from_catalog_json("supertonic", &catalog_json)
            .expect("Supertonic pack should load");
        let root = test_root("supertonic-local-pack-smoke");
        let mut progress = Vec::new();

        install_narration_pack(
            &root,
            &pack,
            &NativeEngineDownloadClient,
            &mut |done, total| progress.push((done, total)),
        )
        .expect("local Supertonic pack should install");
        let destination = root.join(&pack.id).join(&pack.revision);
        assert!(installed_pack_is_ready(&destination, &pack));
        let total_bytes = super::pack_size_bytes(&pack);
        assert_eq!(progress.last(), Some(&(total_bytes, total_bytes)));

        let rendered = render_supertonic_manifest(&destination, &supertonic_request())
            .expect("installed Supertonic pack should render");

        assert_eq!(rendered.sample_rate, 44_100);
        assert!(rendered.sample_count > 1_000);
        assert_eq!(rendered.sentences.len(), 1);
        assert_eq!(&rendered.wav[..4], b"RIFF");
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn reports_engine_status_from_installed_pack_records() {
        let root = test_root("engine-status");
        let missing = engine_status_at(&root, "kokoro").expect("status should load");

        assert_eq!(missing.status, "not-installed");
        assert!(!missing.model_revision.is_empty());
        assert!(missing.download_size_bytes > 300_000_000);
        assert!(!engine_is_ready_at(&root, "kokoro").expect("readiness should load"));
    }

    #[test]
    fn rejects_unknown_engines() {
        let error = engine_status_at(&test_root("engine-missing"), "piper")
            .expect_err("piper is not a hybrid engine pack");

        assert_eq!(error, "Narration engine is not available yet.");
    }

    fn kokoro_request() -> ManifestNarrationRequest {
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
            model_revision: "kokoro-local".to_string(),
            voice_id: "kokoro:af-heart".to_string(),
            source_text_digest: "digest".to_string(),
            synthesis_parameters: BTreeMap::new(),
        }
    }

    fn supertonic_request() -> ManifestNarrationRequest {
        ManifestNarrationRequest {
            request_id: "request-2".to_string(),
            passage: ManifestNarrationPassage {
                id: "passage-2".to_string(),
                book_id: "book-2".to_string(),
                chapter_id: "chapter-2".to_string(),
                paragraph_id: "paragraph-2".to_string(),
                language: Some("fr".to_string()),
                sentences: vec![ManifestNarrationSentence {
                    id: "sentence-2".to_string(),
                    index: 0,
                    text: "Sonelle garde la narration alignée avec le texte.".to_string(),
                }],
            },
            engine_id: "supertonic".to_string(),
            model_revision: "supertonic-local".to_string(),
            voice_id: "supertonic:F1".to_string(),
            source_text_digest: "digest".to_string(),
            synthesis_parameters: BTreeMap::new(),
        }
    }

    fn local_engine_catalog() -> PathBuf {
        [
            PathBuf::from(".sonelle/narration-spike/local-engine-catalog.json"),
            PathBuf::from("../../.sonelle/narration-spike/local-engine-catalog.json"),
            PathBuf::from("../../../.sonelle/narration-spike/local-engine-catalog.json"),
        ]
        .into_iter()
        .find(|candidate| candidate.is_file())
        .expect("local narration engine catalog should exist")
    }

    fn test_root(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "sonelle-{name}-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("time should move forward")
                .as_nanos()
        ));
        fs::create_dir_all(&root).expect("test root should exist");
        root
    }
}
