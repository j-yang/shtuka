//! Line-level diff engine: patience anchors split the input into small segments
//! solved by exact LCS, with a linear-space Hirschberg fallback for segments too
//! large for the full matrix. Ported from the Go implementation (internal/diff/myers.go).
//!
//! Op.a / Op.b are absolute indices into the `a` / `b` input slices.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OpType {
    Equal,
    Insert,
    Delete,
    /// A delete+insert paired into one "this line was modified" row, carrying
    /// inline segments so the UI can highlight only the characters that changed.
    /// Produced by post-processing in text.rs, never by the raw LCS.
    Replace,
}

/// One inline run within a Replace row. `changed` marks the span that differs
/// between the two sides; unchanged spans render normally on both sides.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Seg {
    pub text: String,
    pub changed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Op {
    #[serde(rename = "type")]
    pub typ: OpType,
    pub a: usize,
    pub b: usize,
    #[serde(rename = "aVal", default, skip_serializing_if = "String::is_empty")]
    pub a_val: String,
    #[serde(rename = "bVal", default, skip_serializing_if = "String::is_empty")]
    pub b_val: String,
    /// Inline segmentation of a_val / b_val for Replace rows (empty otherwise).
    #[serde(rename = "aSegs", default, skip_serializing_if = "Vec::is_empty")]
    pub a_segs: Vec<Seg>,
    #[serde(rename = "bSegs", default, skip_serializing_if = "Vec::is_empty")]
    pub b_segs: Vec<Seg>,
}

impl Op {
    fn equal(a: usize, b: usize, av: &str, bv: &str) -> Op {
        Op { typ: OpType::Equal, a, b, a_val: av.to_string(), b_val: bv.to_string(), a_segs: Vec::new(), b_segs: Vec::new() }
    }
    fn insert(b: usize, bv: &str) -> Op {
        Op { typ: OpType::Insert, a: 0, b, a_val: String::new(), b_val: bv.to_string(), a_segs: Vec::new(), b_segs: Vec::new() }
    }
    fn delete(a: usize, av: &str) -> Op {
        Op { typ: OpType::Delete, a, b: 0, a_val: av.to_string(), b_val: String::new(), a_segs: Vec::new(), b_segs: Vec::new() }
    }
    /// Construct a Replace row from a paired delete/insert with precomputed segments.
    pub fn replace(a: usize, b: usize, av: &str, bv: &str, a_segs: Vec<Seg>, b_segs: Vec<Seg>) -> Op {
        Op { typ: OpType::Replace, a, b, a_val: av.to_string(), b_val: bv.to_string(), a_segs, b_segs }
    }
}

/// maxLCSCells bounds the exact full-matrix LCS to ~4M cells. Larger segments
/// fall back to linear-space Hirschberg so memory stays bounded.
const MAX_LCS_CELLS: usize = 4 << 20;

/// Diff returns an edit script aligning `a` and `b`.
pub fn diff(a: &[String], b: &[String]) -> Vec<Op> {
    let mut out: Vec<Op> = Vec::with_capacity(a.len() + b.len());
    diff_into(a, b, 0, 0, &mut out);
    out
}

/// Strip common prefix/suffix (cheap, common case) then hand the differing
/// middle to diff_middle.
fn diff_into(a: &[String], b: &[String], mut off_a: usize, mut off_b: usize, out: &mut Vec<Op>) {
    // Common prefix.
    let mut p = 0;
    while p < a.len() && p < b.len() && a[p] == b[p] {
        out.push(Op::equal(off_a + p, off_b + p, &a[p], &b[p]));
        p += 1;
    }
    off_a += p;
    off_b += p;
    let a = &a[p..];
    let b = &b[p..];

    // Common suffix (length only; emitted after the middle).
    let mut s = 0;
    while s < a.len() && s < b.len() && a[a.len() - 1 - s] == b[b.len() - 1 - s] {
        s += 1;
    }
    let a_mid = &a[..a.len() - s];
    let b_mid = &b[..b.len() - s];

    diff_middle(a_mid, b_mid, off_a, off_b, out);

    for t in 0..s {
        let ai = a_mid.len() + t;
        let bi = b_mid.len() + t;
        out.push(Op::equal(off_a + ai, off_b + bi, &a[ai], &b[bi]));
    }
}

