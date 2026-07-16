use std::{
    collections::HashMap,
    panic::{catch_unwind, AssertUnwindSafe},
    sync::{Mutex, OnceLock},
};

use grapheme_to_phoneme::{GraphToPhoneError, Model as OovModel, PhonemeToken};
use misaki_rs::{Language, G2P};
use unicode_normalization::{char::is_combining_mark, UnicodeNormalization};

use crate::{error_log::record_native_error, kokoro_narration::KokoroSentencePhonemes};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KokoroEnglishDialect {
    American,
    British,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KokoroTextSentence {
    pub sentence_id: String,
    pub text: String,
}

static OOV_MODEL: OnceLock<Result<OovModel, String>> = OnceLock::new();
static OOV_PRONUNCIATIONS: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();

pub fn phonemize_kokoro_english_sentences(
    sentences: &[KokoroTextSentence],
    dialect: KokoroEnglishDialect,
) -> Result<Vec<KokoroSentencePhonemes>, String> {
    if sentences.is_empty() {
        return Err("English narration needs at least one sentence.".to_string());
    }

    let g2p = G2P::new(match dialect {
        KokoroEnglishDialect::American => Language::EnglishUS,
        KokoroEnglishDialect::British => Language::EnglishGB,
    });

    sentences
        .iter()
        .map(|sentence| phonemize_sentence(&g2p, sentence))
        .collect()
}

fn phonemize_sentence(
    g2p: &G2P,
    sentence: &KokoroTextSentence,
) -> Result<KokoroSentencePhonemes, String> {
    if sentence.text.trim().is_empty() {
        return Err("English narration input is invalid.".to_string());
    }

    let narration_text = join_intra_word_hyphens(&sentence.text);
    let (_, mut tokens) = g2p
        .g2p(&narration_text)
        .map_err(|_| "Sonelle couldn't prepare English narration text.".to_string())?;
    for token in &mut tokens {
        improve_token_pronunciation(g2p, token)?;
    }
    let phonemes = tokens
        .iter()
        .map(|token| token.phonemes.as_deref().unwrap_or("❓").to_string() + &token.whitespace)
        .collect::<String>()
        .trim()
        .to_string();
    if phonemes.is_empty() || phonemes.contains('❓') {
        return Err("English narration input is invalid.".to_string());
    }

    Ok(KokoroSentencePhonemes {
        sentence_id: sentence.sentence_id.clone(),
        phonemes,
    })
}

fn improve_token_pronunciation(g2p: &G2P, token: &mut misaki_rs::MToken) -> Result<(), String> {
    let word = token
        .text
        .trim_matches(|character: char| !character.is_alphabetic());
    if is_pronounceable_all_caps(word) {
        let lowercase_phonemes = lowercase_phonemes(g2p, word)
            .ok_or_else(|| "English narration input is invalid.".to_string())?;
        token.phonemes = Some(if is_character_spelling(&lowercase_phonemes) {
            predicted_or_fallback(word, lowercase_phonemes)
        } else {
            lowercase_phonemes
        });
    } else if should_predict_pronunciation(token) {
        let fallback = token.phonemes.clone().unwrap_or_default();
        token.phonemes = Some(predicted_or_fallback(word, fallback));
    }
    Ok(())
}

fn should_predict_pronunciation(token: &misaki_rs::MToken) -> bool {
    let word = token
        .text
        .trim_matches(|character: char| !character.is_alphabetic());
    if word.chars().count() < 2 || !word.chars().all(char::is_alphabetic) {
        return false;
    }
    token.phonemes.as_deref().is_some_and(is_character_spelling)
}

fn is_pronounceable_all_caps(word: &str) -> bool {
    word.chars().count() > 3
        && word.chars().all(char::is_uppercase)
        && word.chars().any(|character| "AEIOUY".contains(character))
}

fn lowercase_phonemes(g2p: &G2P, word: &str) -> Option<String> {
    let lowercase = word.to_lowercase();
    g2p.g2p(&lowercase)
        .ok()
        .and_then(|(_, tokens)| tokens.into_iter().next())
        .and_then(|token| token.phonemes)
        .map(|phonemes| phonemes.trim().to_string())
}

fn is_character_spelling(phonemes: &str) -> bool {
    // Misaki appends token whitespace before joining fallback letter pronunciations.
    phonemes.contains("  ")
}

fn predict_oov_phonemes(word: &str) -> Result<Option<String>, String> {
    let Some(normalized_word) = normalize_oov_model_word(word) else {
        return Ok(None);
    };
    let pronunciations = OOV_PRONUNCIATIONS.get_or_init(|| Mutex::new(HashMap::new()));
    if let Some(phonemes) = pronunciations
        .lock()
        .map_err(|_| "Sonelle couldn't open English pronunciation rules.".to_string())?
        .get(&normalized_word)
        .cloned()
    {
        return Ok(Some(phonemes));
    }

    let model = OOV_MODEL.get_or_init(|| {
        OovModel::load_in_memory()
            .map_err(|_| "Sonelle couldn't load English pronunciation rules.".to_string())
    });
    let model = model.as_ref().map_err(Clone::clone)?;
    let predicted = protected_oov_prediction(|| model.predict_phonemes(&normalized_word))?;
    let phonemes = predicted
        .iter()
        .filter_map(|token| match token {
            PhonemeToken::ArpabetPhoneme(_) => Some(arpabet_to_kokoro(token.to_str())),
            PhonemeToken::Token(_) => None,
        })
        .collect::<String>();

    if phonemes.is_empty() {
        return Err("Sonelle couldn't pronounce an English word.".to_string());
    }
    pronunciations
        .lock()
        .map_err(|_| "Sonelle couldn't open English pronunciation rules.".to_string())?
        .insert(normalized_word, phonemes.clone());
    Ok(Some(phonemes))
}

fn predicted_or_fallback(word: &str, fallback: String) -> String {
    predicted_or_fallback_with(word, fallback, predict_oov_phonemes, |error| {
        record_native_error("kokoro.pronunciation.fallback", error);
    })
}

fn predicted_or_fallback_with(
    word: &str,
    fallback: String,
    predict: impl FnOnce(&str) -> Result<Option<String>, String>,
    report: impl FnOnce(&str),
) -> String {
    match predict(word) {
        Ok(Some(phonemes)) => phonemes,
        Ok(None) => fallback,
        Err(error) => {
            report(&error);
            fallback
        }
    }
}

fn protected_oov_prediction(
    prediction: impl FnOnce() -> Result<Vec<PhonemeToken>, GraphToPhoneError>,
) -> Result<Vec<PhonemeToken>, String> {
    catch_unwind(AssertUnwindSafe(prediction))
        .map_err(|_| "English pronunciation rules stopped unexpectedly.".to_string())?
        .map_err(|_| "Sonelle couldn't pronounce an English word.".to_string())
}

fn normalize_oov_model_word(word: &str) -> Option<String> {
    let normalized = word
        .nfd()
        .filter(|character| !is_combining_mark(*character))
        .collect::<String>()
        .to_ascii_lowercase();
    (!normalized.is_empty()
        && normalized
            .chars()
            .all(|character| character.is_ascii_lowercase()))
    .then_some(normalized)
}

fn arpabet_to_kokoro(phoneme: &str) -> String {
    let (base, stress) = phoneme
        .strip_suffix('0')
        .map(|base| (base, None))
        .or_else(|| phoneme.strip_suffix('1').map(|base| (base, Some('ˈ'))))
        .or_else(|| phoneme.strip_suffix('2').map(|base| (base, Some('ˌ'))))
        .unwrap_or((phoneme, None));
    let sound = match base {
        "AA" => "ɑ",
        "AE" => "æ",
        "AH" if stress.is_none() => "ə",
        "AH" => "ʌ",
        "AO" => "ɔ",
        "AW" => "aʊ",
        "AX" => "ə",
        "AXR" | "ER" => "ɜ",
        "AY" => "aɪ",
        "EH" => "ɛ",
        "EY" => "eɪ",
        "IH" | "IX" => "ɪ",
        "IY" => "i",
        "OW" => "oʊ",
        "OY" => "ɔɪ",
        "UH" => "ʊ",
        "UW" | "UX" => "u",
        "B" => "b",
        "CH" => "ʧ",
        "D" => "d",
        "DH" => "ð",
        "DX" => "ɾ",
        "EL" => "l",
        "EM" => "m",
        "EN" | "NX" => "n",
        "F" => "f",
        "G" => "ɡ",
        "HH" => "h",
        "JH" => "ʤ",
        "K" => "k",
        "L" => "l",
        "M" => "m",
        "N" => "n",
        "NG" => "ŋ",
        "P" => "p",
        "Q" => "ʔ",
        "R" => "ɹ",
        "S" => "s",
        "SH" => "ʃ",
        "T" => "t",
        "TH" => "θ",
        "V" => "v",
        "W" | "WH" => "w",
        "Y" => "j",
        "Z" => "z",
        "ZH" => "ʒ",
        _ => "",
    };
    stress.map_or_else(|| sound.to_string(), |marker| format!("{marker}{sound}"))
}

fn join_intra_word_hyphens(text: &str) -> String {
    let characters = text.chars().collect::<Vec<_>>();
    let mut joined = String::with_capacity(text.len());
    for (index, character) in characters.iter().enumerate() {
        let between_letters = index > 0
            && index + 1 < characters.len()
            && characters[index - 1].is_alphabetic()
            && characters[index + 1].is_alphabetic();
        let is_hyphen = matches!(character, '-' | '‐' | '‑' | '‒' | '–' | '−');
        if !(between_letters && is_hyphen) {
            joined.push(*character);
        }
    }
    joined
}

#[cfg(test)]
mod tests {
    use std::panic::{catch_unwind, AssertUnwindSafe};

    use grapheme_to_phoneme::{GraphToPhoneError, PhonemeToken};
    use misaki_rs::{Language, G2P};

    use super::{
        phonemize_kokoro_english_sentences, predicted_or_fallback_with, protected_oov_prediction,
        KokoroEnglishDialect, KokoroTextSentence,
    };

    #[test]
    fn phonemizes_english_sentences_for_kokoro() {
        let phonemes = phonemize_kokoro_english_sentences(
            &[
                sentence(
                    "sentence-1",
                    "Sonelle keeps narration aligned with the text.",
                ),
                sentence("sentence-2", "Chapter fourteen starts here."),
            ],
            KokoroEnglishDialect::American,
        )
        .expect("English sentences should phonemize");

        assert_eq!(phonemes.len(), 2);
        assert_eq!(phonemes[0].sentence_id, "sentence-1");
        assert_eq!(phonemes[1].sentence_id, "sentence-2");
        assert!(phonemes
            .iter()
            .all(|sentence| !sentence.phonemes.is_empty()));
        assert!(phonemes
            .iter()
            .all(|sentence| !sentence.phonemes.contains('❓')));
    }

    #[test]
    fn supports_british_english_phonemization() {
        let phonemes = phonemize_kokoro_english_sentences(
            &[sentence("sentence-1", "The schedule is full.")],
            KokoroEnglishDialect::British,
        )
        .expect("British English should phonemize");

        assert_eq!(phonemes[0].sentence_id, "sentence-1");
        assert!(!phonemes[0].phonemes.is_empty());
    }

    #[test]
    fn rejects_empty_sentence_text() {
        let error = phonemize_kokoro_english_sentences(
            &[sentence("sentence-1", "   ")],
            KokoroEnglishDialect::American,
        )
        .expect_err("empty sentence should fail");

        assert_eq!(error, "English narration input is invalid.");
    }

    #[test]
    fn rejects_unknown_phoneme_output() {
        let error = phonemize_kokoro_english_sentences(
            &[sentence("sentence-1", "🎉")],
            KokoroEnglishDialect::American,
        )
        .expect_err("unknown phoneme marker should fail");

        assert_eq!(error, "English narration input is invalid.");
    }

    #[test]
    fn keeps_hyphenated_compounds_in_one_spoken_phrase() {
        let phonemes = phonemes_for("trade-offs");

        assert!(
            !phonemes.contains(' '),
            "hyphenated compounds must not gain an internal pause: {phonemes}"
        );
        assert_eq!(phonemes, phonemes_for("trade‑offs"));
    }

    #[test]
    fn reads_emphasized_words_like_their_normally_cased_form() {
        assert_eq!(phonemes_for("POLITICAL"), phonemes_for("political"));
    }

    #[test]
    fn predicts_unknown_names_instead_of_spelling_each_letter() {
        let phonemes = phonemes_for("Kaczynski");

        assert!(
            !phonemes.contains(' '),
            "unknown names must receive a word pronunciation: {phonemes}"
        );
        assert_eq!(phonemes, phonemes_for("KACZYNSKI"));
    }

    #[test]
    fn phonemizes_accented_names_without_panicking() {
        let phonemes = phonemes_for("Simón");

        assert!(!phonemes.is_empty());
        assert!(!phonemes.contains(' '));
    }

    #[test]
    fn phonemizes_name_heavy_book_text_without_panicking() {
        let phonemes = phonemize_kokoro_english_sentences(
            &[
                sentence(
                    "sentence-1",
                    "This was clearly the attitude of Simón Bolívar.",
                ),
                sentence(
                    "sentence-2",
                    "Carsun Chang and Chang Chun-Mai discussed the Kuomintang.",
                ),
            ],
            KokoroEnglishDialect::American,
        )
        .expect("book text with names should phonemize");

        assert_eq!(phonemes.len(), 2);
        assert!(phonemes
            .iter()
            .all(|sentence| !sentence.phonemes.is_empty()));
    }

    #[test]
    fn contains_third_party_pronunciation_panics() {
        let error = protected_oov_prediction(|| -> Result<Vec<PhonemeToken>, GraphToPhoneError> {
            panic!("simulated predictor panic")
        })
        .expect_err("predictor panic should become a recoverable error");

        assert_eq!(error, "English pronunciation rules stopped unexpectedly.");
    }

    #[test]
    fn keeps_existing_pronunciation_when_prediction_fails() {
        let mut reported = None;
        let phonemes = predicted_or_fallback_with(
            "example",
            "fallback pronunciation".to_string(),
            |_| Err("simulated prediction failure".to_string()),
            |error| reported = Some(error.to_string()),
        );

        assert_eq!(phonemes, "fallback pronunciation");
        assert_eq!(reported.as_deref(), Some("simulated prediction failure"));
    }

    #[test]
    fn contains_japanese_names_inside_english_text() {
        assert_non_latin_name_is_contained("The author is 村上春樹.");
    }

    #[test]
    fn contains_chinese_names_inside_english_text() {
        assert_non_latin_name_is_contained("The philosopher is 孔子.");
    }

    #[test]
    fn contains_cyrillic_names_inside_english_text() {
        assert_non_latin_name_is_contained("The character is Татьяна.");
    }

    #[test]
    fn preserves_short_initialisms() {
        let phonemes = phonemes_for("FBI");
        let raw = G2P::new(Language::EnglishUS)
            .g2p("FBI")
            .expect("initialism should phonemize")
            .0
            .trim()
            .to_string();

        assert_eq!(phonemes, raw);
    }

    fn phonemes_for(text: &str) -> String {
        phonemize_kokoro_english_sentences(
            &[sentence("sentence-1", text)],
            KokoroEnglishDialect::American,
        )
        .expect("fixture should phonemize")[0]
            .phonemes
            .clone()
    }

    fn assert_non_latin_name_is_contained(text: &str) {
        let outcome = catch_unwind(AssertUnwindSafe(|| {
            phonemize_kokoro_english_sentences(
                &[sentence("sentence-1", text)],
                KokoroEnglishDialect::American,
            )
        }));
        let result = outcome.expect("non-Latin names must not unwind narration preparation");

        match result {
            Ok(sentences) => {
                assert_eq!(sentences.len(), 1);
                assert!(!sentences[0].phonemes.is_empty());
                assert!(!sentences[0].phonemes.contains('❓'));
            }
            Err(error) => {
                assert!(!error.is_empty());
                assert!(!error.contains("collapse_axis"));
                assert!(!error.contains("array with shape"));
            }
        }
    }

    fn sentence(sentence_id: &str, text: &str) -> KokoroTextSentence {
        KokoroTextSentence {
            sentence_id: sentence_id.to_string(),
            text: text.to_string(),
        }
    }
}
