use std::{
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Debug, Clone)]
pub struct NarrationPack {
    pub id: String,
    pub revision: String,
    pub artifacts: Vec<NarrationPackArtifact>,
}

#[derive(Debug, Clone)]
pub struct NarrationPackArtifact {
    pub id: String,
    pub relative_path: PathBuf,
    pub url: String,
    pub sha256: String,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NarrationPackInstallStatus {
    Reused,
    Installed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstalledPackRecord {
    pack_id: String,
    revision: String,
    artifacts: Vec<InstalledArtifactRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstalledArtifactRecord {
    id: String,
    relative_path: String,
    sha256: String,
    size_bytes: u64,
}

pub trait NarrationPackDownloadClient {
    fn stream(
        &self,
        url: &str,
        on_chunk: &mut dyn FnMut(&[u8]) -> Result<(), String>,
    ) -> Result<(), String>;

    fn stream_range(
        &self,
        _url: &str,
        _start_byte: u64,
        _on_chunk: &mut dyn FnMut(&[u8]) -> Result<(), String>,
    ) -> Result<(), NarrationPackDownloadError> {
        Err(NarrationPackDownloadError::UnsupportedResume)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NarrationPackDownloadError {
    UnsupportedResume,
    Failed(String),
}

pub fn install_narration_pack(
    root: &Path,
    pack: &NarrationPack,
    client: &dyn NarrationPackDownloadClient,
    on_progress: &mut dyn FnMut(u64, u64),
) -> Result<NarrationPackInstallStatus, String> {
    validate_pack(pack)?;
    let destination = root.join(&pack.id).join(&pack.revision);

    if installed_pack_is_ready(&destination, pack) {
        on_progress(total_pack_bytes(pack), total_pack_bytes(pack));
        return Ok(NarrationPackInstallStatus::Reused);
    }

    let temporary = destination.with_extension("installing");
    fs::create_dir_all(&temporary)
        .map_err(|_| "Sonelle couldn't prepare offline narration files.".to_string())?;

    let total_bytes = total_pack_bytes(pack);
    let mut completed_bytes = 0_u64;
    for artifact in &pack.artifacts {
        let artifact_path = temporary.join(&artifact.relative_path);
        download_pack_artifact(client, artifact, &artifact_path, &mut |active_bytes| {
            on_progress(
                completed_bytes
                    .saturating_add(active_bytes)
                    .min(total_bytes),
                total_bytes,
            );
        })?;
        completed_bytes = completed_bytes
            .saturating_add(artifact.size_bytes)
            .min(total_bytes);
        on_progress(completed_bytes, total_bytes);
    }

    write_pack_record(&temporary, pack)?;
    if destination.exists() {
        fs::remove_dir_all(&destination)
            .map_err(|_| "Sonelle couldn't replace offline narration files.".to_string())?;
    }
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)
            .map_err(|_| "Sonelle couldn't prepare offline narration files.".to_string())?;
    }
    fs::rename(&temporary, &destination)
        .map_err(|_| "Sonelle couldn't finish offline narration setup.".to_string())?;
    on_progress(total_bytes, total_bytes);
    Ok(NarrationPackInstallStatus::Installed)
}

pub fn installed_pack_is_ready(destination: &Path, pack: &NarrationPack) -> bool {
    let Some(record) = read_pack_record(destination) else {
        return false;
    };
    if record.pack_id != pack.id || record.revision != pack.revision {
        return false;
    }

    installed_artifacts_match(destination, &record, pack)
}

pub fn adopt_compatible_installed_pack(root: &Path, pack: &NarrationPack) -> Result<bool, String> {
    let destination = root.join(&pack.id).join(&pack.revision);
    if installed_pack_is_ready(&destination, pack) {
        return Ok(true);
    }

    let pack_root = root.join(&pack.id);
    let candidates = match fs::read_dir(&pack_root) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(_) => return Err("Sonelle couldn't inspect its offline narration files.".to_string()),
    };

    for candidate in candidates.flatten().map(|entry| entry.path()) {
        if candidate == destination || !candidate.is_dir() {
            continue;
        }
        let Some(record) = read_pack_record(&candidate) else {
            continue;
        };
        if record.pack_id != pack.id || !installed_artifacts_match(&candidate, &record, pack) {
            continue;
        }

        if destination.exists() {
            fs::remove_dir_all(&destination)
                .map_err(|_| "Sonelle couldn't replace offline narration files.".to_string())?;
        }
        fs::rename(&candidate, &destination)
            .map_err(|_| "Sonelle couldn't reuse offline narration files.".to_string())?;
        write_pack_record(&destination, pack)?;
        return Ok(true);
    }

    Ok(false)
}

fn installed_artifacts_match(
    destination: &Path,
    record: &InstalledPackRecord,
    pack: &NarrationPack,
) -> bool {
    if record.artifacts.len() != pack.artifacts.len() {
        return false;
    }

    pack.artifacts.iter().all(|artifact| {
        record.artifacts.iter().any(|candidate| {
            candidate.id == artifact.id
                && candidate.relative_path == artifact.relative_path.to_string_lossy()
                && candidate.sha256 == artifact.sha256
                && candidate.size_bytes == artifact.size_bytes
                && file_sha256(&destination.join(&artifact.relative_path)).as_deref()
                    == Some(artifact.sha256.as_str())
        })
    })
}

fn download_pack_artifact(
    client: &dyn NarrationPackDownloadClient,
    artifact: &NarrationPackArtifact,
    destination: &Path,
    on_progress: &mut dyn FnMut(u64),
) -> Result<(), String> {
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)
            .map_err(|_| "Sonelle couldn't save offline narration files.".to_string())?;
    }
    if verified_artifact_is_ready(destination, artifact) {
        on_progress(artifact.size_bytes);
        return Ok(());
    }
    if destination.exists() {
        fs::remove_file(destination)
            .map_err(|_| "Sonelle couldn't replace offline narration files.".to_string())?;
    }

