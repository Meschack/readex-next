use std::{fs, path::Path};

use ndarray::{Array1, Array2};
use ort::{session::Session, value::Value};

pub const KOKORO_SAMPLE_RATE: u32 = 24_000;

#[derive(Debug, Clone)]
pub struct KokoroPreparedInput {
    pub input_ids: Vec<i64>,
    pub style: Vec<f32>,
    pub speed: i32,
}

#[derive(Debug, PartialEq)]
pub struct KokoroInferenceOutput {
    pub samples: Vec<f32>,
    pub durations: Vec<i64>,
}

pub fn render_kokoro_prepared_input(
    model_path: &Path,
    input: &KokoroPreparedInput,
) -> Result<KokoroInferenceOutput, String> {
    validate_prepared_input(input)?;
    let mut session = Session::builder()
        .map_err(|_| "Sonelle couldn't start English narration.".to_string())?
        .commit_from_file(model_path)
        .map_err(|_| "Sonelle couldn't open English narration files.".to_string())?;

    run_kokoro_session(&mut session, input)
}

pub fn load_kokoro_voice_style(
    voice_path: &Path,
    phoneme_count: usize,
) -> Result<Vec<f32>, String> {
    if phoneme_count == 0 {
        return Err("English narration input is invalid.".to_string());
    }

    let bytes = fs::read(voice_path)
        .map_err(|_| "Sonelle couldn't open the selected English narration voice.".to_string())?;
    let row_bytes = 256 * 4;
    if bytes.len() < row_bytes || bytes.len() % row_bytes != 0 {
        return Err("English narration voice is invalid.".to_string());
    }

    let style_count = bytes.len() / row_bytes;
    let style_index = phoneme_count.saturating_sub(1).min(style_count - 1);
    let start = style_index * row_bytes;
    let row = &bytes[start..start + row_bytes];

    Ok(row
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect())
}

fn run_kokoro_session(
    session: &mut Session,
    input: &KokoroPreparedInput,
) -> Result<KokoroInferenceOutput, String> {
    let input_ids = Array2::from_shape_vec((1, input.input_ids.len()), input.input_ids.clone())
        .map_err(|_| "English narration input is invalid.".to_string())?;
    let style = Array2::from_shape_vec((1, input.style.len()), input.style.clone())
        .map_err(|_| "English narration voice is invalid.".to_string())?;
    let speed = Array1::from_vec(vec![input.speed]);
    let input_ids = Value::from_array(input_ids)
        .map_err(|_| "English narration input is invalid.".to_string())?;
    let style =
        Value::from_array(style).map_err(|_| "English narration voice is invalid.".to_string())?;
    let speed =
        Value::from_array(speed).map_err(|_| "English narration speed is invalid.".to_string())?;

    let outputs = session
        .run(ort::inputs! {
            "input_ids" => &input_ids,
            "style" => &style,
            "speed" => &speed,
        })
        .map_err(|_| "Sonelle couldn't prepare this English narration.".to_string())?;
    let (_, samples) = outputs["waveform"]
        .try_extract_tensor::<f32>()
        .map_err(|_| "English narration returned invalid audio.".to_string())?;
    let (_, durations) = outputs["duration"]
        .try_extract_tensor::<i64>()
        .map_err(|_| "English narration returned invalid timing.".to_string())?;
    let durations = durations.to_vec();
    if durations.len() != input.input_ids.len() {
        return Err("English narration timing did not match the input.".to_string());
    }

    Ok(KokoroInferenceOutput {
        samples: samples.to_vec(),
        durations,
    })
}

