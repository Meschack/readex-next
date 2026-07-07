use std::{
    env, fs,
    path::{Path, PathBuf},
    process::Command,
};

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

const DEFAULT_PIPER_VOICE: &str = "en_US-lessac-medium";
const MISSING_NEURAL_VOICE_MESSAGE: &str = "Install a natural local voice to listen offline.";
const NARRATION_CACHE_VERSION: &str = "piper-v2";

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SentenceAudioRequest {
    pub book_id: String,
    pub chapter_id: String,
    pub sentence_id: String,
    pub sentence_index: i64,
    #[serde(default = "default_piper_voice_id")]
    pub voice_id: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedSentenceAudio {
    pub book_id: String,
    pub chapter_id: String,
    pub sentence_id: String,
    pub readiness: String,
    pub duration_sec: Option<f64>,
    pub source_url: Option<String>,
    pub playback_mode: String,
    pub cached: bool,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioCacheStats {
    pub sentence_count: usize,
    pub size_bytes: u64,
}

trait SpeechAdapter {
    fn prepare(
        &self,
        request: &SentenceAudioRequest,
        cache: &SentenceAudioCache,
    ) -> Result<AdapterOutput, String>;
}

struct AdapterOutput {
    readiness: &'static str,
    playback_mode: &'static str,
    source_url: Option<String>,
    cached: bool,
    message: Option<String>,
}

struct SentenceAudioCache {
    app_data_dir: PathBuf,
    dir: PathBuf,
    audio_path: PathBuf,
    request_voice_id: String,
}

pub fn prepare_narration(
    app: &AppHandle,
    request: SentenceAudioRequest,
) -> Result<PreparedSentenceAudio, String> {
    let cache = SentenceAudioCache::open(app, &request)?;
    let adapter = LocalSpeechAdapter;
    let output = adapter.prepare(&request, &cache)?;

    Ok(PreparedSentenceAudio {
        book_id: request.book_id,
        chapter_id: request.chapter_id,
        sentence_id: request.sentence_id,
        readiness: output.readiness.to_string(),
        duration_sec: Some(estimate_duration_sec(&request.text)),
        source_url: output.source_url,
        playback_mode: output.playback_mode.to_string(),
        cached: output.cached,
        message: output.message,
    })
}

pub fn speak_prepared_narration(
    app: &AppHandle,
    request: SentenceAudioRequest,
) -> Result<(), String> {
    let _ = SentenceAudioCache::open(app, &request)?;
    Err(MISSING_NEURAL_VOICE_MESSAGE.to_string())
}

pub fn stop_narration() -> Result<(), String> {
    Ok(())
}

pub fn audio_cache_summary(app: &AppHandle) -> Result<AudioCacheStats, String> {
    summarize_audio_cache_at(&audio_cache_root(app)?)
}

pub fn clear_audio_cache(app: &AppHandle) -> Result<AudioCacheStats, String> {
    let root = audio_cache_root(app)?;

    if root.exists() {
        fs::remove_dir_all(&root).map_err(|_| "We couldn't clear prepared audio.".to_string())?;
    }

    summarize_audio_cache_at(&root)
}

struct LocalSpeechAdapter;

impl SpeechAdapter for LocalSpeechAdapter {
    fn prepare(
        &self,
        request: &SentenceAudioRequest,
        cache: &SentenceAudioCache,
    ) -> Result<AdapterOutput, String> {
        if cache.audio_path.exists() {
            return Ok(AdapterOutput {
                readiness: "ready",
                playback_mode: "html-audio",
                source_url: Some(wav_data_url(&cache.audio_path)?),
                cached: true,
                message: None,
            });
        }

        fs::create_dir_all(&cache.dir)
            .map_err(|_| "We couldn't prepare local narration.".to_string())?;

        let Some(runtime) = PiperRuntime::resolve(cache) else {
            return Ok(needs_neural_voice());
        };

        if runtime
            .synthesize_wav(&request.text, &cache.audio_path)
            .is_ok()
            && cache.audio_path.exists()
        {
            return Ok(AdapterOutput {
                readiness: "ready",
                playback_mode: "html-audio",
                source_url: Some(wav_data_url(&cache.audio_path)?),
                cached: false,
                message: None,
            });
        }

        Ok(AdapterOutput {
            readiness: "needs-attention",
            playback_mode: "html-audio",
            source_url: None,
            cached: false,
            message: Some("Local voice needs attention. Try reinstalling it.".to_string()),
        })
    }
}

fn needs_neural_voice() -> AdapterOutput {
    AdapterOutput {
        readiness: "needs-attention",
        playback_mode: "html-audio",
        source_url: None,
        cached: false,
        message: Some(MISSING_NEURAL_VOICE_MESSAGE.to_string()),
    }
}

#[derive(Debug, Clone)]
struct PiperRuntime {
    runner: PiperRunner,
    voice: PiperVoice,
}

impl PiperRuntime {
    fn resolve(cache: &SentenceAudioCache) -> Option<Self> {
        Some(Self {
            runner: PiperRunner::resolve()?,
            voice: PiperVoice::resolve(cache, &cache.request_voice_id)?,
        })
    }

    fn synthesize_wav(&self, text: &str, output: &Path) -> Result<(), String> {
        if output.exists() {
            fs::remove_file(output)
                .map_err(|_| "We couldn't refresh local narration.".to_string())?;
        }

        let mut command = self.runner.command();
        if let Some(data_dir) = &self.voice.data_dir {
            command.arg("--data-dir").arg(data_dir);
        }

        let status = command
            .arg("-m")
            .arg(&self.voice.model)
            .arg("-f")
            .arg(output)
            .arg("--")
            .arg(text)
            .status()
            .map_err(|_| "We couldn't start the local voice.".to_string())?;

        if status.success() && output.exists() {
            Ok(())
        } else {
            Err("Local voice needs attention. Try reinstalling it.".to_string())
        }
    }
}

#[derive(Debug, Clone)]
enum PiperRunner {
    Binary(PathBuf),
    Python(PathBuf),
}

impl PiperRunner {
    fn resolve() -> Option<Self> {
        if let Some(path) = env_path("READEX_PIPER_BIN").filter(|path| path.exists()) {
            return Some(Self::Binary(path));
        }

        for readex_dir in readex_state_dirs() {
            let local_python = venv_python_path(&readex_dir.join("piper-venv"));
            if local_python.exists() {
                return Some(Self::Python(local_python));
            }
        }

        if let Some(path) = env_path("READEX_PIPER_PYTHON").filter(|path| path.exists()) {
            return Some(Self::Python(path));
        }

        command_path("piper").map(Self::Binary)
    }

    fn command(&self) -> Command {
        match self {
            Self::Binary(path) => Command::new(path),
            Self::Python(path) => {
                let mut command = Command::new(path);
                command.arg("-m").arg("piper");
                command
            }
        }
    }
}

#[derive(Debug, Clone)]
struct PiperVoice {
    model: String,
    data_dir: Option<PathBuf>,
}

impl PiperVoice {
    fn resolve(cache: &SentenceAudioCache, requested_voice: &str) -> Option<Self> {
        if let Some(model) = env_path("READEX_PIPER_MODEL").filter(|path| piper_model_exists(path))
        {
            return Some(Self {
                model: model.to_string_lossy().to_string(),
                data_dir: None,
            });
        }

        let requested_voice = requested_voice.trim();
        let voice = if requested_voice.is_empty() {
            env::var("READEX_PIPER_VOICE")
                .ok()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| DEFAULT_PIPER_VOICE.to_string())
        } else {
            requested_voice.to_string()
        };

        piper_data_dirs(cache)
            .into_iter()
            .find(|dir| piper_voice_exists(dir, &voice))
            .map(|data_dir| Self {
                model: voice,
                data_dir: Some(data_dir),
            })
    }
}

#[cfg(test)]
pub struct FakeSpeechAdapter;

#[cfg(test)]
impl SpeechAdapter for FakeSpeechAdapter {
    fn prepare(
        &self,
        request: &SentenceAudioRequest,
        cache: &SentenceAudioCache,
    ) -> Result<AdapterOutput, String> {
        let cached = cache.audio_path.exists();
        fs::create_dir_all(&cache.dir)
            .map_err(|_| "We couldn't prepare local narration.".to_string())?;

        if !cached {
            fs::write(&cache.audio_path, fake_wav_bytes(&request.text))
                .map_err(|_| "We couldn't prepare local narration.".to_string())?;
        }

        Ok(AdapterOutput {
            readiness: "ready",
            playback_mode: "html-audio",
            source_url: Some(wav_data_url(&cache.audio_path)?),
            cached,
            message: None,
        })
    }
}

impl SentenceAudioCache {
    fn open(app: &AppHandle, request: &SentenceAudioRequest) -> Result<Self, String> {
        let app_dir = app
            .path()
            .app_data_dir()
            .map_err(|_| "We couldn't open the local library folder.".to_string())?;
        Ok(Self::for_root(
            app_dir.clone(),
            app_dir.join("audio"),
            request,
        ))
    }

    #[cfg(test)]
    fn for_root(app_data_dir: PathBuf, root: PathBuf, request: &SentenceAudioRequest) -> Self {
        let key = cache_key(request);
        let dir = root.join(&key);
        Self {
            app_data_dir,
            audio_path: dir.join("sentence.wav"),
            dir,
            request_voice_id: narration_voice_id(request),
        }
    }
}

#[cfg(not(test))]
impl SentenceAudioCache {
    fn for_root(app_data_dir: PathBuf, root: PathBuf, request: &SentenceAudioRequest) -> Self {
        let key = cache_key(request);
        let dir = root.join(&key);
        Self {
            app_data_dir,
            audio_path: dir.join("sentence.wav"),
            dir,
            request_voice_id: narration_voice_id(request),
        }
    }
}

fn audio_cache_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("audio"))
        .map_err(|_| "We couldn't open prepared audio.".to_string())
}

