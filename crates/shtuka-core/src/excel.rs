//! Excel diff: position-aligned grid with whole-row LCS alignment so an inserted
//! row stays a single insert. Ported from internal/diff/excel.go.
//! Reads xlsx/xls via calamine (raw cell values, no number-format styling).

use crate::myers::{diff, OpType};
use calamine::{open_workbook_auto, Data, Reader};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CellChange {
    pub status: String, // equal | modified | added | removed
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub old: String,
    #[serde(default, skip_serializing_if = "String::is_empty", rename = "new")]
    pub new_val: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GridColumn {
    pub name: String,
    pub status: String, // equal | added | removed
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GridRow {
    pub status: String, // equal | modified | added | removed
    #[serde(rename = "rowA")]
    pub row_a: usize, // 1-based source row in A (0 = absent)
    #[serde(rename = "rowB")]
    pub row_b: usize, // 1-based source row in B (0 = absent)
    pub header: bool,
    pub cells: Vec<CellChange>,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct SheetDiff {
    pub name: String,
    pub status: String,
    pub columns: Vec<GridColumn>,
    pub rows: Vec<GridRow>,
    #[serde(rename = "addedRows")]
    pub added_rows: usize,
    #[serde(rename = "removedRows")]
    pub removed_rows: usize,
    #[serde(rename = "modifiedRows")]
    pub modified_rows: usize,
    #[serde(rename = "addedCols")]
    pub added_cols: usize,
    #[serde(rename = "removedCols")]
    pub removed_cols: usize,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct ExcelResult {
    #[serde(rename = "fileType")]
    pub file_type: String,
    #[serde(rename = "pathA")]
    pub path_a: String,
    #[serde(rename = "pathB")]
    pub path_b: String,
    pub sheets: Vec<SheetDiff>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub notes: Vec<String>,
}

const MAX_EXCEL_ROWS: usize = 50000;
const MAX_EXCEL_COLS: usize = 256;

pub fn excel_diff(path_a: &str, path_b: &str) -> Result<ExcelResult, String> {
    let mut res = ExcelResult {
        file_type: "excel".into(),
        path_a: path_a.into(),
        path_b: path_b.into(),
        ..Default::default()
    };

    let book_a = if path_a.is_empty() {
        None
    } else {
        Some(read_workbook(path_a, &mut res, "A")?)
    };
    let book_b = if path_b.is_empty() {
        None
    } else {
        Some(read_workbook(path_b, &mut res, "B")?)
    };

    let sheets_a: Vec<String> = book_a.as_ref().map(|b| b.keys().cloned().collect()).unwrap_or_default();
    let sheets_b: Vec<String> = book_b.as_ref().map(|b| b.keys().cloned().collect()).unwrap_or_default();
    let union = union_strings(&sheets_a, &sheets_b);

    for name in &union {
        let has_a = sheets_a.iter().any(|s| s == name);
        let has_b = sheets_b.iter().any(|s| s == name);
        let empty: Vec<Vec<String>> = Vec::new();
        let rows_a = book_a.as_ref().and_then(|b| b.get(name)).unwrap_or(&empty);
        let rows_b = book_b.as_ref().and_then(|b| b.get(name)).unwrap_or(&empty);
        let sd = diff_sheet(name, rows_a, rows_b, has_a, has_b, &mut res);
        res.sheets.push(sd);
    }

    Ok(res)
}

type Workbook = std::collections::BTreeMap<String, Vec<Vec<String>>>;

/// read_workbook loads every sheet into capped row/col string grids using raw
/// cell values (no number-format resolution, matching the Go behavior).
fn read_workbook(path: &str, res: &mut ExcelResult, _side: &str) -> Result<Workbook, String> {
    let mut wb = open_workbook_auto(path).map_err(|e| format!("open {}: {}", path, e))?;
    let mut out: Workbook = std::collections::BTreeMap::new();
    let sheet_names = wb.sheet_names().to_vec();
    for name in sheet_names {
        let range = match wb.worksheet_range(&name) {
            Ok(r) => r,
            Err(_) => {
                continue;
            }
        };
        let mut rows: Vec<Vec<String>> = Vec::new();
        let mut truncated_rows = false;
        let mut truncated_cols = false;
        for row in range.rows() {
            if rows.len() >= MAX_EXCEL_ROWS {
                truncated_rows = true;
                break;
            }
            let mut cells: Vec<String> = row.iter().map(cell_to_string).collect();
            if cells.len() > MAX_EXCEL_COLS {
                cells.truncate(MAX_EXCEL_COLS);
                truncated_cols = true;
            }
            // Trim fully-trailing-empty cells to mirror excelize's row width,
            // which only extends to the last non-empty cell.
            while cells.last().map(|c| c.is_empty()).unwrap_or(false) {
                cells.pop();
            }
            rows.push(cells);
        }
        // Drop trailing fully-empty rows (calamine pads to the used range).
        while rows.last().map(|r| r.is_empty()).unwrap_or(false) {
            rows.pop();
        }
        if truncated_rows {
            res.notes.push(format!("sheet {:?} truncated to {} rows", name, MAX_EXCEL_ROWS));
        }
        if truncated_cols {
            res.notes.push(format!("sheet {:?} truncated to {} columns", name, MAX_EXCEL_COLS));
        }
        out.insert(name, rows);
    }
    Ok(out)
}

/// cell_to_string renders a raw cell value the way excelize RawCellValue does:
/// integers without a decimal point, no thousands separators, dates as their
/// serial (calamine gives us the raw types).
fn cell_to_string(d: &Data) -> String {
    match d {
        Data::Empty => String::new(),
        Data::String(s) => s.clone(),
        Data::Float(f) => format_float(*f),
        Data::Int(i) => i.to_string(),
        Data::Bool(b) => if *b { "TRUE".into() } else { "FALSE".into() },
        Data::DateTime(dt) => format_float(dt.as_f64()),
        Data::DateTimeIso(s) => s.clone(),
        Data::DurationIso(s) => s.clone(),
        Data::Error(e) => format!("{:?}", e),
    }
}

fn format_float(f: f64) -> String {
    if f.fract() == 0.0 && f.abs() < 1e15 {
        format!("{}", f as i64)
    } else {
        // Trim to a compact representation similar to Go's default.
        let s = format!("{}", f);
        s
    }
}

/// diff_sheet builds a flattened, position-aligned grid for one sheet.
pub fn diff_sheet(
    name: &str,
    rows_a: &[Vec<String>],
    rows_b: &[Vec<String>],
    has_a: bool,
    has_b: bool,
    res: &mut ExcelResult,
) -> SheetDiff {
    let mut sd = SheetDiff {
        name: name.into(),
        ..Default::default()
    };

    sd.status = match (has_a, has_b) {
        (true, false) => "removed".into(),
        (false, true) => "added".into(),
        _ => "equal".into(), // refined below
    };

    let width_a = max_width(rows_a);
    let width_b = max_width(rows_b);
    let width = width_a.max(width_b);

    sd.columns = Vec::with_capacity(width);
    for i in 0..width {
        let mut gc = GridColumn { name: col_letter(i), status: "equal".into() };
        if i >= width_a && i < width_b {
            gc.status = "added".into();
            sd.added_cols += 1;
        } else if i >= width_b && i < width_a {
            gc.status = "removed".into();
            sd.removed_cols += 1;
        }
        sd.columns.push(gc);
    }

    let header_a = detect_header_row(rows_a, width);
    let header_b = detect_header_row(rows_b, width);

    let row_pairs = align_rows(rows_a, rows_b, name, res);

    for rp in &row_pairs {
        let mut gr = build_grid_row(*rp, rows_a, rows_b, width);
        if (gr.row_a != 0 && gr.row_a == header_a) || (gr.row_b != 0 && gr.row_b == header_b) {
            gr.header = true;
        }
        match gr.status.as_str() {
            "added" => sd.added_rows += 1,
            "removed" => sd.removed_rows += 1,
            "modified" => sd.modified_rows += 1,
            _ => {}
        }
        sd.rows.push(gr);
    }

    if sd.status == "equal"
        && sd.added_rows + sd.removed_rows + sd.modified_rows + sd.added_cols + sd.removed_cols > 0
    {
        sd.status = "modified".into();
    }
    sd
}

fn max_width(rows: &[Vec<String>]) -> usize {
    rows.iter().map(|r| r.len()).max().unwrap_or(0)
}

/// detect_header_row returns the 1-based index of the row that most likely is
/// the table header: the first row filling ~80%+ of the width. 0 if none.
fn detect_header_row(rows: &[Vec<String>], width: usize) -> usize {
    if width < 2 {
        return 0;
    }
    let mut best_row = 0;
    let mut best_filled = 0;
    for (i, r) in rows.iter().enumerate() {
        let filled = r.iter().filter(|c| !c.trim().is_empty()).count();
        if filled >= (width * 8 + 9) / 10 && filled > best_filled {
            best_filled = filled;
            best_row = i + 1;
        }
    }
    best_row
}

/// col_letter converts a 0-based column index to its Excel letter (0->A, 26->AA).
fn col_letter(mut i: usize) -> String {
    let mut b: Vec<u8> = Vec::new();
    i += 1;
    while i > 0 {
        i -= 1;
        b.insert(0, b'A' + (i % 26) as u8);
        i /= 26;
    }
    String::from_utf8(b).unwrap()
}

#[derive(Clone, Copy)]
struct RowPair {
    a: isize,
    b: isize,
}

fn align_rows(
    rows_a: &[Vec<String>],
    rows_b: &[Vec<String>],
    sheet: &str,
    res: &mut ExcelResult,
) -> Vec<RowPair> {
    const LCS_ROW_BUDGET: usize = 4000;
    if rows_a.len() > LCS_ROW_BUDGET || rows_b.len() > LCS_ROW_BUDGET {
        res.notes.push(format!(
            "sheet {:?} too large for full alignment; rows matched by position",
            sheet
        ));
        return align_rows_by_position(rows_a, rows_b);
    }
    align_rows_by_lcs(rows_a, rows_b)
}

fn align_rows_by_position(rows_a: &[Vec<String>], rows_b: &[Vec<String>]) -> Vec<RowPair> {
    let n = rows_a.len().max(rows_b.len());
    let mut pairs = Vec::with_capacity(n);
    for i in 0..n {
        pairs.push(RowPair {
            a: if i < rows_a.len() { i as isize } else { -1 },
            b: if i < rows_b.len() { i as isize } else { -1 },
        });
    }
    pairs
}

fn align_rows_by_lcs(rows_a: &[Vec<String>], rows_b: &[Vec<String>]) -> Vec<RowPair> {
    let sig_a = signatures(rows_a);
    let sig_b = signatures(rows_b);
    let ops = diff(&sig_a, &sig_b);

    let mut pairs: Vec<RowPair> = Vec::new();
    let mut pending_del: Vec<usize> = Vec::new();
    let mut pending_ins: Vec<usize> = Vec::new();

    for op in &ops {
        match op.typ {
            OpType::Equal => {
                pairs.extend(repair_gap(&pending_del, &pending_ins, rows_a, rows_b));
                pending_del.clear();
                pending_ins.clear();
                pairs.push(RowPair { a: op.a as isize, b: op.b as isize });
            }
            OpType::Delete => pending_del.push(op.a),
            OpType::Insert => pending_ins.push(op.b),
            // raw diff() never emits Replace (only text.rs post-processing does).
            OpType::Replace => {}
        }
    }
    pairs.extend(repair_gap(&pending_del, &pending_ins, rows_a, rows_b));
    pairs
}

/// repair_gap matches deleted rows to inserted rows by similarity, turning close
/// matches into modified pairs; leftovers stay pure delete/insert.
fn repair_gap(
    dels: &[usize],
    ins: &[usize],
    rows_a: &[Vec<String>],
    rows_b: &[Vec<String>],
) -> Vec<RowPair> {
    let mut used_ins = vec![false; ins.len()];
    let mut match_of_del: std::collections::HashMap<usize, usize> = std::collections::HashMap::new();
    for &ai in dels {
        let mut best_j: isize = -1;
        let mut best_sim = 0.0f64;
        for (j, &bi) in ins.iter().enumerate() {
            if used_ins[j] {
                continue;
            }
            let sim = row_similarity(&rows_a[ai], &rows_b[bi]);
            if sim > best_sim {
                best_sim = sim;
                best_j = j as isize;
            }
        }
        if best_j >= 0 && best_sim >= 0.5 {
            used_ins[best_j as usize] = true;
            match_of_del.insert(ai, ins[best_j as usize]);
        }
    }

    let mut pairs: Vec<RowPair> = Vec::new();
    for &ai in dels {
        if let Some(&bi) = match_of_del.get(&ai) {
            pairs.push(RowPair { a: ai as isize, b: bi as isize });
        } else {
            pairs.push(RowPair { a: ai as isize, b: -1 });
        }
    }
    for (j, &bi) in ins.iter().enumerate() {
        if !used_ins[j] {
            pairs.push(RowPair { a: -1, b: bi as isize });
        }
    }
    pairs
}

fn signatures(rows: &[Vec<String>]) -> Vec<String> {
    rows.iter().map(|r| r.join("\u{0}")).collect()
}

fn row_similarity(ra: &[String], rb: &[String]) -> f64 {
    let n = ra.len().max(rb.len());
    if n == 0 {
        return 1.0;
    }
    let mut same = 0;
    for i in 0..n {
        let va = ra.get(i).map(|s| s.as_str()).unwrap_or("");
        let vb = rb.get(i).map(|s| s.as_str()).unwrap_or("");
        if va == vb {
            same += 1;
        }
    }
    same as f64 / n as f64
}

fn build_grid_row(rp: RowPair, rows_a: &[Vec<String>], rows_b: &[Vec<String>], width: usize) -> GridRow {
    let ra: &[String] = if rp.a >= 0 { &rows_a[rp.a as usize] } else { &[] };
    let rb: &[String] = if rp.b >= 0 { &rows_b[rp.b as usize] } else { &[] };
    let mut gr = GridRow {
        status: String::new(),
        row_a: if rp.a >= 0 { rp.a as usize + 1 } else { 0 },
        row_b: if rp.b >= 0 { rp.b as usize + 1 } else { 0 },
        header: false,
        cells: Vec::with_capacity(width),
    };

    gr.status = if rp.a < 0 {
        "added".into()
    } else if rp.b < 0 {
        "removed".into()
    } else {
        "equal".into() // refined while filling cells
    };

    let mut modified = false;
    for i in 0..width {
        let va = ra.get(i).map(|s| s.as_str()).unwrap_or("");
        let vb = rb.get(i).map(|s| s.as_str()).unwrap_or("");
        let cc = match gr.status.as_str() {
            "added" => CellChange { status: "added".into(), old: String::new(), new_val: vb.into() },
            "removed" => CellChange { status: "removed".into(), old: va.into(), new_val: String::new() },
            _ => {
                if va != vb {
                    modified = true;
                    CellChange { status: "modified".into(), old: va.into(), new_val: vb.into() }
                } else {
                    CellChange { status: "equal".into(), old: String::new(), new_val: vb.into() }
                }
            }
        };
        gr.cells.push(cc);
    }
    if gr.status == "equal" && modified {
        gr.status = "modified".into();
    }
    gr
}

fn union_strings(a: &[String], b: &[String]) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut out: Vec<String> = Vec::new();
    for s in a.iter().chain(b.iter()) {
        if seen.insert(s.clone()) {
            out.push(s.clone());
        }
    }
    out.sort();
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn grid(rows: &[&[&str]]) -> Vec<Vec<String>> {
        rows.iter().map(|r| r.iter().map(|s| s.to_string()).collect()).collect()
    }

    fn counts(sd: &SheetDiff) -> (usize, usize, usize, usize) {
        let (mut a, mut r, mut m, mut e) = (0, 0, 0, 0);
        for row in &sd.rows {
            match row.status.as_str() {
                "added" => a += 1,
                "removed" => r += 1,
                "modified" => m += 1,
                "equal" => e += 1,
                _ => {}
            }
        }
        (a, r, m, e)
    }

    #[test]
    fn inserted_row_no_cascade() {
        let rows_a = grid(&[&["name", "amount"], &["Alice", "100"], &["Bob", "200"], &["Carl", "300"], &["Dave", "400"]]);
        let rows_b = grid(&[&["name", "amount"], &["Alice", "100"], &["Bob", "200"], &["NEW", "999"], &["Carl", "300"], &["Dave", "400"]]);
        let mut res = ExcelResult::default();
        let sd = diff_sheet("Sheet1", &rows_a, &rows_b, true, true, &mut res);
        let (a, r, m, e) = counts(&sd);
        assert_eq!((a, m, r), (1, 0, 0), "inserted row cascaded");
        assert_eq!(e, 5, "want 5 equal rows");
    }

    #[test]
    fn single_cell_edit_is_modified() {
        let rows_a = grid(&[&["id", "v"], &["1", "a"], &["2", "b"], &["3", "c"]]);
        let rows_b = grid(&[&["id", "v"], &["1", "a"], &["2", "CHANGED"], &["3", "c"]]);
        let mut res = ExcelResult::default();
        let sd = diff_sheet("S", &rows_a, &rows_b, true, true, &mut res);
        let (a, r, m, e) = counts(&sd);
        assert_eq!((m, a, r), (1, 0, 0));
        assert_eq!(e, 3);
    }

    #[test]
    fn sdtm_layout_shows_all_columns() {
        let rows_a = grid(&[
            &["DM Domain Mapping Specifications"],
            &["Protocol Number:", "", "", "STUDY-DEMO-001"],
            &[],
            &["Variable Name", "Variable Label", "Type", "Length"],
            &["STUDYID", "Study Identifier", "C", "20"],
            &["DOMAIN", "Domain Abbreviation", "C", "2"],
        ]);
        let rows_b = grid(&[
            &["DM Domain Mapping Specifications"],
            &["Protocol Number:", "", "", "STUDY-DEMO-001"],
            &[],
            &["Variable Name", "Variable Label", "Type", "Length"],
            &["STUDYID", "Study Identifier", "C", "21"],
            &["DOMAIN", "Domain Abbreviation", "C", "2"],
        ]);
        let mut res = ExcelResult::default();
        let sd = diff_sheet("DM", &rows_a, &rows_b, true, true, &mut res);
        assert_eq!(sd.columns.len(), 4, "want 4 columns");
        assert_eq!(sd.columns[0].name, "A");
        assert_eq!(sd.columns[3].name, "D");
        let (a, r, m, e) = counts(&sd);
        assert_eq!((m, a, r), (1, 0, 0));
        assert_eq!(e, 5);
        for row in &sd.rows {
            if row.status == "modified" {
                assert_eq!(row.cells.len(), 4);
                assert_eq!(row.cells[3].status, "modified");
                assert_eq!(row.cells[3].old, "20");
                assert_eq!(row.cells[3].new_val, "21");
            }
        }
    }

    #[test]
    fn appended_row_is_added() {
        let rows_a = grid(&[&["Variable Name", "Type"], &["STUDYID", "C"]]);
        let rows_b = grid(&[&["Variable Name", "Type"], &["STUDYID", "C"], &["AGE", "N"]]);
        let mut res = ExcelResult::default();
        let sd = diff_sheet("DM", &rows_a, &rows_b, true, true, &mut res);
        let (a, r, m, _) = counts(&sd);
        assert_eq!((a, r, m), (1, 0, 0));
    }
}
