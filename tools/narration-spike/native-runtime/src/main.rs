use anyhow::{bail, Context, Result};
use ndarray::{Array1, Array2};
use ort::{ep::CPU, session::Session, value::Value};
use serde::{Deserialize, Serialize};
use std::{
    env, fs,
    path::{Path, PathBuf},
    thread,
    time::{Duration, Instant},
};

#[path = "../../../../.sonelle/narration-spike/sources/supertonic/rust/src/helper.rs"]
#[allow(dead_code)]
#[rustfmt::skip]
mod supertonic;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct KokoroFixture {
    schema_version: u32,
    passage_id: String,
    sample_rate: u32,
    input_ids: Vec<i64>,
    style: Vec<f32>,
    speed: i32,
    expected_durations: Vec<i64>,
    expected_waveform_samples: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StageMeasurement {
    name: &'static str,
    elapsed_milliseconds: u128,
    resident_memory_kib: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct KokoroMeasurement {
    passage_id: String,
    sample_rate: u32,
    audio_seconds: f64,
    cold_inference_milliseconds: u128,
    warm_inference_milliseconds: u128,
    warm_real_time_factor: f64,
    durations_match_reference: bool,
    waveform_samples_match_reference: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SupertonicMeasurement {
    sample_rate: i32,
    audio_seconds: f64,
    inference_milliseconds: u128,
    real_time_factor: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LifecycleReport {
    schema_version: u32,
    platform: String,
    architecture: String,
    rust_ort_crate: &'static str,
    memory_mode: RuntimeMemoryMode,
    normal_cleanup_reached: bool,
    corrupt_model_rejected: bool,
    corrupt_model_error: String,
    stages: Vec<StageMeasurement>,
    kokoro: KokoroMeasurement,
    supertonic: SupertonicMeasurement,
}

#[derive(Debug)]
struct KokoroInference {
    elapsed: Duration,
    waveform_samples: usize,
    durations: Vec<i64>,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "kebab-case")]
enum RuntimeMemoryMode {
    Default,
    Bounded,
}

impl RuntimeMemoryMode {
    fn label(self) -> &'static str {
        match self {
            Self::Default => "default",
            Self::Bounded => "bounded",
        }
    }
}

#[derive(Debug)]
struct Arguments {
    workspace: PathBuf,
    memory_mode: RuntimeMemoryMode,
}

fn main() -> Result<()> {
    let arguments = arguments_from(env::args().skip(1))?;
    let workspace = arguments.workspace;
    let memory_mode = arguments.memory_mode;
    let fixture_path = workspace.join("results/kokoro/native-fixture.json");
    let kokoro_model = workspace.join("kokoro-onnx/kokoro.onnx");
    let supertonic_onnx = workspace.join("sources/supertonic/assets/onnx");
    let supertonic_style = workspace.join("sources/supertonic/assets/voice_styles/F1.json");
    let results_dir = workspace.join("results");
    fs::create_dir_all(&results_dir)?;

    let fixture: KokoroFixture = serde_json::from_slice(
        &fs::read(&fixture_path)
            .with_context(|| format!("could not read {}", fixture_path.display()))?,
    )?;
    validate_fixture(&fixture)?;

    let mut stages = vec![stage("baseline", Duration::ZERO)];

    let started = Instant::now();
    let mut kokoro = load_session(&kokoro_model, memory_mode)?;
    stages.push(stage("kokoro-loaded", started.elapsed()));

    let cold = infer_kokoro(&mut kokoro, &fixture)?;
    stages.push(stage("kokoro-cold-inference", cold.elapsed));
    let warm = infer_kokoro(&mut kokoro, &fixture)?;
    stages.push(stage("kokoro-warm-inference", warm.elapsed));
    let durations_match_reference = warm.durations == fixture.expected_durations;
    let waveform_samples_match_reference =
        warm.waveform_samples == fixture.expected_waveform_samples;
    if !durations_match_reference || !waveform_samples_match_reference {
        bail!(
            "native Kokoro output did not match the pinned fixture: durations={}, samples={}",
            durations_match_reference,
            waveform_samples_match_reference
        );
    }
    let audio_seconds = warm.waveform_samples as f64 / fixture.sample_rate as f64;
    let kokoro_measurement = KokoroMeasurement {
        passage_id: fixture.passage_id.clone(),
        sample_rate: fixture.sample_rate,
        audio_seconds,
        cold_inference_milliseconds: cold.elapsed.as_millis(),
        warm_inference_milliseconds: warm.elapsed.as_millis(),
        warm_real_time_factor: warm.elapsed.as_secs_f64() / audio_seconds,
        durations_match_reference,
        waveform_samples_match_reference,
    };

    stages.push(drop_stage("kokoro-dropped", kokoro));
    stages.push(trim_allocator_stage("kokoro-allocator-trimmed"));

    let started = Instant::now();
    let mut multilingual = load_supertonic(&supertonic_onnx, memory_mode)?;
    let style = supertonic::load_voice_style(&[path_text(&supertonic_style)?.to_owned()], false)?;
    stages.push(stage("supertonic-loaded", started.elapsed()));

    let text = "La lecture attentive révèle souvent ce que la première impression avait caché.";
    let started = Instant::now();
    let (audio, reported_duration) = multilingual.call(text, "fr", &style, 8, 1.05, 0.3)?;
    let supertonic_elapsed = started.elapsed();
    let actual_samples = (multilingual.sample_rate as f32 * reported_duration) as usize;
    if audio.len() < actual_samples {
        bail!("Supertonic returned fewer samples than its reported duration");
    }
    stages.push(stage("supertonic-inference", supertonic_elapsed));
    let supertonic_measurement = SupertonicMeasurement {
        sample_rate: multilingual.sample_rate,
        audio_seconds: reported_duration as f64,
        inference_milliseconds: supertonic_elapsed.as_millis(),
        real_time_factor: supertonic_elapsed.as_secs_f64() / reported_duration as f64,
    };

    stages.push(drop_stage("supertonic-dropped", (multilingual, style)));
    stages.push(trim_allocator_stage("supertonic-allocator-trimmed"));

    let started = Instant::now();
    let mut kokoro_after_switch = load_session(&kokoro_model, memory_mode)?;
    stages.push(stage("kokoro-reloaded", started.elapsed()));
    let switched = infer_kokoro(&mut kokoro_after_switch, &fixture)?;
    if switched.durations != fixture.expected_durations
        || switched.waveform_samples != fixture.expected_waveform_samples
    {
        bail!("Kokoro output changed after switching away and back");
    }
    stages.push(stage("kokoro-after-switch-inference", switched.elapsed));
    stages.push(drop_stage(
        "kokoro-after-switch-dropped",
        kokoro_after_switch,
    ));
    stages.push(trim_allocator_stage(
        "kokoro-after-switch-allocator-trimmed",
    ));

    let corrupt_path = results_dir.join("corrupt-model.onnx");
    fs::write(&corrupt_path, b"this is deliberately not an ONNX model")?;
    let corrupt_model_error = match load_session(&corrupt_path, memory_mode) {
        Ok(_) => bail!("ONNX Runtime accepted the deliberately corrupt model"),
        Err(error) => format!("{error:#}"),
    };
    fs::remove_file(&corrupt_path)?;
    stages.push(stage("corrupt-model-rejected", Duration::ZERO));

    let report = LifecycleReport {
        schema_version: 1,
        platform: env::consts::OS.to_owned(),
        architecture: env::consts::ARCH.to_owned(),
        rust_ort_crate: "2.0.0-rc.12",
        memory_mode,
        normal_cleanup_reached: true,
        corrupt_model_rejected: true,
        corrupt_model_error,
        stages,
        kokoro: kokoro_measurement,
        supertonic: supertonic_measurement,
    };
    let report_path = results_dir.join(format!("native-lifecycle-{}.json", memory_mode.label()));
    let json = serde_json::to_string_pretty(&report)?;
    fs::write(&report_path, format!("{json}\n"))?;
    println!("{json}");
    println!("Evidence: {}", report_path.display());
    Ok(())
}

fn load_session(path: &Path, memory_mode: RuntimeMemoryMode) -> Result<Session> {
    let mut builder = Session::builder()?;
    if matches!(memory_mode, RuntimeMemoryMode::Bounded) {
        builder = builder
            .with_memory_pattern(false)
            .map_err(|error| anyhow::anyhow!(error.to_string()))?
            .with_execution_providers([CPU::default().with_arena_allocator(false).build()])
            .map_err(|error| anyhow::anyhow!(error.to_string()))?;
    }
    builder
        .commit_from_file(path)
        .with_context(|| format!("could not load ONNX model {}", path.display()))
}

fn load_supertonic(
    onnx_dir: &Path,
    memory_mode: RuntimeMemoryMode,
) -> Result<supertonic::TextToSpeech> {
    let cfgs = supertonic::load_cfgs(onnx_dir)?;
    let duration = load_session(&onnx_dir.join("duration_predictor.onnx"), memory_mode)?;
    let text_encoder = load_session(&onnx_dir.join("text_encoder.onnx"), memory_mode)?;
    let vector_estimator = load_session(&onnx_dir.join("vector_estimator.onnx"), memory_mode)?;
    let vocoder = load_session(&onnx_dir.join("vocoder.onnx"), memory_mode)?;
    let text_processor = supertonic::UnicodeProcessor::new(onnx_dir.join("unicode_indexer.json"))?;
    Ok(supertonic::TextToSpeech::new(
        cfgs,
        text_processor,
        duration,
        text_encoder,
        vector_estimator,
        vocoder,
    ))
}

fn infer_kokoro(session: &mut Session, fixture: &KokoroFixture) -> Result<KokoroInference> {
    let input_ids =
        Array2::from_shape_vec((1, fixture.input_ids.len()), fixture.input_ids.clone())?;
    let style = Array2::from_shape_vec((1, fixture.style.len()), fixture.style.clone())?;
    let speed = Array1::from_vec(vec![fixture.speed]);
    let input_ids = Value::from_array(input_ids)?;
    let style = Value::from_array(style)?;
    let speed = Value::from_array(speed)?;

    let started = Instant::now();
    let outputs = session.run(ort::inputs! {
        "input_ids" => &input_ids,
        "style" => &style,
        "speed" => &speed,
    })?;
    let elapsed = started.elapsed();
    let (_, waveform) = outputs["waveform"].try_extract_tensor::<f32>()?;
    let (_, durations) = outputs["duration"].try_extract_tensor::<i64>()?;
    Ok(KokoroInference {
        elapsed,
        waveform_samples: waveform.len(),
        durations: durations.to_vec(),
    })
}

fn validate_fixture(fixture: &KokoroFixture) -> Result<()> {
    if fixture.schema_version != 1 {
        bail!("unsupported Kokoro fixture schema");
    }
    if fixture.input_ids.len() < 3 || fixture.style.len() != 256 {
        bail!("invalid Kokoro fixture dimensions");
    }
    if fixture.expected_durations.len() != fixture.input_ids.len() {
        bail!("Kokoro fixture duration count does not match its input count");
    }
    Ok(())
}

fn arguments_from(args: impl IntoIterator<Item = String>) -> Result<Arguments> {
    let mut workspace = None;
    let mut memory_mode = RuntimeMemoryMode::Default;
    let mut args = args.into_iter();
    while let Some(argument) = args.next() {
        match argument.as_str() {
            "--workspace" => workspace = args.next().map(PathBuf::from),
            "--memory-mode" => {
                memory_mode = match args.next().as_deref() {
                    Some("default") => RuntimeMemoryMode::Default,
                    Some("bounded") => RuntimeMemoryMode::Bounded,
                    _ => bail!("memory mode must be 'default' or 'bounded'"),
                }
            }
            _ => bail!("unknown argument: {argument}"),
        }
    }
    let workspace = workspace.with_context(|| {
        "usage: sonelle-narration-runtime-spike --workspace <path> --memory-mode <default|bounded>"
    })?;
    Ok(Arguments {
        workspace,
        memory_mode,
    })
}

fn stage(name: &'static str, elapsed: Duration) -> StageMeasurement {
    StageMeasurement {
        name,
        elapsed_milliseconds: elapsed.as_millis(),
        resident_memory_kib: resident_memory_kib(),
    }
}

fn drop_stage<T>(name: &'static str, value: T) -> StageMeasurement {
    let started = Instant::now();
    drop(value);
    let elapsed = started.elapsed();
    settle();
    stage(name, elapsed)
}

fn settle() {
    thread::sleep(Duration::from_millis(500));
}

#[cfg(all(target_os = "linux", target_env = "gnu"))]
fn trim_allocator_stage(name: &'static str) -> StageMeasurement {
    let started = Instant::now();
    // This diagnostic distinguishes live engine memory from pages retained by glibc.
    unsafe {
        libc::malloc_trim(0);
    }
    let elapsed = started.elapsed();
    settle();
    stage(name, elapsed)
}

#[cfg(not(all(target_os = "linux", target_env = "gnu")))]
fn trim_allocator_stage(name: &'static str) -> StageMeasurement {
    stage(name, Duration::ZERO)
}

#[cfg(target_os = "linux")]
fn resident_memory_kib() -> Option<u64> {
    fs::read_to_string("/proc/self/status")
        .ok()?
        .lines()
        .find_map(|line| line.strip_prefix("VmRSS:"))?
        .split_whitespace()
        .next()?
        .parse()
        .ok()
}

#[cfg(not(target_os = "linux"))]
fn resident_memory_kib() -> Option<u64> {
    None
}

fn path_text(path: &Path) -> Result<&str> {
    path.to_str()
        .with_context(|| format!("path is not valid UTF-8: {}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::{arguments_from, RuntimeMemoryMode};
    use std::path::PathBuf;

    #[test]
    fn parses_one_explicit_workspace() {
        let arguments = arguments_from([
            "--workspace".to_owned(),
            "/tmp/sonelle-spike".to_owned(),
            "--memory-mode".to_owned(),
            "bounded".to_owned(),
        ])
        .expect("workspace argument should parse");

        assert_eq!(arguments.workspace, PathBuf::from("/tmp/sonelle-spike"));
        assert!(matches!(arguments.memory_mode, RuntimeMemoryMode::Bounded));
    }

    #[test]
    fn rejects_ambiguous_arguments() {
        assert!(arguments_from(["--workspace".to_owned()]).is_err());
        assert!(arguments_from([
            "--workspace".to_owned(),
            "/tmp/one".to_owned(),
            "--memory-mode".to_owned(),
            "wild-west".to_owned(),
        ])
        .is_err());
    }
}
