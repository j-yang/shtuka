// Tauri shim. This file kept its original Wails path and exported names so the
// React components need no changes; the bodies now call Tauri commands instead
// of the Wails-generated `window.go` bridge.
import { invoke } from '@tauri-apps/api/core';

export function CompareFolders(arg1, arg2) {
  return invoke('compare_folders', { pathA: arg1, pathB: arg2 });
}

export function DiffFiles(arg1, arg2) {
  return invoke('diff_files', { pathA: arg1, pathB: arg2 });
}

export function SelectFolder(arg1) {
  return invoke('select_folder', { title: arg1 });
}

export function SelectFile(arg1) {
  return invoke('select_file', { title: arg1 });
}

export function SaveTextFile(defaultName, contents) {
  return invoke('save_text_file', { defaultName, contents });
}

// --- Track / changelog ---------------------------------------------------

export function ListTracks(root) {
  return invoke('list_tracks', { root });
}

export function GetTrack(root, id) {
  return invoke('get_track', { root, id });
}

export function CreateTrack(root, name, sourcePath, note) {
  return invoke('create_track', { root, name, sourcePath, note });
}

export function TakeSnapshot(root, id, sourcePath, note) {
  return invoke('take_snapshot', { root, id, sourcePath, note });
}

export function DiffSnapshots(root, id, seqA, seqB) {
  return invoke('diff_snapshots', { root, id, seqA, seqB });
}

// --- PDF page rendering --------------------------------------------------

export function RenderPdfPage(path, pageIndex, width) {
  return invoke('render_pdf_page', { path, pageIndex, width });
}

export function PdfDocDiff(pathA, pathB) {
  return invoke('pdf_doc_diff', { pathA, pathB });
}

export function PdfPageChanges(pathA, pathB, side, page) {
  return invoke('pdf_page_changes', { pathA, pathB, side, page });
}

export function PdfPageLinks(path, page) {
  return invoke('pdf_page_links', { path, page });
}