fn summarize_audio_cache_at(root: &Path) -> Result<AudioCacheStats, String> {
    if !root.exists() {
        return Ok(AudioCacheStats {
            sentence_count: 0,
            size_bytes: 0,
        });
    }

    let mut pending = vec![root.to_path_buf()];
    let mut sentence_count = 0;
    let mut size_bytes = 0;

    while let Some(dir) = pending.pop() {
        let entries =
            fs::read_dir(&dir).map_err(|_| "We couldn't inspect prepared audio.".to_string())?;

        for entry in entries.flatten() {
            let path = entry.path();

            if path.is_dir() {
                pending.push(path);
                continue;
            }

            let metadata = entry
                .metadata()
                .map_err(|_| "We couldn't inspect prepared audio.".to_string())?;

            size_bytes += metadata.len();
            if path.file_name().is_some_and(|name| name == "sentence.wav") {
                sentence_count += 1;
            }
        }
    }

    Ok(AudioCacheStats {
        sentence_count,
        size_bytes,
    })
}

fn wav_data_url(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|_| "We couldn't load prepared narration.".to_string())?;
    Ok(format!("data:audio/wav;base64,{}", STANDARD.encode(bytes)))
}

fn command_path(command: &str) -> Option<PathBuf> {
    let Some(path) = env::var_os("PATH") else {
        return None;
    };

    env::split_paths(&path)
        .map(|dir| dir.join(command))
        .find(|path| path.exists())
}

