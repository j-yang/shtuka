//! RTF -> plain text rendering then line diff. Ported from internal/diff/rtf.go.

use crate::text::{build_text_result, TextResult};
use std::io;

pub fn rtf_diff(path_a: &str, path_b: &str) -> io::Result<TextResult> {
    let raw_a = read_maybe(path_a)?;
    let raw_b = read_maybe(path_b)?;
    let a = split_lines(&rtf_to_text(&raw_a));
    let b = split_lines(&rtf_to_text(&raw_b));
    Ok(build_text_result(path_a, path_b, a, b))
}

fn read_maybe(path: &str) -> io::Result<String> {
    if path.is_empty() {
        return Ok(String::new());
    }
    let bytes = std::fs::read(path)?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

fn split_lines(s: &str) -> Vec<String> {
    let s = s.replace("\r\n", "\n").replace('\r', "\n");
    if s.is_empty() {
        return Vec::new();
    }
    s.split('\n').map(|x| x.to_string()).collect()
}

fn is_ascii_letter(c: char) -> bool {
    c.is_ascii_alphabetic()
}

fn is_destination(word: &str) -> bool {
    matches!(
        word,
        "fonttbl" | "colortbl" | "stylesheet" | "info" | "pict" | "header" | "footer"
            | "listtable" | "listoverridetable" | "rsidtbl" | "generator" | "themedata"
            | "datastore" | "latentstyles"
    )
}

/// rtf_to_text strips RTF control words, groups and escapes, leaving plain text.
fn rtf_to_text(s: &str) -> String {
    let runes: Vec<char> = s.chars().collect();
    let n = runes.len();
    let mut out = String::new();

    let mut skip_depth: isize = -1;
    let mut depth: isize = 0;
    let mut i = 0usize;

    while i < n {
        let c = runes[i];
        match c {
            '{' => {
                depth += 1;
                i += 1;
            }
            '}' => {
                if skip_depth >= 0 && depth <= skip_depth {
                    skip_depth = -1;
                }
                depth -= 1;
                i += 1;
            }
            '\\' => {
                if i + 1 >= n {
                    i += 1;
                    continue;
                }
                let next = runes[i + 1];
                // Escaped literals.
                if next == '\\' || next == '{' || next == '}' {
                    if skip_depth < 0 {
                        out.push(next);
                    }
                    i += 2;
                    continue;
                }
                // \* marks an ignorable destination group.
                if next == '*' {
                    if skip_depth < 0 {
                        skip_depth = depth;
                    }
                    i += 2;
                    continue;
                }
                // \'hh hex escape.
                if next == '\'' && i + 3 < n {
                    let hex: String = runes[i + 2..i + 4].iter().collect();
                    if let Ok(v) = i64::from_str_radix(&hex, 16) {
                        if skip_depth < 0 {
                            if let Some(ch) = char::from_u32(v as u32) {
                                out.push(ch);
                            }
                        }
                    }
                    i += 4;
                    continue;
                }
                // Control word: letters then optional signed number.
                if is_ascii_letter(next) {
                    let mut j = i + 1;
                    while j < n && is_ascii_letter(runes[j]) {
                        j += 1;
                    }
                    let word: String = runes[i + 1..j].iter().collect();
                    // Optional numeric parameter.
                    let num_start = j;
                    if j < n && (runes[j] == '-' || runes[j].is_ascii_digit()) {
                        j += 1;
                        while j < n && runes[j].is_ascii_digit() {
                            j += 1;
                        }
                    }
                    let param: String = if j > num_start {
                        runes[num_start..j].iter().collect()
                    } else {
                        String::new()
                    };
                    // A single trailing space after a control word is a delimiter.
                    if j < n && runes[j] == ' ' {
                        j += 1;
                    }
                    apply_control_word(&word, &param, &mut skip_depth, depth, &mut out);
                    // After \uN, skip the ANSI fallback character (default \uc1).
                    if word == "u" && j < n {
                        j += 1;
                    }
                    i = j;
                    continue;
                }
                // Other control symbol (e.g. \~ \- \_); skip the symbol.
                i += 2;
            }
            _ => {
                if skip_depth < 0 {
                    out.push(c);
                }
                i += 1;
            }
        }
    }
    collapse_blank_lines(&out)
}

fn apply_control_word(word: &str, param: &str, skip_depth: &mut isize, depth: isize, out: &mut String) {
    if is_destination(word) && *skip_depth < 0 {
        *skip_depth = depth;
        return;
    }
    if *skip_depth >= 0 {
        return;
    }
    match word {
        "par" | "line" | "sect" | "page" => out.push('\n'),
        "tab" => out.push('\t'),
        "u" => {
            if let Ok(mut v) = param.parse::<i64>() {
                if v < 0 {
                    v += 65536;
                }
                if let Some(ch) = char::from_u32(v as u32) {
                    out.push(ch);
                }
            }
        }
        _ => {}
    }
}

/// collapse_blank_lines trims trailing whitespace per line and collapses runs of
/// 2+ blank lines into a single blank line.
fn collapse_blank_lines(s: &str) -> String {
    let s = s.replace('\r', "");
    let mut out: Vec<&str> = Vec::new();
    let mut blanks = 0;
    for line in s.split('\n') {
        let trimmed = line.trim_end_matches([' ', '\t']);
        if trimmed.is_empty() {
            blanks += 1;
            if blanks > 1 {
                continue;
            }
        } else {
            blanks = 0;
        }
        out.push(trimmed);
    }
    out.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_control_words_and_groups() {
        let rtf = r"{\rtf1\ansi{\fonttbl{\f0 Arial;}}\f0 Hello \b world\b0\par Line two\par}";
        let text = rtf_to_text(rtf);
        assert!(text.contains("Hello"), "got: {text:?}");
        assert!(text.contains("world"), "got: {text:?}");
        assert!(text.contains("Line two"), "got: {text:?}");
        assert!(!text.contains("fonttbl"), "destination leaked: {text:?}");
        assert!(!text.contains("Arial"), "font name leaked: {text:?}");
    }

    #[test]
    fn unicode_and_hex_escapes() {
        // \u233 = é, then \'41 = A
        let text = rtf_to_text(r"caf\u233 ?\par \'41 done");
        assert!(text.contains("caf\u{00e9}"), "unicode escape failed: {text:?}");
        assert!(text.contains("A done"), "hex escape failed: {text:?}");
    }
}
