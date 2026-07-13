use std::{collections::BTreeMap, fs, path::Path};

use ndarray::{Array1, Array2};
use ort::{session::Session, value::Value};
use serde::Deserialize;

use crate::narration_cache::NarrationSentenceSpan;

pub const KOKORO_SAMPLE_RATE: u32 = 24_000;
const KOKORO_SAMPLES_PER_DURATION_UNIT: u64 = 600;

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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KokoroSentencePhonemes {
    pub sentence_id: String,
    pub phonemes: String,
}

#[derive(Debug, Clone)]
pub struct KokoroPreparedPassage {
    pub input: KokoroPreparedInput,
    pub sentence_ids: Vec<String>,
    pub sentence_token_counts: Vec<usize>,
}

#[derive(Debug, Deserialize)]
struct KokoroConfig {
    vocab: BTreeMap<String, i64>,
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

pub fn prepare_kokoro_input_from_phonemes(
    config_path: &Path,
    voice_path: &Path,
    phonemes: &str,
    speed: i32,
) -> Result<KokoroPreparedInput, String> {
    let config = load_kokoro_config(config_path)?;
    let mut input_ids = phonemes_to_input_ids(&config, phonemes);
    if input_ids.is_empty() {
        return Err("English narration input is invalid.".to_string());
    }
    if input_ids.len() + 2 > 512 {
        return Err("English narration input is too long.".to_string());
    }

    let style = load_kokoro_voice_style(voice_path, input_ids.len())?;
    input_ids.insert(0, 0);
    input_ids.push(0);

    Ok(KokoroPreparedInput {
        input_ids,
        style,
        speed,
    })
}

pub fn prepare_kokoro_passage_from_sentence_phonemes(
    config_path: &Path,
    voice_path: &Path,
    sentences: &[KokoroSentencePhonemes],
    speed: i32,
) -> Result<KokoroPreparedPassage, String> {
    if sentences.is_empty() {
        return Err("English narration needs at least one sentence.".to_string());
    }

    let config = load_kokoro_config(config_path)?;
    let mut input_ids = Vec::new();
    let mut sentence_ids = Vec::with_capacity(sentences.len());
    let mut sentence_token_counts = Vec::with_capacity(sentences.len());

    for sentence in sentences {
        let sentence_input_ids = phonemes_to_input_ids(&config, &sentence.phonemes);
        if sentence_input_ids.is_empty() {
            return Err("English narration input is invalid.".to_string());
        }

        sentence_ids.push(sentence.sentence_id.clone());
        sentence_token_counts.push(sentence_input_ids.len());
        input_ids.extend(sentence_input_ids);
    }

    if input_ids.len() + 2 > 512 {
        return Err("English narration input is too long.".to_string());
    }

    let style = load_kokoro_voice_style(voice_path, input_ids.len())?;
    input_ids.insert(0, 0);
    input_ids.push(0);

    Ok(KokoroPreparedPassage {
        input: KokoroPreparedInput {
            input_ids,
            style,
            speed,
        },
        sentence_ids,
        sentence_token_counts,
    })
}

pub fn project_kokoro_sentence_spans(
    passage: &KokoroPreparedPassage,
    sample_count: u64,
    durations: &[i64],
) -> Result<Vec<NarrationSentenceSpan>, String> {
    if sample_count == 0 || passage.sentence_ids.is_empty() {
        return Err("English narration returned invalid audio.".to_string());
    }
    if passage.input.input_ids.len() != durations.len() {
        return Err("English narration timing did not match the input.".to_string());
    }
    if passage.sentence_ids.len() != passage.sentence_token_counts.len() {
        return Err("English narration timing did not match the input.".to_string());
    }

    let duration_units = durations
        .iter()
        .map(|duration| {
            u64::try_from(*duration)
                .map_err(|_| "English narration returned invalid timing.".to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;
    let duration_sample_count = duration_units
        .iter()
        .try_fold(0_u64, |total, duration| {
            total
                .checked_add(*duration)
                .ok_or_else(|| "Prepared narration audio is too large.".to_string())
        })?
        .checked_mul(KOKORO_SAMPLES_PER_DURATION_UNIT)
        .ok_or_else(|| "Prepared narration audio is too large.".to_string())?;
    if duration_sample_count != sample_count {
        return Err("English narration timing did not match the audio.".to_string());
    }

    let mut token_cursor = 1_usize;
    let mut start_sample = 0_u64;
    let mut spans = Vec::with_capacity(passage.sentence_ids.len());
    for (index, sentence_id) in passage.sentence_ids.iter().enumerate() {
        let token_count = passage.sentence_token_counts[index];
        let token_end = token_cursor
            .checked_add(token_count)
            .ok_or_else(|| "Prepared narration audio is too large.".to_string())?;
        if token_end > duration_units.len().saturating_sub(1) {
            return Err("English narration timing did not match the input.".to_string());
        }

        let mut sentence_units =
            duration_units[token_cursor..token_end]
                .iter()
                .try_fold(0_u64, |total, duration| {
                    total
                        .checked_add(*duration)
                        .ok_or_else(|| "Prepared narration audio is too large.".to_string())
                })?;
        if index == 0 {
            sentence_units = sentence_units
                .checked_add(duration_units[0])
                .ok_or_else(|| "Prepared narration audio is too large.".to_string())?;
        }
        if index + 1 == passage.sentence_ids.len() {
            sentence_units = sentence_units
                .checked_add(*duration_units.last().unwrap_or(&0))
                .ok_or_else(|| "Prepared narration audio is too large.".to_string())?;
        }

        let end_sample = if index + 1 == passage.sentence_ids.len() {
            sample_count
        } else {
            start_sample
                .checked_add(
                    sentence_units
                        .checked_mul(KOKORO_SAMPLES_PER_DURATION_UNIT)
                        .ok_or_else(|| "Prepared narration audio is too large.".to_string())?,
                )
                .ok_or_else(|| "Prepared narration audio is too large.".to_string())?
        };
        if end_sample <= start_sample || end_sample > sample_count {
            return Err("English narration returned invalid timing.".to_string());
        }

        spans.push(NarrationSentenceSpan {
            sentence_id: sentence_id.clone(),
            start_sample,
            end_sample,
        });
        start_sample = end_sample;
        token_cursor = token_end;
    }

    if token_cursor + 1 != duration_units.len() || start_sample != sample_count {
        return Err("English narration timing did not match the input.".to_string());
    }

    Ok(spans)
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

fn load_kokoro_config(config_path: &Path) -> Result<KokoroConfig, String> {
    let bytes = fs::read(config_path)
        .map_err(|_| "Sonelle couldn't open English narration files.".to_string())?;
    serde_json::from_slice(&bytes).map_err(|_| "English narration files are invalid.".to_string())
}

fn phonemes_to_input_ids(config: &KokoroConfig, phonemes: &str) -> Vec<i64> {
    phonemes
        .chars()
        .filter_map(|phoneme| config.vocab.get(&phoneme.to_string()).copied())
        .collect()
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
        load_kokoro_voice_style, prepare_kokoro_input_from_phonemes,
        prepare_kokoro_passage_from_sentence_phonemes, project_kokoro_sentence_spans,
        render_kokoro_prepared_input, KokoroPreparedInput, KokoroSentencePhonemes,
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
        write_voice_fixture(&voice_path, &[1.0, 2.0]);

        let first = load_kokoro_voice_style(&voice_path, 1).expect("first style should load");
        let second = load_kokoro_voice_style(&voice_path, 2).expect("second style should load");
        let clamped = load_kokoro_voice_style(&voice_path, 99).expect("last style should load");

        assert_eq!(first, vec![1.0; 256]);
        assert_eq!(second, vec![2.0; 256]);
        assert_eq!(clamped, vec![2.0; 256]);
    }

    #[test]
    fn prepares_model_input_from_phonemes_and_voice_style() {
        let root = tempfile_root("kokoro-input");
        let config_path = root.join("config.json");
        let voice_path = root.join("voice.bin");
        fs::write(&config_path, r#"{"vocab":{"a":7,"b":8}}"#).expect("config fixture should write");
        write_voice_fixture(&voice_path, &[1.0, 2.0]);

        let input = prepare_kokoro_input_from_phonemes(&config_path, &voice_path, "ab", 1)
            .expect("prepared input should build");

        assert_eq!(input.input_ids, vec![0, 7, 8, 0]);
        assert_eq!(input.style, vec![2.0; 256]);
        assert_eq!(input.speed, 1);
    }

    #[test]
    fn prepares_passage_input_from_sentence_phonemes() {
        let root = tempfile_root("kokoro-passage-input");
        let config_path = root.join("config.json");
        let voice_path = root.join("voice.bin");
        fs::write(&config_path, r#"{"vocab":{"a":7,"b":8,"c":9}}"#)
            .expect("config fixture should write");
        write_voice_fixture(&voice_path, &[1.0, 2.0, 3.0]);

        let passage = prepare_kokoro_passage_from_sentence_phonemes(
            &config_path,
            &voice_path,
            &[
                sentence_phonemes("sentence-1", "ab"),
                sentence_phonemes("sentence-2", "c"),
            ],
            1,
        )
        .expect("passage input should build");

        assert_eq!(passage.input.input_ids, vec![0, 7, 8, 9, 0]);
        assert_eq!(
            passage.sentence_ids,
            vec!["sentence-1".to_string(), "sentence-2".to_string()]
        );
        assert_eq!(passage.sentence_token_counts, vec![2, 1]);
        assert_eq!(passage.input.style, vec![3.0; 256]);
    }

    #[test]
    fn rejects_sentence_phonemes_without_known_vocab_entries() {
        let root = tempfile_root("kokoro-empty-sentence-input");
        let config_path = root.join("config.json");
        let voice_path = root.join("voice.bin");
        fs::write(&config_path, r#"{"vocab":{"a":7}}"#).expect("config fixture should write");
        write_voice_fixture(&voice_path, &[1.0]);

        let error = prepare_kokoro_passage_from_sentence_phonemes(
            &config_path,
            &voice_path,
            &[
                sentence_phonemes("sentence-1", "a"),
                sentence_phonemes("sentence-2", "zz"),
            ],
            1,
        )
        .expect_err("sentence without model input should fail");

        assert_eq!(error, "English narration input is invalid.");
    }

    #[test]
    fn projects_kokoro_durations_to_sentence_spans() {
        let passage = prepared_passage_for_projection();
        let spans = project_kokoro_sentence_spans(&passage, 7 * 600, &[1, 1, 1, 4, 0])
            .expect("sentence spans should project");

        assert_eq!(spans.len(), 2);
        assert_eq!(spans[0].sentence_id, "sentence-1");
        assert_eq!(spans[0].start_sample, 0);
        assert_eq!(spans[0].end_sample, 3 * 600);
        assert_eq!(spans[1].sentence_id, "sentence-2");
        assert_eq!(spans[1].start_sample, 3 * 600);
        assert_eq!(spans[1].end_sample, 7 * 600);
    }

    #[test]
    fn projects_final_padding_to_the_last_sentence() {
        let passage = prepared_passage_for_projection();
        let spans = project_kokoro_sentence_spans(&passage, 8 * 600, &[1, 1, 1, 4, 1])
            .expect("sentence spans should project");

        assert_eq!(spans[0].end_sample, 3 * 600);
        assert_eq!(spans[1].start_sample, 3 * 600);
        assert_eq!(spans[1].end_sample, 8 * 600);
    }

    #[test]
    fn rejects_kokoro_durations_that_do_not_match_audio_length() {
        let passage = prepared_passage_for_projection();
        let error = project_kokoro_sentence_spans(&passage, 8 * 600, &[1, 1, 1, 4, 0])
            .expect_err("mismatched duration samples should fail");

        assert_eq!(error, "English narration timing did not match the audio.");
    }

    #[test]
    fn rejects_phonemes_without_known_vocab_entries() {
        let root = tempfile_root("kokoro-empty-input");
        let config_path = root.join("config.json");
        let voice_path = root.join("voice.bin");
        fs::write(&config_path, r#"{"vocab":{"a":7}}"#).expect("config fixture should write");
        write_voice_fixture(&voice_path, &[1.0]);

        let error = prepare_kokoro_input_from_phonemes(&config_path, &voice_path, "zz", 1)
            .expect_err("empty mapped input should fail");

        assert_eq!(error, "English narration input is invalid.");
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

    fn write_voice_fixture(path: &PathBuf, rows: &[f32]) {
        let mut bytes = Vec::new();
        for value in rows {
            for _ in 0..256 {
                bytes.extend_from_slice(&value.to_le_bytes());
            }
        }
        fs::write(path, bytes).expect("voice fixture should write");
    }

    fn sentence_phonemes(sentence_id: &str, phonemes: &str) -> KokoroSentencePhonemes {
        KokoroSentencePhonemes {
            sentence_id: sentence_id.to_string(),
            phonemes: phonemes.to_string(),
        }
    }

    fn prepared_passage_for_projection() -> super::KokoroPreparedPassage {
        super::KokoroPreparedPassage {
            input: KokoroPreparedInput {
                input_ids: vec![0, 7, 8, 9, 0],
                style: vec![1.0; 256],
                speed: 1,
            },
            sentence_ids: vec!["sentence-1".to_string(), "sentence-2".to_string()],
            sentence_token_counts: vec![2, 1],
        }
    }
}