fn diff_middle(a: &[String], b: &[String], off_a: usize, off_b: usize, out: &mut Vec<Op>) {
    if a.is_empty() {
        for (j, bv) in b.iter().enumerate() {
            out.push(Op::insert(off_b + j, bv));
        }
        return;
    }
    if b.is_empty() {
        for (i, av) in a.iter().enumerate() {
            out.push(Op::delete(off_a + i, av));
        }
        return;
    }

    let anchors = patience_anchors(a, b);
    if anchors.is_empty() {
        solve_exact(a, b, off_a, off_b, out);
        return;
    }

    let (mut prev_a, mut prev_b) = (0usize, 0usize);
    for an in &anchors {
        diff_into(&a[prev_a..an.a], &b[prev_b..an.b], off_a + prev_a, off_b + prev_b, out);
        out.push(Op::equal(off_a + an.a, off_b + an.b, &a[an.a], &b[an.b]));
        prev_a = an.a + 1;
        prev_b = an.b + 1;
    }
    diff_into(&a[prev_a..], &b[prev_b..], off_a + prev_a, off_b + prev_b, out);
}

fn solve_exact(a: &[String], b: &[String], off_a: usize, off_b: usize, out: &mut Vec<Op>) {
    if a.len().saturating_mul(b.len()) <= MAX_LCS_CELLS {
        lcs_full(a, b, off_a, off_b, out);
    } else {
        hirschberg(a, b, off_a, off_b, out);
    }
}

#[derive(Clone, Copy)]
struct AnchorPair {
    a: usize,
    b: usize,
}

