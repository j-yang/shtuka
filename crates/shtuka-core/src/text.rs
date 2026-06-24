//! Plain-text line diff. Ported from internal/diff/text.go.

use crate::myers::{diff, Op, OpType, Seg};
use serde::{Deserialize, Serialize};
use std::io;

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct TextSummary {
    pub equal: usize,
    pub insert: usize,
    pub delete: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TextResult {
    #[serde(rename = "fileType")]
    pub file_type: String,
    #[serde(rename = "pathA")]
    pub path_a: String,
    #[serde(rename = "pathB")]
    pub path_b: String,
    pub ops: Vec<Op>,
    pub summary: TextSummary,
}

pub fn text_diff(path_a: &str, path_b: &str) -> io::Result<TextResult> {
    let a = read_lines(path_a)?;
    let b = read_lines(path_b)?;
    Ok(build_text_result(path_a, path_b, a, b))
}

/// build_text_result diffs two already-loaded line slices and tallies the
/// summary. Shared by the text, rtf and pdf handlers.
pub fn build_text_result(path_a: &str, path_b: &str, a: Vec<String>, b: Vec<String>) -> TextResult {
    let raw = diff(&a, &b);
    let ops = pair_replacements(raw);
    let mut summary = TextSummary::default();
    for op in &ops {
        match op.typ {
            OpType::Equal => summary.equal += 1,
            OpType::Insert => summary.insert += 1,
            OpType::Delete => summary.delete += 1,
            // A Replace stands in for one delete + one insert.
            OpType::Replace => {
                summary.delete += 1;
                summary.insert += 1;
            }
        }
    }
    TextResult {
        file_type: "text".into(),
        path_a: path_a.into(),
        path_b: path_b.into(),
        ops,
        summary,
    }
}

/// Lines whose changed fraction is at or below this are paired as Replace rows
/// (modified-in-place) rather than shown as a full delete + insert. 0.5 means
/// "at least half the characters are shared between the two lines".
const SIMILARITY: f64 = 0.5;

/// pair_replacements post-processes the raw LCS edit script: within each run of
/// deletes-then-inserts, it pairs lines that are similar enough into a single
/// Replace row carrying inline char-level segments. This turns "page 17 → page
/// 18" from a noisy delete+insert pair into one modified row that highlights
/// only the digit that changed — the key to a readable diff.
pub(crate) fn pair_replacements(ops: Vec<Op>) -> Vec<Op> {
    let mut out: Vec<Op> = Vec::with_capacity(ops.len());
    let mut i = 0;
    while i < ops.len() {
        // Equal/Replace pass through.
        if ops[i].typ == OpType::Equal {
            out.push(ops[i].clone());
            i += 1;
            continue;
        }
        // Collect a maximal block of consecutive deletes, then inserts. The LCS
        // emits them grouped (deletes before inserts) for a changed region.
        let block_start = i;
        while i < ops.len() && ops[i].typ == OpType::Delete {
            i += 1;
        }
        let dels = &ops[block_start..i];
        let ins_start = i;
        while i < ops.len() && ops[i].typ == OpType::Insert {
            i += 1;
        }
        let inss = &ops[ins_start..i];

        // Pair deletes with inserts positionally (1st-with-1st, ...). For each
        // pair, if similar enough, emit a Replace; otherwise keep them separate.
        let pairs = dels.len().min(inss.len());
        for k in 0..pairs {
            let d = &dels[k];
            let s = &inss[k];
            if let Some((a_segs, b_segs)) = inline_segments(&d.a_val, &s.b_val) {
                out.push(Op::replace(d.a, s.b, &d.a_val, &s.b_val, a_segs, b_segs));
            } else {
                out.push(d.clone());
                out.push(s.clone());
            }
        }
        // Leftover deletes or inserts (block sizes unequal) pass through as-is.
        for d in &dels[pairs..] {
            out.push(d.clone());
        }
        for s in &inss[pairs..] {
            out.push(s.clone());
        }
    }
    out
}

/// inline_segments runs a WORD-LEVEL diff between two lines (the same technique
/// Beyond Compare uses for intra-line highlighting): it tokenizes each line and
/// LCS-aligns the tokens, so scattered unchanged tokens (e.g. "0.020", "0.0400")
/// stay un-highlighted and only the tokens that actually differ are marked.
/// Returns per-side segment lists, or None when the lines share too little to be
/// considered a modification (then they remain a separate delete + insert).
pub(crate) fn inline_segments(a: &str, b: &str) -> Option<(Vec<Seg>, Vec<Seg>)> {
    let ta = tokenize(a);
    let tb = tokenize(b);
    let ops = diff(&ta, &tb);

    // Similarity = matched chars (on both sides) / total chars. Reject low
    // overlap so unrelated lines aren't forced into a misleading "modified" pair.
    let mut shared = 0usize;
    for op in &ops {
        if op.typ == OpType::Equal {
            shared += op.a_val.chars().count();
        }
    }
    let denom = (a.chars().count() + b.chars().count()).max(1) as f64;
    let similarity = (2 * shared) as f64 / denom;
    if similarity < SIMILARITY {
        return None;
    }

    // Build per-side segments, coalescing adjacent runs of the same changed-ness.
    let mut a_segs: Vec<Seg> = Vec::new();
    let mut b_segs: Vec<Seg> = Vec::new();
    let push = |segs: &mut Vec<Seg>, text: &str, changed: bool| {
        if text.is_empty() {
            return;
        }
        if let Some(last) = segs.last_mut() {
            if last.changed == changed {
                last.text.push_str(text);
                return;
            }
        }
        segs.push(Seg { text: text.to_string(), changed });
    };
    for op in &ops {
        match op.typ {
            OpType::Equal => {
                push(&mut a_segs, &op.a_val, false);
                push(&mut b_segs, &op.b_val, false);
            }
            OpType::Delete => push(&mut a_segs, &op.a_val, true),
            OpType::Insert => push(&mut b_segs, &op.b_val, true),
            OpType::Replace => {}
        }
    }
    Some((a_segs, b_segs))
}

/// tokenize splits a line into alternating word / non-word (whitespace+punct)
/// tokens so the token stream reconstructs the line exactly. Each token is a
/// diff unit, giving word-granularity inline highlights.
fn tokenize(s: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut cur = String::new();
    let mut cur_alnum: Option<bool> = None;
    for ch in s.chars() {
        let is_alnum = ch.is_alphanumeric();
        match cur_alnum {
            Some(prev) if prev == is_alnum => cur.push(ch),
            _ => {
                if !cur.is_empty() {
                    out.push(std::mem::take(&mut cur));
                }
                cur.push(ch);
                cur_alnum = Some(is_alnum);
            }
        }
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

/// read_lines reads a file as UTF-8 (lossy) and splits into lines. An empty path
/// means "this side does not exist" (added/removed file) -> empty content.
pub fn read_lines(path: &str) -> io::Result<Vec<String>> {
    if path.is_empty() {
        return Ok(Vec::new());
    }
    let bytes = std::fs::read(path)?;
    let text = String::from_utf8_lossy(&bytes);
    // Split on \n, mirroring bufio.Scanner which strips the trailing newline and
    // does not emit a trailing empty line.
    let normalized = text.replace("\r\n", "\n");
    let mut lines: Vec<String> = normalized.split('\n').map(|s| s.to_string()).collect();
    if lines.last().map(|s| s.is_empty()).unwrap_or(false) {
        lines.pop();
    }
    Ok(lines)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::myers::OpType;

    fn sv(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn page_number_change_pairs_as_replace() {
        let a = sv(&["Section A.1 Overview .... 17"]);
        let b = sv(&["Section A.1 Overview .... 18"]);
        let r = build_text_result("a", "b", a, b);
        assert_eq!(r.ops.len(), 1);
        assert_eq!(r.ops[0].typ, OpType::Replace);
        // Only the page number is marked changed on each side.
        let a_chg: String = r.ops[0].a_segs.iter().filter(|s| s.changed).map(|s| s.text.clone()).collect();
        let b_chg: String = r.ops[0].b_segs.iter().filter(|s| s.changed).map(|s| s.text.clone()).collect();
        assert_eq!(a_chg, "17");
        assert_eq!(b_chg, "18");
    }

    #[test]
    fn unrelated_lines_stay_separate() {
        let a = sv(&["the quick brown fox"]);
        let b = sv(&["completely different text here"]);
        let r = build_text_result("a", "b", a, b);
        // Too dissimilar to pair: a delete + an insert, no replace.
        assert!(r.ops.iter().all(|o| o.typ != OpType::Replace));
        assert!(r.ops.iter().any(|o| o.typ == OpType::Delete));
        assert!(r.ops.iter().any(|o| o.typ == OpType::Insert));
    }

    #[test]
    fn scattered_number_changes_word_level() {
        let a = sv(&["ROW01 12 0.0617 0.020 0.0400 0.075"]);
        let b = sv(&["ROW01 15 0.0580 0.020 0.0400 0.075"]);
        let r = build_text_result("a", "b", a, b);
        assert_eq!(r.ops[0].typ, OpType::Replace);
        // Unchanged tokens stay un-highlighted; only 12->15 and 0.0617->0.0580 change.
        let b_chg: Vec<String> = r.ops[0].b_segs.iter().filter(|s| s.changed).map(|s| s.text.trim().to_string()).collect();
        assert!(b_chg.iter().any(|s| s.contains("15")));
        assert!(b_chg.iter().any(|s| s.contains("0580")));
        // The shared "0.020" / "0.0400" must NOT all be flagged.
        let unchanged: String = r.ops[0].b_segs.iter().filter(|s| !s.changed).map(|s| s.text.clone()).collect();
        assert!(unchanged.contains("0.0400"));
    }
}
