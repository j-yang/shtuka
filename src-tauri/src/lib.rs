//! Tauri backend for shtuka. Exposes the same three operations the Wails Go app
//! bound to the frontend: select_folder, compare_folders, diff_files. The heavy
//! lifting lives in the shtuka-core crate.

use serde::Serialize;
use shtuka_core::{dispatch, folder, pdf, track, DiffResult};
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

/// Progress payload emitted on the "pdf-progress" event during PDF extraction.
#[derive(Clone, Serialize)]
struct PdfProgress {
    side: String,
    done: usize,
    total: usize,
}

fn is_pdf(path: &str) -> bool {
    std::path::Path::new(path)
        .extension()
        .map(|e| e.eq_ignore_ascii_case("pdf"))
        .unwrap_or(false)
}

/// Open a native directory picker and return the chosen path ("" if cancelled).
#[tauri::command]
async fn select_folder(app: tauri::AppHandle, title: String) -> Result<String, String> {
    let title = if title.is_empty() {
        "Select a folder".to_string()
    } else {
        title
    };

    // tauri-plugin-dialog's blocking picker must run off the main thread; use the
    // async channel form so the command stays async.
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog()
        .file()
        .set_title(&title)
        .pick_folder(move |path| {
            let _ = tx.send(path);
        });
    let chosen = rx.recv().map_err(|e| e.to_string())?;
    Ok(chosen.map(|p| p.to_string()).unwrap_or_default())
}

/// Open a native file picker and return the chosen path ("" if cancelled).
#[tauri::command]
async fn select_file(app: tauri::AppHandle, title: String) -> Result<String, String> {
    let title = if title.is_empty() {
        "Select a file".to_string()
    } else {
        title
    };
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog()
        .file()
        .set_title(&title)
        .pick_file(move |path| {
            let _ = tx.send(path);
        });
    let chosen = rx.recv().map_err(|e| e.to_string())?;
    Ok(chosen.map(|p| p.to_string()).unwrap_or_default())
}

/// Open a native save dialog and write `contents` to the chosen path. Returns
/// the saved path, or "" if cancelled.
#[tauri::command]
async fn save_text_file(
    app: tauri::AppHandle,
    default_name: String,
    contents: String,
) -> Result<String, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog()
        .file()
        .set_title("Export report")
        .set_file_name(&default_name)
        .save_file(move |path| {
            let _ = tx.send(path);
        });
    let chosen = rx.recv().map_err(|e| e.to_string())?;
    match chosen {
        Some(p) => {
            let path = p.to_string();
            std::fs::write(&path, contents.as_bytes()).map_err(|e| format!("write {}: {}", path, e))?;
            Ok(path)
        }
        None => Ok(String::new()),
    }
}

