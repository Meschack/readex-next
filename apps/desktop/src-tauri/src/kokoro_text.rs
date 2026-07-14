use misaki_rs::{Language, G2P};

use crate::kokoro_narration::KokoroSentencePhonemes;

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

    let (phonemes, _) = g2p
        .g2p(&sentence.text)
        .map_err(|_| "Sonelle couldn't prepare English narration text.".to_string())?;
    let phonemes = phonemes.trim().to_string();
    if phonemes.is_empty() || phonemes.contains('❓') {
        return Err("English narration input is invalid.".to_string());
    }

    Ok(KokoroSentencePhonemes {
        sentence_id: sentence.sentence_id.clone(),
        phonemes,
    })
}

#[cfg(test)]
mod tests {
    use super::{phonemize_kokoro_english_sentences, KokoroEnglishDialect, KokoroTextSentence};

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

    fn sentence(sentence_id: &str, text: &str) -> KokoroTextSentence {
        KokoroTextSentence {
            sentence_id: sentence_id.to_string(),
            text: text.to_string(),
        }
    }
}