    let temporary = destination.with_extension("download");
    let mut downloaded = temporary
        .metadata()
        .ok()
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    if downloaded > artifact.size_bytes {
        let _ = fs::remove_file(&temporary);
        downloaded = 0;
    }

    let mut hasher = hash_partial_file(&temporary)?;
    on_progress(downloaded);
    let mut output = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&temporary)
        .map_err(|_| "Sonelle couldn't save offline narration files.".to_string())?;

    if downloaded > 0 {
        match stream_artifact_range(
            client,
            artifact,
            &mut output,
            &mut hasher,
            &mut downloaded,
            on_progress,
        ) {
            Ok(()) => {}
            Err(NarrationPackDownloadError::UnsupportedResume) => {
                drop(output);
                let _ = fs::remove_file(&temporary);
                hasher = Sha256::new();
                downloaded = 0;
                output = File::create(&temporary)
                    .map_err(|_| "Sonelle couldn't save offline narration files.".to_string())?;
                stream_artifact_from_start(
                    client,
                    artifact,
                    &mut output,
                    &mut hasher,
                    &mut downloaded,
                    on_progress,
                )?;
            }
            Err(NarrationPackDownloadError::Failed(error)) => return Err(error),
        }
    } else {
        stream_artifact_from_start(
            client,
            artifact,
            &mut output,
            &mut hasher,
            &mut downloaded,
            on_progress,
        )?;
    }
    output
        .flush()
        .map_err(|_| "Sonelle couldn't save offline narration files.".to_string())?;
    drop(output);

    if downloaded != artifact.size_bytes || finalize_sha256(hasher) != artifact.sha256 {
        let _ = fs::remove_file(&temporary);
        return Err(
            "Offline narration files did not pass their safety check. Please retry.".to_string(),
        );
    }

    if destination.exists() {
        fs::remove_file(destination)
            .map_err(|_| "Sonelle couldn't replace offline narration files.".to_string())?;
    }
    fs::rename(&temporary, destination)
        .map_err(|_| "Sonelle couldn't finish offline narration setup.".to_string())
}

fn stream_artifact_from_start(
    client: &dyn NarrationPackDownloadClient,
    artifact: &NarrationPackArtifact,
    output: &mut File,
    hasher: &mut Sha256,
    downloaded: &mut u64,
    on_progress: &mut dyn FnMut(u64),
) -> Result<(), String> {
    client.stream(&artifact.url, &mut |chunk| {
        write_download_chunk(output, hasher, downloaded, on_progress, chunk)
    })
}