/// List all tracks stored under a project root's .shtuka-history.
#[tauri::command]
async fn list_tracks(root: String) -> Result<Vec<track::TrackSummary>, String> {
    tauri::async_runtime::spawn_blocking(move || track::list_tracks(&root).map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

/// Load one track's full manifest (changelog).
#[tauri::command]
async fn get_track(root: String, id: String) -> Result<track::Track, String> {
    tauri::async_runtime::spawn_blocking(move || track::get_track(&root, &id).map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

/// Create a new track, ingesting `source_path` as snapshot v1.
#[tauri::command]
async fn create_track(
    root: String,
    name: String,
    source_path: String,
    note: String,
) -> Result<track::Track, String> {
    tauri::async_runtime::spawn_blocking(move || {
        track::create_track(&root, &name, &source_path, &note).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Take a new snapshot of an existing track (empty source_path = reuse last).
#[tauri::command]
async fn take_snapshot(
    root: String,
    id: String,
    source_path: String,
    note: String,
) -> Result<track::SnapshotResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        track::take_snapshot(&root, &id, &source_path, &note).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Diff two snapshots of a track by sequence number.
#[tauri::command]
async fn diff_snapshots(
    root: String,
    id: String,
    seq_a: u32,
    seq_b: u32,
) -> Result<DiffResult, String> {
    tauri::async_runtime::spawn_blocking(move || track::diff_snapshots(&root, &id, seq_a, seq_b))
        .await
        .map_err(|e| e.to_string())?
}

/// Trace how one variable (a row in an Excel mapping spec) evolved across all
/// snapshots of a track.
#[tauri::command]
async fn variable_history(
    root: String,
    id: String,
    sheet: String,
    var_name: String,
) -> Result<track::VarHistory, String> {
    tauri::async_runtime::spawn_blocking(move || {
        track::variable_history(&root, &id, &sheet, &var_name)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Compare two folders (file-level add/remove/modify/rename via content hashing).
#[tauri::command]
async fn compare_folders(path_a: String, path_b: String) -> Result<folder::Comparison, String> {
    tauri::async_runtime::spawn_blocking(move || {
        folder::compare(&path_a, &path_b).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Diff two files, auto-dispatching by extension (text/excel/docx/rtf/pdf).
/// PDFs emit "pdf-progress" events while extracting so the UI can show a counter.
#[tauri::command]
async fn diff_files(
    app: tauri::AppHandle,
    path_a: String,
    path_b: String,
) -> Result<DiffResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if is_pdf(&path_a) || is_pdf(&path_b) {
            let mut progress = |side: &str, done: usize, total: usize| {
                let _ = app.emit(
                    "pdf-progress",
                    PdfProgress { side: side.to_string(), done, total },
                );
            };
            let text = pdf::pdf_diff_progress(&path_a, &path_b, &mut progress)?;
            Ok(DiffResult {
                file_type: "text".into(),
                path_a,
                path_b,
                text: Some(text),
                ..Default::default()
            })
        } else {
            dispatch(&path_a, &path_b)
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Diff two PDFs (two-sided): pages/changes per side + alignment for the
/// side-by-side view. The first call extracts/caches both docs (slow); later
/// calls are fast.
#[tauri::command]
async fn pdf_doc_diff(
    app: tauri::AppHandle,
    path_a: String,
    path_b: String,
) -> Result<pdf::DocDiff, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut progress = |side: &str, done: usize, total: usize| {
            let _ = app.emit(
                "pdf-progress",
                PdfProgress { side: side.to_string(), done, total },
            );
        };
        pdf::doc_diff_progress(&path_a, &path_b, &mut progress)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Highlight rectangles (normalized 0..1) for changes on one page of one side
/// ("a" or "b").
#[tauri::command]
async fn pdf_page_changes(
    path_a: String,
    path_b: String,
    side: String,
    page: usize,
) -> Result<Vec<pdf::PageChange>, String> {
    let s = if side.eq_ignore_ascii_case("a") { pdf::Side::A } else { pdf::Side::B };
    tauri::async_runtime::spawn_blocking(move || pdf::page_changes(&path_a, &path_b, s, page))
        .await
        .map_err(|e| e.to_string())?
}

/// In-page link annotations (TOC entries) for one page: rect + target page.
#[tauri::command]
async fn pdf_page_links(path: String, page: usize) -> Result<Vec<pdf::PageLink>, String> {
    tauri::async_runtime::spawn_blocking(move || pdf::page_links(&path, page))
        .await
        .map_err(|e| e.to_string())?
}

/// Render one PDF page (0-based) to a PNG data URL at the given pixel width.
#[tauri::command]
async fn render_pdf_page(
    path: String,
    page_index: usize,
    width: u32,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let png = pdf::render_page(&path, page_index, width)?;
        Ok::<String, String>(format!(
            "data:image/png;base64,{}",
            base64_encode(&png)
        ))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Minimal standard base64 encoder (avoids pulling a crate for one use).
fn base64_encode(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(T[((n >> 18) & 63) as usize] as char);
        out.push(T[((n >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 { T[((n >> 6) & 63) as usize] as char } else { '=' });
        out.push(if chunk.len() > 2 { T[(n & 63) as usize] as char } else { '=' });
    }
    out
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // Match the Wails window styling.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_title("shtuka");
            }
            // Point pdfium at the bundled resource dir. Installers put resources
            // in OS-specific locations (e.g. macOS .app/Contents/Resources), so
            // resolve it at runtime; pdf.rs reads PDFIUM_LIB_PATH first. Falls
            // back harmlessly to the exe dir when unset (portable Windows zip).
            if let Ok(dir) = app.path().resource_dir() {
                std::env::set_var("PDFIUM_LIB_PATH", dir);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            select_folder,
            select_file,
            save_text_file,
            compare_folders,
            diff_files,
            list_tracks,
            get_track,
            create_track,
            take_snapshot,
            diff_snapshots,
            variable_history,
            render_pdf_page,
            pdf_doc_diff,
            pdf_page_changes,
            pdf_page_links
        ])
        .run(tauri::generate_context!())
        .expect("error while running shtuka");
}