fn validate_prepared_input(input: &KokoroPreparedInput) -> Result<(), String> {
    if input.input_ids.len() < 3 || input.input_ids.len() > 512 {
        return Err("English narration input is too long.".to_string());
    }
    if input.style.len() != 256 {
        return Err("English narration voice is invalid.".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::{
        env, fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    use serde::Deserialize;

    use super::{
        load_kokoro_voice_style, render_kokoro_prepared_input, KokoroPreparedInput,
        KOKORO_SAMPLE_RATE,
    };

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct KokoroFixture {
        schema_version: u32,
        input_ids: Vec<i64>,
        style: Vec<f32>,
        speed: i32,
        expected_durations: Vec<i64>,
        expected_waveform_samples: usize,
    }

    #[test]
    fn rejects_invalid_prepared_input_dimensions() {
        let error = super::validate_prepared_input(&KokoroPreparedInput {
            input_ids: vec![0, 1],
            style: vec![0.0; 256],
            speed: 1,
        })
        .expect_err("short input should fail");

        assert_eq!(error, "English narration input is too long.");
    }

    #[test]
    fn loads_voice_style_for_the_prepared_phoneme_length() {
        let root = tempfile_root("kokoro-style");
        let voice_path = root.join("voice.bin");
        let mut bytes = Vec::new();
        for value in [1.0_f32, 2.0] {
            for _ in 0..256 {
                bytes.extend_from_slice(&value.to_le_bytes());
            }
        }
        fs::write(&voice_path, bytes).expect("voice fixture should write");

        let first = load_kokoro_voice_style(&voice_path, 1).expect("first style should load");
        let second = load_kokoro_voice_style(&voice_path, 2).expect("second style should load");
        let clamped = load_kokoro_voice_style(&voice_path, 99).expect("last style should load");

        assert_eq!(first, vec![1.0; 256]);
        assert_eq!(second, vec![2.0; 256]);
        assert_eq!(clamped, vec![2.0; 256]);
    }

    #[test]
    fn rejects_invalid_voice_style_files() {
        let root = tempfile_root("kokoro-invalid-style");
        let voice_path = root.join("voice.bin");
        fs::write(&voice_path, [1_u8, 2, 3]).expect("voice fixture should write");

        let error = load_kokoro_voice_style(&voice_path, 1).expect_err("invalid file should fail");

        assert_eq!(error, "English narration voice is invalid.");
    }

    #[ignore = "runs the real Kokoro ONNX runtime against local spike assets"]
    #[test]
    fn renders_real_kokoro_audio_from_local_fixture() {
        let root = env::var("SONELLE_KOKORO_FIXTURE_ROOT")
            .map(PathBuf::from)
            .unwrap_or_else(|_| {
                [
                    PathBuf::from(".sonelle/narration-spike"),
                    PathBuf::from("../../.sonelle/narration-spike"),
                    PathBuf::from("../../../.sonelle/narration-spike"),
                ]
                .into_iter()
                .find(|candidate| {
                    candidate
                        .join("results/kokoro/native-fixture.json")
                        .is_file()
                })
                .expect("local Kokoro fixture should exist")
            });
        let fixture_path = root.join("results/kokoro/native-fixture.json");
        let model_path = root.join("kokoro-onnx/kokoro.onnx");
        let fixture: KokoroFixture =
            serde_json::from_slice(&fs::read(&fixture_path).expect("fixture should be readable"))
                .expect("fixture should parse");
        assert_eq!(fixture.schema_version, 1);

        let rendered = render_kokoro_prepared_input(
            &model_path,
            &KokoroPreparedInput {
                input_ids: fixture.input_ids,
                style: fixture.style,
                speed: fixture.speed,
            },
        )
        .expect("Kokoro fixture should render");

        assert_eq!(KOKORO_SAMPLE_RATE, 24_000);
        assert_eq!(rendered.samples.len(), fixture.expected_waveform_samples);
        assert_eq!(rendered.durations, fixture.expected_durations);
    }

    fn tempfile_root(name: &str) -> PathBuf {
        let root = env::temp_dir().join(format!(
            "sonelle-{name}-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("time should move forward")
                .as_nanos()
        ));
        fs::create_dir_all(&root).expect("temp root should exist");
        root
    }
}