fn stream_artifact_range(
    client: &dyn NarrationPackDownloadClient,
    artifact: &NarrationPackArtifact,
    output: &mut File,
    hasher: &mut Sha256,
    downloaded: &mut u64,
    on_progress: &mut dyn FnMut(u64),
) -> Result<(), NarrationPackDownloadError> {
    client.stream_range(&artifact.url, *downloaded, &mut |chunk| {
        write_download_chunk(output, hasher, downloaded, on_progress, chunk)
    })
}

fn write_download_chunk(
    output: &mut File,
    hasher: &mut Sha256,
    downloaded: &mut u64,
    on_progress: &mut dyn FnMut(u64),
    chunk: &[u8],
) -> Result<(), String> {
    output
        .write_all(chunk)
        .map_err(|_| "Sonelle couldn't save offline narration files.".to_string())?;
    hasher.update(chunk);
    *downloaded = downloaded.saturating_add(chunk.len() as u64);
    on_progress(*downloaded);
    Ok(())
}

fn verified_artifact_is_ready(destination: &Path, artifact: &NarrationPackArtifact) -> bool {
    destination
        .metadata()
        .map(|metadata| metadata.len() == artifact.size_bytes)
        .unwrap_or(false)
        && file_sha256(destination).as_deref() == Some(artifact.sha256.as_str())
}

fn hash_partial_file(path: &Path) -> Result<Sha256, String> {
    let mut hasher = Sha256::new();
    if !path.exists() {
        return Ok(hasher);
    }

    let mut file = File::open(path)
        .map_err(|_| "Sonelle couldn't open offline narration files.".to_string())?;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|_| "Sonelle couldn't open offline narration files.".to_string())?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Ok(hasher)
}

fn write_pack_record(destination: &Path, pack: &NarrationPack) -> Result<(), String> {
    let record = InstalledPackRecord {
        pack_id: pack.id.clone(),
        revision: pack.revision.clone(),
        artifacts: pack
            .artifacts
            .iter()
            .map(|artifact| InstalledArtifactRecord {
                id: artifact.id.clone(),
                relative_path: artifact.relative_path.to_string_lossy().into_owned(),
                sha256: artifact.sha256.clone(),
                size_bytes: artifact.size_bytes,
            })
            .collect(),
    };
    let contents = serde_json::to_vec_pretty(&record)
        .map_err(|_| "Sonelle couldn't record offline narration files.".to_string())?;
    fs::write(destination.join("pack.json"), contents)
        .map_err(|_| "Sonelle couldn't record offline narration files.".to_string())
}

fn read_pack_record(destination: &Path) -> Option<InstalledPackRecord> {
    let contents = fs::read_to_string(destination.join("pack.json")).ok()?;
    serde_json::from_str(&contents).ok()
}

fn validate_pack(pack: &NarrationPack) -> Result<(), String> {
    if pack.id.trim().is_empty() || pack.revision.trim().is_empty() || pack.artifacts.is_empty() {
        return Err("Offline narration pack metadata is incomplete.".to_string());
    }

    for artifact in &pack.artifacts {
        if artifact.id.trim().is_empty()
            || artifact.url.trim().is_empty()
            || artifact.sha256.len() != 64
            || artifact.size_bytes == 0
            || !safe_relative_path(&artifact.relative_path)
        {
            return Err("Offline narration pack metadata is incomplete.".to_string());
        }
    }
    Ok(())
}

fn safe_relative_path(path: &Path) -> bool {
    !path.is_absolute()
        && path
            .components()
            .all(|component| matches!(component, std::path::Component::Normal(_)))
}

fn total_pack_bytes(pack: &NarrationPack) -> u64 {
    pack.artifacts
        .iter()
        .map(|artifact| artifact.size_bytes)
        .sum()
}

fn file_sha256(path: &Path) -> Option<String> {
    let mut file = File::open(path).ok()?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = file.read(&mut buffer).ok()?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Some(finalize_sha256(hasher))
}

