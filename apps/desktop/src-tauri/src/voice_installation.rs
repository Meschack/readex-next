use std::{
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
    process::Stdio,
    sync::{Mutex, OnceLock},
};

use flate2::read::GzDecoder;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};

use crate::{audio::narration_voice_is_ready, background_process::background_command};

const NARRATION_VOICE_CONFIG: &str =
    include_str!("../../../../packages/audio/src/narration-voices.json");
const VOICE_BASE_URL: &str = "https://huggingface.co/rhasspy/piper-voices/resolve/main";
const RUNTIME_VERSION: &str = "2023.11.14-2";
const INSTALLATION_PROGRESS_EVENT: &str = "narration-voice-installation-progress";

static VOICE_INSTALLATION_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

trait VoiceDownloadClient {
    fn stream(
        &self,
        url: &str,
        on_chunk: &mut dyn FnMut(&[u8]) -> Result<(), String>,
    ) -> Result<(), String>;
}

struct NativeVoiceDownloadClient;

impl VoiceDownloadClient for NativeVoiceDownloadClient {
    fn stream(
        &self,
        url: &str,
        on_chunk: &mut dyn FnMut(&[u8]) -> Result<(), String>,
    ) -> Result<(), String> {
        let mut response = ureq::get(url)
            .header("User-Agent", "Sonelle voice installer")
            .call()
            .map_err(|_| {
                "The voice couldn't be downloaded. Check your connection and retry.".to_string()
            })?;
        let mut reader = response.body_mut().as_reader();
        let mut buffer = [0_u8; 64 * 1024];

        loop {
            let count = reader
                .read(&mut buffer)
                .map_err(|_| "The voice download was interrupted. Please retry.".to_string())?;
            if count == 0 {
                return Ok(());
            }
            on_chunk(&buffer[..count])?;
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VoiceCatalog {
    voices: Vec<VoiceCatalogEntry>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VoiceCatalogEntry {
    id: String,
    download: VoiceDownloadMetadata,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VoiceDownloadMetadata {
    size_bytes: u64,
    model_sha256: String,
    config_sha256: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NarrationVoiceInstallationStatus {
    pub voice_id: String,
    pub status: &'static str,
    pub download_size_bytes: u64,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VoiceInstallationProgress {
    voice_id: String,
    status: &'static str,
    progress: Option<u8>,
    downloaded_bytes: u64,
    total_bytes: u64,
    message: String,
}

#[derive(Debug, Clone, Copy)]
enum RuntimeArchiveKind {
    TarGz,
    Zip,
}

#[derive(Debug, Clone, Copy)]
struct RuntimeDownload {
    file_name: &'static str,
    sha256: &'static str,
    size_bytes: u64,
    kind: RuntimeArchiveKind,
}

#[derive(Debug, Clone, Copy)]
struct InstallationProgress {
    completed_bytes: u64,
    total_bytes: u64,
}

impl InstallationProgress {
    fn new(total_bytes: u64) -> Self {
        Self {
            completed_bytes: 0,
            total_bytes,
        }
    }

    fn complete(&mut self, bytes: u64) {
        self.completed_bytes = self
            .completed_bytes
            .saturating_add(bytes)
            .min(self.total_bytes);
    }

    fn finish(&mut self) {
        self.completed_bytes = self.total_bytes;
    }

    fn snapshot(&self, active_download_bytes: u64) -> (u64, u64, Option<u8>) {
        let downloaded_bytes = self
            .completed_bytes
            .saturating_add(active_download_bytes)
            .min(self.total_bytes);
        let progress = (self.total_bytes > 0)
            .then(|| ((downloaded_bytes.saturating_mul(100) / self.total_bytes).min(100)) as u8);
        (downloaded_bytes, self.total_bytes, progress)
    }

    fn emit(
        &self,
        app: &AppHandle,
        voice_id: &str,
        status: &'static str,
        message: &str,
        active_download_bytes: u64,
    ) {
        let (downloaded_bytes, total_bytes, progress) = self.snapshot(active_download_bytes);
        emit_progress(
            app,
            voice_id,
            status,
            progress,
            downloaded_bytes,
            total_bytes,
            message,
        );
    }
}

pub fn voice_status(
    app: &AppHandle,
    voice_id: &str,
) -> Result<NarrationVoiceInstallationStatus, String> {
    let voice = catalog_voice(voice_id)?;
    let ready = narration_voice_is_ready(app, voice_id);
    let runtime_size = if managed_runtime_ready(app) {
        0
    } else {
        runtime_download()?.size_bytes
    };

    Ok(NarrationVoiceInstallationStatus {
        voice_id: voice_id.to_string(),
        status: if ready { "ready" } else { "not-installed" },
        download_size_bytes: if ready {
            0
        } else {
            runtime_size + voice.download.size_bytes
        },
        message: if ready {
            "Ready to listen offline.".to_string()
        } else {
            "Download this voice to listen offline.".to_string()
        },
    })
}

pub fn install_voice(
    app: &AppHandle,
    voice_id: &str,
) -> Result<NarrationVoiceInstallationStatus, String> {
    let voice = catalog_voice(voice_id)?;
    let _guard = VOICE_INSTALLATION_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "Voice preparation is already busy. Please try again.".to_string())?;

    if narration_voice_is_ready(app, voice_id) {
        return voice_status(app, voice_id);
    }

    let runtime_size = if managed_runtime_ready(app) {
        0
    } else {
        runtime_download()?.size_bytes
    };
    let mut progress = InstallationProgress::new(runtime_size + voice.download.size_bytes);
    progress.emit(app, voice_id, "preparing", "Preparing this voice", 0);
    ensure_runtime(app, voice_id, &mut progress)?;
    install_voice_files(app, &voice, &mut progress)?;

    if !narration_voice_is_ready(app, voice_id) {
        return Err("The voice was downloaded but could not be opened. Please retry.".to_string());
    }

    progress.finish();
    progress.emit(app, voice_id, "ready", "Ready to listen offline", 0);
    voice_status(app, voice_id)
}

pub fn managed_piper_path(app_data_dir: &Path) -> PathBuf {
    let executable = if cfg!(windows) { "piper.exe" } else { "piper" };
    runtime_root(app_data_dir).join("piper").join(executable)
}

fn install_voice_files(
    app: &AppHandle,
    voice: &VoiceCatalogEntry,
    progress: &mut InstallationProgress,
) -> Result<(), String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|_| "Sonelle couldn't open its offline voice folder.".to_string())?;
    let voice_dir = app_data_dir.join("voices").join("piper");
    fs::create_dir_all(&voice_dir)
        .map_err(|_| "Sonelle couldn't create its offline voice folder.".to_string())?;

    let (model_url, config_url) = voice_urls(&voice.id)?;
    let model_path = voice_dir.join(format!("{}.onnx", voice.id));
    let config_path = voice_dir.join(format!("{}.onnx.json", voice.id));

    download_verified(
        app,
        &voice.id,
        &model_url,
        &model_path,
        &voice.download.model_sha256,
        "Downloading voice",
        progress,
    )?;
    download_verified(
        app,
        &voice.id,
        &config_url,
        &config_path,
        &voice.download.config_sha256,
        "Finishing voice",
        progress,
    )
}

fn ensure_runtime(
    app: &AppHandle,
    voice_id: &str,
    progress: &mut InstallationProgress,
) -> Result<(), String> {
    if managed_runtime_ready(app) {
        return Ok(());
    }

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|_| "Sonelle couldn't open its offline voice folder.".to_string())?;
    let download = runtime_download()?;
    let downloads_dir = app_data_dir.join("voice-downloads");
    let archive_path = downloads_dir.join(download.file_name);
    fs::create_dir_all(&downloads_dir)
        .map_err(|_| "Sonelle couldn't create its voice download folder.".to_string())?;

    let url = format!(
        "https://github.com/rhasspy/piper/releases/download/{RUNTIME_VERSION}/{}",
        download.file_name
    );
    download_verified(
        app,
        voice_id,
        &url,
        &archive_path,
        download.sha256,
        "Preparing offline listening",
        progress,
    )?;

    let destination = runtime_root(&app_data_dir);
    let temporary = destination.with_file_name(format!("{RUNTIME_VERSION}.installing"));
    if temporary.exists() {
        fs::remove_dir_all(&temporary)
            .map_err(|_| "Sonelle couldn't refresh its offline voice support.".to_string())?;
    }
    fs::create_dir_all(&temporary)
        .map_err(|_| "Sonelle couldn't prepare offline listening.".to_string())?;

    progress.emit(
        app,
        voice_id,
        "installing",
        "Preparing offline listening",
        0,
    );
    extract_runtime(&archive_path, &temporary, download.kind)?;
    copy_windows_runtime_files(app, &temporary.join("piper"))?;
    make_runtime_executable(&temporary)?;
    verify_runtime_at(&temporary)?;

    if destination.exists() {
        fs::remove_dir_all(&destination)
            .map_err(|_| "Sonelle couldn't refresh its offline voice support.".to_string())?;
    }
    fs::rename(&temporary, &destination)
        .map_err(|_| "Sonelle couldn't finish preparing offline listening.".to_string())?;
    let _ = fs::remove_file(archive_path);
    Ok(())
}

fn download_verified(
    app: &AppHandle,
    voice_id: &str,
    url: &str,
    destination: &Path,
    expected_sha256: &str,
    message: &str,
    progress: &mut InstallationProgress,
) -> Result<(), String> {
    let downloaded = download_verified_file(
        &NativeVoiceDownloadClient,
        url,
        destination,
        expected_sha256,
        &mut |downloaded| {
            progress.emit(app, voice_id, "downloading", message, downloaded);
        },
    )?;
    progress.complete(downloaded);
    progress.emit(app, voice_id, "downloading", message, 0);
    Ok(())
}

fn download_verified_file(
    client: &dyn VoiceDownloadClient,
    url: &str,
    destination: &Path,
    expected_sha256: &str,
    on_progress: &mut dyn FnMut(u64),
) -> Result<u64, String> {
    if destination.exists() && file_sha256(destination).as_deref() == Some(expected_sha256) {
        return Ok(fs::metadata(destination)
            .map(|metadata| metadata.len())
            .unwrap_or(0));
    }

    let temporary = destination.with_extension(format!(
        "{}download",
        destination
            .extension()
            .and_then(|extension| extension.to_str())
            .map(|extension| format!("{extension}."))
            .unwrap_or_default()
    ));
    if temporary.exists() {
        let _ = fs::remove_file(&temporary);
    }

    let mut output = File::create(&temporary)
        .map_err(|_| "Sonelle couldn't save the voice download.".to_string())?;
    let mut hasher = Sha256::new();
    let mut downloaded = 0_u64;

    let stream_result = client.stream(url, &mut |chunk| {
        output
            .write_all(chunk)
            .map_err(|_| "Sonelle couldn't save the voice download.".to_string())?;
        hasher.update(chunk);
        downloaded += chunk.len() as u64;
        on_progress(downloaded);
        Ok(())
    });
    if let Err(error) = stream_result {
        drop(output);
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    output
        .flush()
        .map_err(|_| "Sonelle couldn't save the voice download.".to_string())?;
    drop(output);

    let actual = finalize_sha256(hasher);
    if actual != expected_sha256 {
        let _ = fs::remove_file(&temporary);
        return Err("The voice download did not pass its safety check. Please retry.".to_string());
    }

    if destination.exists() {
        fs::remove_file(destination)
            .map_err(|_| "Sonelle couldn't replace the previous voice download.".to_string())?;
    }
    fs::rename(&temporary, destination)
        .map_err(|_| "Sonelle couldn't finish saving the voice.".to_string())?;
    Ok(downloaded)
}

fn extract_runtime(
    archive_path: &Path,
    destination: &Path,
    kind: RuntimeArchiveKind,
) -> Result<(), String> {
    match kind {
        RuntimeArchiveKind::Zip => {
            let file = File::open(archive_path)
                .map_err(|_| "Sonelle couldn't open the offline voice support.".to_string())?;
            let mut archive = zip::ZipArchive::new(file)
                .map_err(|_| "The offline voice support could not be unpacked.".to_string())?;
            for index in 0..archive.len() {
                let mut entry = archive
                    .by_index(index)
                    .map_err(|_| "The offline voice support could not be unpacked.".to_string())?;
                let Some(relative) = entry.enclosed_name() else {
                    return Err("The offline voice support contained an unsafe path.".to_string());
                };
                let output_path = destination.join(relative);
                if entry.is_dir() {
                    fs::create_dir_all(&output_path).map_err(|_| {
                        "Sonelle couldn't prepare its offline voice support.".to_string()
                    })?;
                    continue;
                }
                if let Some(parent) = output_path.parent() {
                    fs::create_dir_all(parent).map_err(|_| {
                        "Sonelle couldn't prepare its offline voice support.".to_string()
                    })?;
                }
                let mut output = File::create(&output_path).map_err(|_| {
                    "Sonelle couldn't prepare its offline voice support.".to_string()
                })?;
                std::io::copy(&mut entry, &mut output)
                    .map_err(|_| "The offline voice support could not be unpacked.".to_string())?;
            }
        }
        RuntimeArchiveKind::TarGz => {
            let file = File::open(archive_path)
                .map_err(|_| "Sonelle couldn't open the offline voice support.".to_string())?;
            let decoder = GzDecoder::new(file);
            let mut archive = tar::Archive::new(decoder);
            archive
                .unpack(destination)
                .map_err(|_| "The offline voice support could not be unpacked.".to_string())?;
        }
    }
    Ok(())
}

fn managed_runtime_ready(app: &AppHandle) -> bool {
    let Ok(app_data_dir) = app.path().app_data_dir() else {
        return false;
    };
    let path = managed_piper_path(&app_data_dir);
    path.exists()
        && background_command(&path)
            .arg("--help")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|status| status.success())
}

fn verify_runtime_at(root: &Path) -> Result<(), String> {
    let path = managed_piper_path_from_root(root);
    let status = background_command(&path)
        .arg("--help")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|_| "Sonelle couldn't open its offline voice support.".to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err("Sonelle couldn't open its offline voice support.".to_string())
    }
}

fn copy_windows_runtime_files(app: &AppHandle, destination: &Path) -> Result<(), String> {
    if !cfg!(windows) {
        return Ok(());
    }

    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|_| "Sonelle couldn't open its bundled voice support.".to_string())?;
    let runtime_dir = windows_runtime_resource_dir(&resource_dir);
    for file in WINDOWS_RUNTIME_FILES {
        let source = runtime_dir.join(file);
        if source.exists() {
            fs::copy(source, destination.join(file))
                .map_err(|_| "Sonelle couldn't prepare its bundled voice support.".to_string())?;
        }
    }
    Ok(())
}

const WINDOWS_RUNTIME_FILES: [&str; 4] = [
    "msvcp140.dll",
    "msvcp140_1.dll",
    "vcruntime140.dll",
    "vcruntime140_1.dll",
];

fn windows_runtime_resource_dir(resource_dir: &Path) -> PathBuf {
    if WINDOWS_RUNTIME_FILES
        .iter()
        .all(|file| resource_dir.join(file).is_file())
    {
        resource_dir.to_path_buf()
    } else {
        resource_dir.join("windows-runtime")
    }
}

#[cfg(unix)]
fn make_runtime_executable(root: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;

    let executable = managed_piper_path_from_root(root);
    let mut permissions = fs::metadata(&executable)
        .map_err(|_| "Sonelle couldn't open its offline voice support.".to_string())?
        .permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(executable, permissions)
        .map_err(|_| "Sonelle couldn't prepare its offline voice support.".to_string())
}

#[cfg(not(unix))]
fn make_runtime_executable(_root: &Path) -> Result<(), String> {
    Ok(())
}

fn runtime_root(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("piper-runtime").join(RUNTIME_VERSION)
}

fn managed_piper_path_from_root(root: &Path) -> PathBuf {
    let executable = if cfg!(windows) { "piper.exe" } else { "piper" };
    root.join("piper").join(executable)
}

fn catalog_voice(voice_id: &str) -> Result<VoiceCatalogEntry, String> {
    let catalog: VoiceCatalog = serde_json::from_str(NARRATION_VOICE_CONFIG)
        .map_err(|_| "Sonelle couldn't read its voice catalog.".to_string())?;
    catalog
        .voices
        .into_iter()
        .find(|voice| voice.id == voice_id)
        .ok_or_else(|| "This narration voice is not supported.".to_string())
}

fn voice_urls(voice_id: &str) -> Result<(String, String), String> {
    let (language, rest) = voice_id
        .split_once('-')
        .ok_or_else(|| "This narration voice is not supported.".to_string())?;
    let language_family = language
        .split_once('_')
        .map(|(family, _)| family)
        .ok_or_else(|| "This narration voice is not supported.".to_string())?;
    let (voice_name, quality) = rest
        .rsplit_once('-')
        .ok_or_else(|| "This narration voice is not supported.".to_string())?;
    let base =
        format!("{VOICE_BASE_URL}/{language_family}/{language}/{voice_name}/{quality}/{voice_id}");
    Ok((
        format!("{base}.onnx?download=true"),
        format!("{base}.onnx.json?download=true"),
    ))
}

fn runtime_download() -> Result<RuntimeDownload, String> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("windows", "x86_64") => Ok(RuntimeDownload {
            file_name: "piper_windows_amd64.zip",
            sha256: "f3c58906402b24f3a96d92145f58acba6d86c9b5db896d207f78dc80811efcea",
            size_bytes: 22_477_236,
            kind: RuntimeArchiveKind::Zip,
        }),
        ("linux", "x86_64") => Ok(RuntimeDownload {
            file_name: "piper_linux_x86_64.tar.gz",
            sha256: "a50cb45f355b7af1f6d758c1b360717877ba0a398cc8cbe6d2a7a3a26e225992",
            size_bytes: 26_460_462,
            kind: RuntimeArchiveKind::TarGz,
        }),
        ("macos", "aarch64") => Ok(RuntimeDownload {
            file_name: "piper_macos_aarch64.tar.gz",
            sha256: "6b1eb03b3735946cb35216e063e7eebcc33a6bbf5dd96ec0217959bf1cdcb0cc",
            size_bytes: 19_146_957,
            kind: RuntimeArchiveKind::TarGz,
        }),
        ("macos", "x86_64") => Ok(RuntimeDownload {
            file_name: "piper_macos_x64.tar.gz",
            sha256: "ced85c0a3df13945b1e623b878a48fdc2854d5c485b4b67f62857cf551deaf8b",
            size_bytes: 19_146_927,
            kind: RuntimeArchiveKind::TarGz,
        }),
        _ => Err("Offline voice installation is not available on this device yet.".to_string()),
    }
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

