pub fn normalize_reader_text(input: &str) -> String {
    input
        .replace('\u{00a0}', " ")
        .replace('\u{00ad}', "")
        .replace(['\u{200b}', '\u{200c}', '\u{200d}', '\u{feff}'], "")
        .replace(['“', '”'], "\"")
        .replace(['‘', '’'], "'")
        .replace(['‐', '‑', '‒', '–', '—'], "-")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string()
}

pub fn segment_sentences(input: &str) -> Vec<String> {
    let normalized = normalize_reader_text(input);
    let mut sentences = Vec::new();
    let mut start = 0;
    let chars: Vec<(usize, char)> = normalized.char_indices().collect();

    for (char_index, (_, character)) in chars.iter().enumerate() {
        if !matches!(character, '.' | '!' | '?' | '"' | '\'' | ')' | ']') {
            continue;
        }

        let Some((next_byte_index, next_character)) = chars.get(char_index + 1) else {
            continue;
        };

        if !next_character.is_whitespace() {
            continue;
        }

        let Some((_, lookahead)) = chars
            .iter()
            .skip(char_index + 2)
            .find(|(_, value)| !value.is_whitespace())
        else {
            continue;
        };

        if !lookahead.is_uppercase()
            && !lookahead.is_ascii_digit()
            && !matches!(lookahead, '"' | '\'' | '(')
        {
            continue;
        }

        let sentence = normalized[start..*next_byte_index].trim();
        if !sentence.is_empty() {
            sentences.push(sentence.to_string());
        }
        start = *next_byte_index;
    }

    let tail = normalized[start..].trim();
    if !tail.is_empty() {
        sentences.push(tail.to_string());
    }

    sentences
}

#[cfg(test)]
mod tests {
    use super::{normalize_reader_text, segment_sentences};

    #[test]
    fn normalizes_reader_text() {
        assert_eq!(
            normalize_reader_text("“Hello”\u{00a0}reader — line."),
            "\"Hello\" reader - line."
        );
    }

    #[test]
    fn segments_sentences_for_playback() {
        assert_eq!(
            segment_sentences("First sentence. Second sentence follows."),
            vec!["First sentence.", "Second sentence follows."]
        );
    }
}