fn finalize_sha256(hasher: Sha256) -> String {
    hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{
        adopt_compatible_installed_pack, install_narration_pack, installed_pack_is_ready,
        NarrationPack, NarrationPackArtifact, NarrationPackDownloadClient,
        NarrationPackDownloadError, NarrationPackInstallStatus,
    };
    use std::{
        cell::Cell,
        fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    struct FakeDownloadClient {
        payload: Vec<u8>,
        failure: Option<String>,
        calls: Cell<u32>,
        range_calls: Cell<u32>,
        supports_range: bool,
    }

    impl NarrationPackDownloadClient for FakeDownloadClient {
        fn stream(
            &self,
            _url: &str,
            on_chunk: &mut dyn FnMut(&[u8]) -> Result<(), String>,
        ) -> Result<(), String> {
            self.calls.set(self.calls.get() + 1);
            let split = self.payload.len().min(3);
            on_chunk(&self.payload[..split])?;
            on_chunk(&self.payload[split..])?;
            match &self.failure {
                Some(error) => Err(error.clone()),
                None => Ok(()),
            }
        }

        fn stream_range(
            &self,
            _url: &str,
            start_byte: u64,
            on_chunk: &mut dyn FnMut(&[u8]) -> Result<(), String>,
        ) -> Result<(), NarrationPackDownloadError> {
            self.range_calls.set(self.range_calls.get() + 1);
            if !self.supports_range {
                return Err(NarrationPackDownloadError::UnsupportedResume);
            }

            let start = usize::try_from(start_byte).map_err(|_| {
                NarrationPackDownloadError::Failed("range start is too large".to_string())
            })?;
            let payload = self.payload.get(start..).ok_or_else(|| {
                NarrationPackDownloadError::Failed("range start is too large".to_string())
            })?;
            let split = payload.len().min(2);
            on_chunk(&payload[..split]).map_err(NarrationPackDownloadError::Failed)?;
            on_chunk(&payload[split..]).map_err(NarrationPackDownloadError::Failed)?;

            match &self.failure {
                Some(error) => Err(NarrationPackDownloadError::Failed(error.clone())),
                None => Ok(()),
            }
        }
    }

    #[test]
    fn installs_and_reuses_verified_packs() {
        let root = test_root("pack-reuse");
        let pack = test_pack(
            "rev-a",
            "8328d302e64b688068affcad021367dad44992236ca84add38713735f9a9a1f0",
            7,
        );
        let client = FakeDownloadClient {
            payload: b"Sonelle".to_vec(),
            failure: None,
            calls: Cell::new(0),
            range_calls: Cell::new(0),
            supports_range: true,
        };
        let mut progress = Vec::new();

        let first = install_narration_pack(&root, &pack, &client, &mut |done, total| {
            progress.push((done, total));
        })
        .expect("pack should install");
        let second = install_narration_pack(&root, &pack, &client, &mut |_, _| {})
            .expect("pack should reuse");

        assert_eq!(first, NarrationPackInstallStatus::Installed);
        assert_eq!(second, NarrationPackInstallStatus::Reused);
        assert_eq!(client.calls.get(), 1);
        assert!(installed_pack_is_ready(
            &root.join("kokoro").join("rev-a"),
            &pack
        ));
        assert_eq!(progress.last(), Some(&(7, 7)));
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn adopts_verified_artifacts_when_only_the_pack_revision_changed() {
        let root = test_root("pack-compatible-revision");
        let installed = test_pack(
            "rev-a",
            "8328d302e64b688068affcad021367dad44992236ca84add38713735f9a9a1f0",
            7,
        );
        let current = test_pack(
            "rev-b",
            "8328d302e64b688068affcad021367dad44992236ca84add38713735f9a9a1f0",
            7,
        );
        let client = FakeDownloadClient {
            payload: b"Sonelle".to_vec(),
            failure: None,
            calls: Cell::new(0),
            range_calls: Cell::new(0),
            supports_range: true,
        };

        install_narration_pack(&root, &installed, &client, &mut |_, _| {})
            .expect("old revision should install");
        let adopted = adopt_compatible_installed_pack(&root, &current)
            .expect("compatible revision should be adopted");

        assert!(adopted);
        assert!(!root.join("kokoro/rev-a").exists());
        assert!(installed_pack_is_ready(
            &root.join("kokoro/rev-b"),
            &current
        ));
        assert_eq!(client.calls.get(), 1);
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn retries_when_installed_artifacts_are_corrupt() {
        let root = test_root("pack-corrupt");
        let pack = test_pack(
            "rev-a",
            "8328d302e64b688068affcad021367dad44992236ca84add38713735f9a9a1f0",
            7,
        );
        let client = FakeDownloadClient {
            payload: b"Sonelle".to_vec(),
            failure: None,
            calls: Cell::new(0),
            range_calls: Cell::new(0),
            supports_range: true,
        };

        install_narration_pack(&root, &pack, &client, &mut |_, _| {}).expect("pack should install");
        fs::write(root.join("kokoro/rev-a/model.onnx"), b"broken").expect("corrupt artifact");
        install_narration_pack(&root, &pack, &client, &mut |_, _| {})
            .expect("pack should reinstall");

        assert_eq!(client.calls.get(), 2);
        assert!(installed_pack_is_ready(
            &root.join("kokoro").join("rev-a"),
            &pack
        ));
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn keeps_partial_downloads_after_failure() {
        let root = test_root("pack-failure");
        let pack = test_pack(
            "rev-a",
            "0000000000000000000000000000000000000000000000000000000000000000",
            7,
        );
        let client = FakeDownloadClient {
            payload: b"partial".to_vec(),
            failure: Some("connection lost".to_string()),
            calls: Cell::new(0),
            range_calls: Cell::new(0),
            supports_range: true,
        };

        let error = install_narration_pack(&root, &pack, &client, &mut |_, _| {})
            .expect_err("pack should fail");

        assert_eq!(error, "connection lost");
        assert_eq!(
            fs::read(root.join("kokoro/rev-a.installing/model.download"))
                .expect("partial download should remain"),
            b"partial"
        );
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn resumes_partial_downloads_when_the_source_supports_ranges() {
        let root = test_root("pack-resume");
        let pack = test_pack(
            "rev-a",
            "8328d302e64b688068affcad021367dad44992236ca84add38713735f9a9a1f0",
            7,
        );
        let first_client = FakeDownloadClient {
            payload: b"Son".to_vec(),
            failure: Some("connection lost".to_string()),
            calls: Cell::new(0),
            range_calls: Cell::new(0),
            supports_range: true,
        };
        install_narration_pack(&root, &pack, &first_client, &mut |_, _| {})
            .expect_err("first install should fail");

        let second_client = FakeDownloadClient {
            payload: b"Sonelle".to_vec(),
            failure: None,
            calls: Cell::new(0),
            range_calls: Cell::new(0),
            supports_range: true,
        };
        install_narration_pack(&root, &pack, &second_client, &mut |_, _| {})
            .expect("second install should resume");

        assert_eq!(second_client.calls.get(), 0);
        assert_eq!(second_client.range_calls.get(), 1);
        assert!(installed_pack_is_ready(
            &root.join("kokoro").join("rev-a"),
            &pack
        ));
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn rejects_unsafe_artifact_paths() {
        let root = test_root("pack-unsafe");
        let mut pack = test_pack(
            "rev-a",
            "8328d302e64b688068affcad021367dad44992236ca84add38713735f9a9a1f0",
            7,
        );
        pack.artifacts[0].relative_path = PathBuf::from("../model.onnx");
        let client = FakeDownloadClient {
            payload: b"Sonelle".to_vec(),
            failure: None,
            calls: Cell::new(0),
            range_calls: Cell::new(0),
            supports_range: true,
        };

        assert!(install_narration_pack(&root, &pack, &client, &mut |_, _| {}).is_err());
        assert_eq!(client.calls.get(), 0);
        fs::remove_dir_all(root).ok();
    }

    fn test_pack(revision: &str, sha256: &str, size_bytes: u64) -> NarrationPack {
        NarrationPack {
            id: "kokoro".to_string(),
            revision: revision.to_string(),
            artifacts: vec![NarrationPackArtifact {
                id: "model".to_string(),
                relative_path: PathBuf::from("model.onnx"),
                url: "https://example.invalid/model.onnx".to_string(),
                sha256: sha256.to_string(),
                size_bytes,
            }],
        }
    }

    fn test_root(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "sonelle-{label}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("time")
                .as_nanos()
        ))
    }
}