fn env_path(key: &str) -> Option<PathBuf> {
    env::var_os(key).and_then(|value| {
        if value.is_empty() {
            None
        } else {
            Some(PathBuf::from(value))
        }
    })
}

fn piper_data_dirs(cache: &SentenceAudioCache) -> Vec<PathBuf> {
    let mut dirs = Vec::new();

    if let Some(dir) = env_path("READEX_PIPER_DATA_DIR") {
        dirs.push(dir);
    }

    for readex_dir in readex_state_dirs() {
        dirs.push(readex_dir.join("voices/piper"));
    }

    dirs.push(cache.app_data_dir.join("voices/piper"));
    dirs
}

fn readex_state_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(current_dir) = env::current_dir() {
        push_readex_state_dirs(&mut dirs, &current_dir);
    }

    push_readex_state_dirs(&mut dirs, Path::new(env!("CARGO_MANIFEST_DIR")));
    dirs
}

fn push_readex_state_dirs(dirs: &mut Vec<PathBuf>, start: &Path) {
    for ancestor in start.ancestors() {
        let candidate = ancestor.join(".readex");
        if !dirs.contains(&candidate) {
            dirs.push(candidate);
        }
    }
}

fn piper_model_exists(model: &Path) -> bool {
    model.exists() && model.with_extension("onnx.json").exists()
}

fn piper_voice_exists(data_dir: &Path, voice: &str) -> bool {
    data_dir.exists()
        && find_nested_file(data_dir, &format!("{voice}.onnx"))
        && find_nested_file(data_dir, &format!("{voice}.onnx.json"))
}