/// patience_anchors finds lines that occur exactly once in both a and b, then
/// returns the longest increasing subsequence of those matches (by position).
fn patience_anchors(a: &[String], b: &[String]) -> Vec<AnchorPair> {
    use std::collections::HashMap;
    let mut count_a: HashMap<&str, i32> = HashMap::with_capacity(a.len());
    for x in a {
        *count_a.entry(x.as_str()).or_insert(0) += 1;
    }
    let mut count_b: HashMap<&str, i32> = HashMap::with_capacity(b.len());
    for x in b {
        *count_b.entry(x.as_str()).or_insert(0) += 1;
    }
    let mut pos_b: HashMap<&str, usize> = HashMap::with_capacity(b.len());
    for (j, x) in b.iter().enumerate() {
        if count_b[x.as_str()] == 1 {
            pos_b.insert(x.as_str(), j);
        }
    }

    // Matches ordered by index in a.
    let mut seq: Vec<AnchorPair> = Vec::new();
    for (i, x) in a.iter().enumerate() {
        if count_a[x.as_str()] != 1 {
            continue;
        }
        if let Some(&j) = pos_b.get(x.as_str()) {
            seq.push(AnchorPair { a: i, b: j });
        }
    }
    if seq.is_empty() {
        return Vec::new();
    }

    // Longest strictly-increasing subsequence on the b coordinate (b values are
    // unique, so no ties). Patience sorting with predecessor links.
    let mut piles: Vec<usize> = Vec::with_capacity(seq.len()); // seq index at each pile top
    let mut prev: Vec<isize> = vec![-1; seq.len()];
    for i in 0..seq.len() {
        let (mut lo, mut hi) = (0usize, piles.len());
        while lo < hi {
            let mid = (lo + hi) / 2;
            if seq[piles[mid]].b < seq[i].b {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        prev[i] = if lo > 0 { piles[lo - 1] as isize } else { -1 };
        if lo == piles.len() {
            piles.push(i);
        } else {
            piles[lo] = i;
        }
    }

    // Reconstruct.
    let mut out: Vec<AnchorPair> = Vec::with_capacity(piles.len());
    let mut k = *piles.last().unwrap() as isize;
    while k >= 0 {
        out.push(seq[k as usize]);
        k = prev[k as usize];
    }
    out.reverse();
    out
}

/// lcs_full is the exact O(n*m) LCS via a full DP matrix, with absolute offsets.
fn lcs_full(a: &[String], b: &[String], off_a: usize, off_b: usize, out: &mut Vec<Op>) {
    let (n, m) = (a.len(), b.len());
    // dp is (n+1) x (m+1), stored row-major in a flat vec.
    let stride = m + 1;
    let mut dp = vec![0i32; (n + 1) * stride];
    for i in 1..=n {
        let ai = &a[i - 1];
        // Split borrow: previous row then current row.
        let (prev_part, cur_part) = dp.split_at_mut(i * stride);
        let prev = &prev_part[(i - 1) * stride..(i - 1) * stride + stride];
        let row = &mut cur_part[..stride];
        for j in 1..=m {
            if *ai == b[j - 1] {
                row[j] = prev[j - 1] + 1;
            } else if prev[j] >= row[j - 1] {
                row[j] = prev[j];
            } else {
                row[j] = row[j - 1];
            }
        }
    }

    // Backtrack into a temporary, then append in forward order.
    let mut tmp: Vec<Op> = Vec::with_capacity(n + m);
    let (mut i, mut j) = (n, m);
    while i > 0 || j > 0 {
        if i > 0 && j > 0 && a[i - 1] == b[j - 1] {
            tmp.push(Op::equal(off_a + i - 1, off_b + j - 1, &a[i - 1], &b[j - 1]));
            i -= 1;
            j -= 1;
        } else if j > 0 && (i == 0 || dp[i * stride + j - 1] >= dp[(i - 1) * stride + j]) {
            tmp.push(Op::insert(off_b + j - 1, &b[j - 1]));
            j -= 1;
        } else {
            tmp.push(Op::delete(off_a + i - 1, &a[i - 1]));
            i -= 1;
        }
    }
    out.extend(tmp.into_iter().rev());
}

/// hirschberg computes an exact LCS edit script in O(n*m) time but only
/// O(min(n,m)) space, recursively splitting a in half.
fn hirschberg(a: &[String], b: &[String], off_a: usize, off_b: usize, out: &mut Vec<Op>) {
    if a.is_empty() {
        for (j, bv) in b.iter().enumerate() {
            out.push(Op::insert(off_b + j, bv));
        }
        return;
    }
    if b.is_empty() {
        for (i, av) in a.iter().enumerate() {
            out.push(Op::delete(off_a + i, av));
        }
        return;
    }
    if a.len() == 1 {
        let mut idx: isize = -1;
        for (j, bv) in b.iter().enumerate() {
            if *bv == a[0] {
                idx = j as isize;
                break;
            }
        }
        if idx < 0 {
            out.push(Op::delete(off_a, &a[0]));
            for (j, bv) in b.iter().enumerate() {
                out.push(Op::insert(off_b + j, bv));
            }
            return;
        }
        let idx = idx as usize;
        for j in 0..idx {
            out.push(Op::insert(off_b + j, &b[j]));
        }
        out.push(Op::equal(off_a, off_b + idx, &a[0], &b[idx]));
        for j in (idx + 1)..b.len() {
            out.push(Op::insert(off_b + j, &b[j]));
        }
        return;
    }

    let mid = a.len() / 2;
    let score_l = lcs_row(&a[..mid], b, false);
    let score_r = lcs_row(&a[mid..], b, true); // score_r[m] = LCS(a[mid:], last m of b)

    let mut best: i32 = -1;
    let mut best_k = 0usize;
    for k in 0..=b.len() {
        let s = score_l[k] + score_r[b.len() - k];
        if s > best {
            best = s;
            best_k = k;
        }
    }

    hirschberg(&a[..mid], &b[..best_k], off_a, off_b, out);
    hirschberg(&a[mid..], &b[best_k..], off_a + mid, off_b + best_k, out);
}

/// lcs_row returns the final LCS DP row using two rolling rows (linear space).
/// When rev is true it computes from the end, so result[m] = LCS(a, last m of b).
fn lcs_row(a: &[String], b: &[String], rev: bool) -> Vec<i32> {
    let mut prev = vec![0i32; b.len() + 1];
    let mut cur = vec![0i32; b.len() + 1];
    let at = |s: &[String], i: usize| -> usize {
        if rev {
            s.len() - 1 - i
        } else {
            i
        }
    };
    for i in 0..a.len() {
        let ai = &a[at(a, i)];
        for j in 1..=b.len() {
            let bj = &b[at(b, j - 1)];
            if *ai == *bj {
                cur[j] = prev[j - 1] + 1;
            } else if prev[j] >= cur[j - 1] {
                cur[j] = prev[j];
            } else {
                cur[j] = cur[j - 1];
            }
        }
        std::mem::swap(&mut prev, &mut cur);
    }
    prev
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sv(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    // validate checks an edit script actually transforms a into b.
    fn validate(a: &[String], b: &[String], ops: &[Op]) {
        let mut got_a: Vec<String> = Vec::new();
        let mut got_b: Vec<String> = Vec::new();
        for op in ops {
            match op.typ {
                OpType::Equal => {
                    got_a.push(op.a_val.clone());
                    got_b.push(op.b_val.clone());
                    assert_eq!(op.a_val, op.b_val, "equal op with differing vals");
                }
                OpType::Delete => got_a.push(op.a_val.clone()),
                OpType::Insert => got_b.push(op.b_val.clone()),
                // raw diff() never emits Replace; it only appears after text.rs
                // post-processing, which these tests don't exercise.
                OpType::Replace => {
                    got_a.push(op.a_val.clone());
                    got_b.push(op.b_val.clone());
                }
            }
        }
        assert_eq!(got_a, a, "reconstructed A mismatch");
        assert_eq!(got_b, b, "reconstructed B mismatch");
    }

    fn lcs_len(ops: &[Op]) -> usize {
        ops.iter().filter(|o| o.typ == OpType::Equal).count()
    }

    #[test]
    fn diff_basic() {
        let cases: Vec<(Vec<String>, Vec<String>)> = vec![
            (sv(&[]), sv(&[])),
            (sv(&["a"]), sv(&[])),
            (sv(&[]), sv(&["a"])),
            (sv(&["a", "b", "c"]), sv(&["a", "b", "c"])),
            (sv(&["a", "b", "c"]), sv(&["a", "x", "c"])),
            (sv(&["a", "b", "c", "d"]), sv(&["a", "c"])),
            (sv(&["a", "c"]), sv(&["a", "b", "c", "d"])),
            (sv(&["x", "a", "b", "c"]), sv(&["a", "b", "c"])),
        ];
        for (a, b) in &cases {
            let ops = diff(a, b);
            validate(a, b, &ops);
        }
    }

    #[test]
    fn diff_matches_full_lcs() {
        let mk = |n: usize, md: usize| -> Vec<String> {
            (0..n).map(|i| format!("line-{}", i % md)).collect()
        };
        for (n, m, md) in [(50usize, 40usize, 13usize), (100, 100, 7), (200, 150, 200)] {
            let a = mk(n, md);
            let b = mk(m, md * 2);
            let ops = diff(&a, &b);
            validate(&a, &b, &ops);
            let mut reference: Vec<Op> = Vec::new();
            lcs_full(&a, &b, 0, 0, &mut reference);
            assert_eq!(lcs_len(&ops), lcs_len(&reference), "LCS len mismatch n={n} m={m} mod={md}");
        }
    }

    #[test]
    fn diff_large_no_oom() {
        let n = 300_000;
        let mut a: Vec<String> = Vec::with_capacity(n);
        for i in 0..n {
            a.push(format!("row {} content here", i));
        }
        let mut b = a.clone();
        let mut i = 1000;
        while i < n {
            b[i] = format!("CHANGED {}", i);
            i += 5000;
        }
        let ops = diff(&a, &b);
        validate(&a, &b, &ops);
        assert!(lcs_len(&ops) > 0, "expected large equal run");
    }

    #[test]
    fn hirschberg_direct() {
        let a = sv(&["q", "w", "e", "r", "t"]);
        let b = sv(&["w", "r", "t", "z"]);
        let mut out: Vec<Op> = Vec::new();
        hirschberg(&a, &b, 0, 0, &mut out);
        validate(&a, &b, &out);
    }
}