fn emit_progress(
    app: &AppHandle,
    voice_id: &str,
    status: &'static str,
    progress: Option<u8>,
    downloaded_bytes: u64,
    total_bytes: u64,
    message: &str,
) {
    let _ = app.emit(
        INSTALLATION_PROGRESS_EVENT,
        VoiceInstallationProgress {
            voice_id: voice_id.to_string(),
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
        download_verified_file, extract_runtime, file_sha256, runtime_download, voice_urls,
        windows_runtime_resource_dir, InstallationProgress, RuntimeArchiveKind,
        VoiceDownloadClient, WINDOWS_RUNTIME_FILES,
    };
    use std::{fs, io::Write, path::PathBuf, time::SystemTime};
    use zip::{write::SimpleFileOptions, ZipWriter};

    struct FakeDownloadClient {
        chunks: Vec<Vec<u8>>,
        failure: Option<String>,
    }

    impl VoiceDownloadClient for FakeDownloadClient {
        fn stream(
            &self,
            _url: &str,
            on_chunk: &mut dyn FnMut(&[u8]) -> Result<(), String>,
        ) -> Result<(), String> {
            for chunk in &self.chunks {
                on_chunk(chunk)?;
            }
            match &self.failure {
                Some(error) => Err(error.clone()),
                None => Ok(()),
            }
        }
    }

    #[test]
    fn builds_catalog_voice_urls() {
        let (model, config) = voice_urls("en_GB-alba-medium").expect("voice urls");
        assert_eq!(
            model,
            "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/alba/medium/en_GB-alba-medium.onnx?download=true"
        );
        assert_eq!(
            config,
            "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/alba/medium/en_GB-alba-medium.onnx.json?download=true"
        );
    }

    #[test]
    fn selects_a_pinned_runtime_for_the_test_platform() {
        let runtime = runtime_download().expect("supported desktop test platform");
        assert!(runtime.file_name.starts_with("piper_"));
        assert_eq!(runtime.sha256.len(), 64);
        assert!(runtime.size_bytes > 10 * 1024 * 1024);
    }

    #[test]
    fn finds_windows_runtime_files_beside_the_application() {
        let root = test_path("app-local-windows-runtime");
        fs::create_dir_all(&root).expect("create fixture folder");
        for file in WINDOWS_RUNTIME_FILES {
            fs::write(root.join(file), b"runtime").expect("write runtime fixture");
        }

        assert_eq!(windows_runtime_resource_dir(&root), root);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn supports_the_previous_windows_runtime_resource_folder() {
        let root = test_path("legacy-windows-runtime");

        assert_eq!(
            windows_runtime_resource_dir(&root),
            root.join("windows-runtime")
        );
    }

    #[test]
    fn projects_cumulative_bytes_and_percentage_across_downloads() {
        let mut progress = InstallationProgress::new(100);
        progress.complete(20);
        assert_eq!(progress.snapshot(35), (55, 100, Some(55)));

        progress.complete(35);
        assert_eq!(progress.snapshot(60), (100, 100, Some(100)));

        progress.finish();
        assert_eq!(progress.snapshot(0), (100, 100, Some(100)));
    }

    #[test]
    fn hashes_downloads_before_installing_them() {
        let path = test_path("voice-hash").with_extension("txt");
        fs::write(&path, b"Sonelle").expect("write fixture");
        assert_eq!(
            file_sha256(&path).as_deref(),
            Some("8328d302e64b688068affcad021367dad44992236ca84add38713735f9a9a1f0")
        );
        let _ = fs::remove_file(path);
    }

    #[test]
    fn streams_verified_downloads_into_their_final_destination() {
        let root = test_path("verified-download");
        fs::create_dir_all(&root).expect("create fixture folder");
        let destination = root.join("voice.onnx");
        let client = FakeDownloadClient {
            chunks: vec![b"Son".to_vec(), b"elle".to_vec()],
            failure: None,
        };
        let mut progress = Vec::new();

        let bytes = download_verified_file(
            &client,
            "https://example.invalid/voice",
            &destination,
            "8328d302e64b688068affcad021367dad44992236ca84add38713735f9a9a1f0",
            &mut |downloaded| progress.push(downloaded),
        )
        .expect("verified download");

        assert_eq!(bytes, 7);
        assert_eq!(progress, vec![3, 7]);
        assert_eq!(fs::read(&destination).expect("installed voice"), b"Sonelle");
        assert!(!root.join("voice.onnx.download").exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn removes_partial_files_when_a_download_is_interrupted() {
        let root = test_path("interrupted-download");
        fs::create_dir_all(&root).expect("create fixture folder");
        let destination = root.join("voice.onnx");
        let client = FakeDownloadClient {
            chunks: vec![b"partial".to_vec()],
            failure: Some("connection lost".to_string()),
        };

        let result = download_verified_file(
            &client,
            "https://example.invalid/voice",
            &destination,
            "unused",
            &mut |_| {},
        );

        assert_eq!(result.expect_err("download should fail"), "connection lost");
        assert!(!destination.exists());
        assert!(!root.join("voice.onnx.download").exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn extracts_runtime_archives_inside_the_installation_folder() {
        let root = test_path("safe-runtime");
        let archive_path = root.join("runtime.zip");
        let destination = root.join("unpacked");
        fs::create_dir_all(&destination).expect("create fixture folder");

        let mut archive = ZipWriter::new(fs::File::create(&archive_path).expect("create archive"));
        archive
            .start_file("piper/piper.exe", SimpleFileOptions::default())
            .expect("start runtime entry");
        archive.write_all(b"runtime").expect("write runtime entry");
        archive.finish().expect("finish archive");

        extract_runtime(&archive_path, &destination, RuntimeArchiveKind::Zip)
            .expect("extract runtime");
        assert_eq!(
            fs::read(destination.join("piper/piper.exe")).expect("read extracted runtime"),
            b"runtime"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_runtime_archive_paths_outside_the_installation_folder() {
        let root = test_path("unsafe-runtime");
        let archive_path = root.join("runtime.zip");
        let destination = root.join("unpacked");
        fs::create_dir_all(&destination).expect("create fixture folder");

        let mut archive = ZipWriter::new(fs::File::create(&archive_path).expect("create archive"));
        archive
            .start_file("../outside.dll", SimpleFileOptions::default())
            .expect("start unsafe entry");
        archive.write_all(b"unsafe").expect("write unsafe entry");
        archive.finish().expect("finish archive");

        assert!(extract_runtime(&archive_path, &destination, RuntimeArchiveKind::Zip).is_err());
        assert!(!root.join("outside.dll").exists());
        let _ = fs::remove_dir_all(root);
    }

    fn test_path(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "sonelle-{label}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .expect("time")
                .as_nanos()
        ))
    }
}
