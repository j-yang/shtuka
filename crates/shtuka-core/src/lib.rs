//! shtuka-core: the format-aware diff engine. Pure Rust, no GUI dependencies, so
//! it can be unit-tested headless. The Tauri binary (src-tauri) wraps these.

pub mod docx;
pub mod excel;
pub mod folder;
pub mod myers;
pub mod pdf;
pub mod rtf;
pub mod text;
pub mod track;
pub mod xml;

use serde::{Deserialize, Serialize};
use std::path::Path;

pub use docx::DocxResult;
pub use excel::ExcelResult;
pub use folder::Comparison;
pub use text::TextResult;
pub use track::{Snapshot, SnapshotResult, Track, TrackSummary};

/// Lowercase hex encoding, shared by the folder and track hashers.
pub fn folder_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        s.push(HEX[(b >> 4) as usize] as char);
        s.push(HEX[(b & 0x0f) as usize] as char);
    }
    s
}

/// DiffResult is the unified result the frontend consumes. Exactly one of the
/// `text` / `excel` / `docx` fields is set, mirroring internal/diff/factory.go.
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct DiffResult {
    #[serde(rename = "fileType")]
    pub file_type: String,
    #[serde(rename = "pathA")]
    pub path_a: String,
    #[serde(rename = "pathB")]
    pub path_b: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<TextResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub excel: Option<ExcelResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub docx: Option<DocxResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rtf: Option<rtf::RtfResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub xml: Option<xml::XmlResult>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub error: String,
}

/// dispatch routes a file pair to the right diff engine by extension, mirroring
/// the Go factory. An empty path on one side means the file is absent there.
pub fn dispatch(path_a: &str, path_b: &str) -> Result<DiffResult, String> {
    let ext = ext_of(path_a).or_else(|| ext_of(path_b)).unwrap_or_default();

    let mut res = DiffResult {
        path_a: path_a.into(),
        path_b: path_b.into(),
        ..Default::default()
    };

    match ext.as_str() {
        "xlsx" | "xls" | "xlsm" => {
            let r = excel::excel_diff(path_a, path_b)?;
            res.file_type = "excel".into();
            res.excel = Some(r);
        }
        "docx" => {
            let r = docx::docx_diff(path_a, path_b)?;
            res.file_type = "docx".into();
            res.docx = Some(r);
        }
        "doc" => {
            return Err("legacy .doc format not supported (please convert to .docx)".into());
        }
        "rtf" => {
            // SAS RTF outputs are styled tables; render side-by-side as HTML.
            let r = rtf::rtf_diff(path_a, path_b)?;
            res.file_type = "rtf".into();
            res.rtf = Some(r);
        }
        "pdf" => {
            let r = pdf::pdf_diff(path_a, path_b)?;
            res.file_type = "text".into();
            res.text = Some(r);
        }
        "xml" => {
            let r = xml::xml_diff(path_a, path_b)?;
            res.file_type = "xml".into();
            res.xml = Some(r);
        }
        _ => {
            let r = text::text_diff(path_a, path_b).map_err(|e| e.to_string())?;
            res.file_type = "text".into();
            res.text = Some(r);
        }
    }

    Ok(res)
}

fn ext_of(path: &str) -> Option<String> {
    if path.is_empty() {
        return None;
    }
    Path::new(path)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .filter(|e| !e.is_empty())
}