fn find_nested_file(root: &Path, file_name: &str) -> bool {
    let mut pending = vec![root.to_path_buf()];

    while let Some(dir) = pending.pop() {
        let Ok(entries) = fs::read_dir(dir) else {
            continue;
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                pending.push(path);
            } else if path.file_name().is_some_and(|name| name == file_name) {
                return true;
            }
        }
    }

    false
}

fn venv_python_path(venv_dir: &Path) -> PathBuf {
    if cfg!(windows) {
        venv_dir.join("Scripts/python.exe")
    } else {
        venv_dir.join("bin/python")
    }
}

fn cache_key(request: &SentenceAudioRequest) -> String {
    let mut hasher = Sha256::new();
    hasher.update(NARRATION_CACHE_VERSION.as_bytes());
    hasher.update(request.book_id.as_bytes());
    hasher.update(request.chapter_id.as_bytes());
    hasher.update(request.sentence_id.as_bytes());
    hasher.update(narration_voice_id(request).as_bytes());
    hasher.update(request.text.as_bytes());
    hex_prefix(&hasher.finalize(), 32)
}

fn narration_voice_id(request: &SentenceAudioRequest) -> String {
    let voice = request.voice_id.trim();
    if voice.is_empty() {
        DEFAULT_PIPER_VOICE.to_string()
    } else {
        voice.to_string()
    }
}

fn default_piper_voice_id() -> String {
    DEFAULT_PIPER_VOICE.to_string()
}

fn estimate_duration_sec(text: &str) -> f64 {
    let word_count = text
        .split_whitespace()
        .filter(|word| !word.is_empty())
        .count() as f64;
    (word_count * 0.34 + 0.5).clamp(1.1, 12.0)
}

fn hex_prefix(bytes: &[u8], length: usize) -> String {
    bytes
        .iter()
        .flat_map(|byte| [byte >> 4, byte & 0x0f])
        .take(length)
        .map(|nibble| char::from_digit(nibble.into(), 16).unwrap_or('0'))
        .collect()
}

#[cfg(test)]
fn fake_wav_bytes(text: &str) -> Vec<u8> {
    let samples = (estimate_duration_sec(text) * 8000.0) as usize;
    let mut data = Vec::with_capacity(44 + samples);
    let data_len = samples as u32;
    let riff_len = 36 + data_len;

    data.extend_from_slice(b"RIFF");
    data.extend_from_slice(&riff_len.to_le_bytes());
    data.extend_from_slice(b"WAVEfmt ");
    data.extend_from_slice(&16u32.to_le_bytes());
    data.extend_from_slice(&1u16.to_le_bytes());
    data.extend_from_slice(&1u16.to_le_bytes());
    data.extend_from_slice(&8000u32.to_le_bytes());
    data.extend_from_slice(&8000u32.to_le_bytes());
    data.extend_from_slice(&1u16.to_le_bytes());
    data.extend_from_slice(&8u16.to_le_bytes());
    data.extend_from_slice(b"data");
    data.extend_from_slice(&data_len.to_le_bytes());
    data.extend(std::iter::repeat(128u8).take(samples));
    data
}

#[cfg(test)]
mod tests {
    use std::{fs, path::PathBuf};

    use chrono::Utc;

    use super::{
        piper_model_exists, piper_voice_exists, summarize_audio_cache_at, FakeSpeechAdapter,
        LocalSpeechAdapter, PiperRuntime, SentenceAudioCache, SentenceAudioRequest, SpeechAdapter,
        DEFAULT_PIPER_VOICE,
    };

    #[test]
    fn fake_adapter_creates_and_reuses_cached_audio() {
        let request = SentenceAudioRequest {
            book_id: "book".to_string(),
            chapter_id: "chapter".to_string(),
            sentence_id: "sentence".to_string(),
            sentence_index: 0,
            voice_id: DEFAULT_PIPER_VOICE.to_string(),
            text: "Hello reader.".to_string(),
        };
        let temp_dir = temp_audio_dir();
        let cache =
            SentenceAudioCache::for_root(temp_dir.clone(), temp_dir.join("audio"), &request);
        let adapter = FakeSpeechAdapter;

        let first = adapter
            .prepare(&request, &cache)
            .expect("audio should prepare");
        let second = adapter
            .prepare(&request, &cache)
            .expect("audio should be cached");

        assert_eq!(first.readiness, "ready");
        assert!(!first.cached);
        assert!(second.cached);
        assert!(second
            .source_url
            .expect("url should exist")
            .starts_with("data:audio/wav"));

        fs::remove_dir_all(temp_dir).ok();
    }

