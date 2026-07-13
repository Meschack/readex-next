use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::narration_pack::{
    install_narration_pack, installed_pack_is_ready, NarrationPack, NarrationPackArtifact,
    NarrationPackDownloadClient,
};

const ENGINE_CATALOG: &str = include_str!("../../../../tools/narration-spike/engines.json");
const ENGINE_INSTALLATION_PROGRESS_EVENT: &str = "narration-engine-installation-progress";

static ENGINE_INSTALLATION_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NarrationEngineInstallationStatus {
    pub engine_id: String,
    pub status: &'static str,
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
}

struct NativeEngineDownloadClient;

impl NarrationPackDownloadClient for NativeEngineDownloadClient {
    fn stream(
        &self,
        url: &str,
        on_chunk: &mut dyn FnMut(&[u8]) -> Result<(), String>,
    ) -> Result<(), String> {
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
}

pub fn engine_status(
    app: &AppHandle,
    engine_id: &str,
) -> Result<NarrationEngineInstallationStatus, String> {
    let root = engine_pack_root(app)?;
    engine_status_at(&root, engine_id)
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
    let destination = pack_destination(root, &pack);
    let ready = installed_pack_is_ready(&destination, &pack);

    Ok(NarrationEngineInstallationStatus {
        engine_id: engine_id.to_string(),
        status: if ready { "ready" } else { "not-installed" },
        download_size_bytes: if ready { 0 } else { pack_size_bytes(&pack) },
        message: if ready {
            "Ready to listen offline.".to_string()
        } else {
            "Download narration files to listen offline.".to_string()
        },
    })
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
    let catalog: EngineCatalog = serde_json::from_str(ENGINE_CATALOG)
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
                url: format!(
                    "https://huggingface.co/{}/resolve/{}/{}",
                    entry.model.repository, entry.model.revision, artifact.remote_path
                ),
                sha256: artifact.sha256,
                size_bytes: artifact.size_bytes,
            })
            .collect(),
    })
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
    use super::{engine_pack, engine_status_at};
    use std::{
        fs,
        path::PathBuf,
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
    fn reports_engine_status_from_installed_pack_records() {
        let root = test_root("engine-status");
        let missing = engine_status_at(&root, "kokoro").expect("status should load");

        assert_eq!(missing.status, "not-installed");
        assert!(missing.download_size_bytes > 300_000_000);
    }

    #[test]
    fn rejects_unknown_engines() {
        let error = engine_status_at(&test_root("engine-missing"), "piper")
            .expect_err("piper is not a hybrid engine pack");

        assert_eq!(error, "Narration engine is not available yet.");
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
