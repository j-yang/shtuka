//! shtuka-core: clinical trial document diff — CDISC adapter + app features.
//!
//! Built on top of [`tate`] (diff algorithms) and [`mumford`] (format engines).
//! This crate adds:
//! - CDISC define.xml tree diff with ODM-specific semantics (domain, variable,
//!   codelist, value-level mapping)
//! - Folder comparison with content-aware Excel fingerprinting
//! - Version history / changelog with snapshot management
//! - A unified [`dispatch`] that routes by extension to mumford engines or the
//!   CDISC XML adapter

pub mod rtf;
pub mod track;
pub mod xml;

pub use mumford::folder;

use serde::{Deserialize, Serialize};
use std::path::Path;

// Re-export mumford's format types so the Tauri layer and frontend can use them
// through shtuka_core without a separate mumford dependency.
pub use mumford::docx::DocxResult;
pub use mumford::excel::ExcelResult;
pub use mumford::pdf;
pub use mumford::pptx::PptxResult;
pub use mumford::text::TextResult;
pub use crate::rtf::RtfResult;

pub use track::{Snapshot, SnapshotResult, Track, TrackSummary};

/// Lowercase hex encoding — delegates to mumford.
pub use mumford::hex as folder_hex;

/// The unified diff result the frontend consumes. Exactly one of the
/// format-specific fields is set.
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
    pub rtf: Option<RtfResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pptx: Option<PptxResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub xml: Option<xml::XmlResult>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub error: String,
}

/// Dispatch routes a file pair to the right diff engine by extension.
/// Delegates to mumford for all formats except XML (which goes through the
/// CDISC define.xml adapter). An empty path on one side means the file is
/// absent there.
pub fn dispatch(path_a: &str, path_b: &str) -> Result<DiffResult, String> {
    let ext = ext_of(path_a)
        .or_else(|| ext_of(path_b))
        .unwrap_or_default();

    let mut res = DiffResult {
        path_a: path_a.into(),
        path_b: path_b.into(),
        ..Default::default()
    };

    match ext.as_str() {
        "xlsx" | "xls" | "xlsm" => {
            // Clinical workbooks (validation logs, SDTM/ADaM specs) are tabular:
            // a header row (often below a title/metadata block) followed by data
            // rows, with a fixed set of columns. Detect that header and lock the
            // columns so a column whose every value changed (e.g. a timestamp
            // column) stays one modified column instead of being mis-read as a
            // delete+insert of whole columns. This domain assumption lives here,
            // not in mumford, which stays format-general.
            let opts = mumford::excel::ExcelOptions {
                detect_header: true,
                lock_columns: true,
            };
            let r = mumford::excel::excel_diff_with(path_a, path_b, &opts)?;
            res.file_type = "excel".into();
            res.excel = Some(r);
        }
        "docx" => {
            let r = mumford::docx::docx_diff(path_a, path_b)?;
            res.file_type = "docx".into();
            res.docx = Some(r);
        }
        "doc" => {
            return Err("legacy .doc format not supported (please convert to .docx)".into());
        }
        "rtf" => {
            let r = crate::rtf::rtf_diff(path_a, path_b)?;
            res.file_type = "rtf".into();
            res.rtf = Some(r);
        }
        "pptx" => {
            let r = mumford::pptx::pptx_diff(path_a, path_b)?;
            res.file_type = "pptx".into();
            res.pptx = Some(r);
        }
        "pdf" => {
            let r = mumford::pdf::pdf_diff(path_a, path_b)?;
            res.file_type = "text".into();
            res.text = Some(r);
        }
        "xml" => {
            let r = xml::xml_diff(path_a, path_b)?;
            res.file_type = "xml".into();
            res.xml = Some(r);
        }
        _ => {
            let r = mumford::text::text_diff(path_a, path_b).map_err(|e| e.to_string())?;
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