    #[test]
    fn selected_voice_partitions_prepared_audio_cache() {
        let first_request = SentenceAudioRequest {
            book_id: "book".to_string(),
            chapter_id: "chapter".to_string(),
            sentence_id: "sentence".to_string(),
            sentence_index: 0,
            voice_id: DEFAULT_PIPER_VOICE.to_string(),
            text: "Hello reader.".to_string(),
        };
        let second_request = SentenceAudioRequest {
            voice_id: "en_GB-alba-medium".to_string(),
            ..first_request.clone()
        };
        let temp_dir = temp_audio_dir();

        let first_cache =
            SentenceAudioCache::for_root(temp_dir.clone(), temp_dir.join("audio"), &first_request);
        let second_cache =
            SentenceAudioCache::for_root(temp_dir.clone(), temp_dir.join("audio"), &second_request);

        assert_ne!(first_cache.dir, second_cache.dir);

        fs::remove_dir_all(temp_dir).ok();
    }

    #[test]
    fn local_adapter_generates_and_reuses_piper_audio_when_available() {
        let request = SentenceAudioRequest {
            book_id: "book".to_string(),
            chapter_id: "chapter".to_string(),
            sentence_id: "piper-sentence".to_string(),
            sentence_index: 0,
            voice_id: DEFAULT_PIPER_VOICE.to_string(),
            text: "Readex is ready to listen.".to_string(),
        };
        let temp_dir = temp_audio_dir();
        let cache =
            SentenceAudioCache::for_root(temp_dir.clone(), temp_dir.join("audio"), &request);

        if PiperRuntime::resolve(&cache).is_none() {
            fs::remove_dir_all(temp_dir).ok();
            return;
        }

        let adapter = LocalSpeechAdapter;
        let first = adapter
            .prepare(&request, &cache)
            .expect("piper audio should prepare");
        let second = adapter
            .prepare(&request, &cache)
            .expect("piper audio should be cached");

        assert_eq!(first.readiness, "ready");
        assert_eq!(first.playback_mode, "html-audio");
        assert!(!first.cached);
        assert!(second.cached);
        assert!(cache.audio_path.exists());

        fs::remove_dir_all(temp_dir).ok();
    }

    #[test]
    fn detects_piper_voice_in_nested_data_dir() {
        let temp_dir = temp_audio_dir();
        let voice_dir = temp_dir.join("en/en_US/lessac/medium");
        fs::create_dir_all(&voice_dir).expect("voice dir should be created");
        fs::write(voice_dir.join("en_US-lessac-medium.onnx"), b"model")
            .expect("model should be written");
        fs::write(voice_dir.join("en_US-lessac-medium.onnx.json"), b"{}")
            .expect("config should be written");

        assert!(piper_voice_exists(&temp_dir, "en_US-lessac-medium"));
        assert!(!piper_voice_exists(&temp_dir, "en_US-missing-medium"));

        fs::remove_dir_all(temp_dir).ok();
    }

    #[test]
    fn exact_piper_model_requires_adjacent_config() {
        let temp_dir = temp_audio_dir();
        fs::create_dir_all(&temp_dir).expect("model dir should be created");
        let model = temp_dir.join("voice.onnx");
        fs::write(&model, b"model").expect("model should be written");

        assert!(!piper_model_exists(&model));

        fs::write(temp_dir.join("voice.onnx.json"), b"{}").expect("config should be written");

        assert!(piper_model_exists(&model));

        fs::remove_dir_all(temp_dir).ok();
    }

    #[test]
    fn summarizes_audio_cache_files() {
        let temp_dir = temp_audio_dir();
        let sentence_dir = temp_dir.join("audio/cache-key");
        fs::create_dir_all(&sentence_dir).expect("cache dir should be created");
        fs::write(sentence_dir.join("sentence.wav"), b"audio")
            .expect("audio file should be written");

        let stats =
            summarize_audio_cache_at(&temp_dir.join("audio")).expect("cache should summarize");

        assert_eq!(stats.sentence_count, 1);
        assert_eq!(stats.size_bytes, 5);

        fs::remove_dir_all(temp_dir).ok();
    }

    fn temp_audio_dir() -> PathBuf {
        std::env::temp_dir().join(format!(
            "readex-audio-test-{}",
            Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ))
    }
}
