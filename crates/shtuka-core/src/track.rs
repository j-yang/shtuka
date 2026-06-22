//! Track / changelog: persistent version history for a single logical document.
//!
//! A *Track* is "the same document over time" — a named, ordered series of
//! snapshots whose identity is the track id, NOT the file name or folder. Each
//! snapshot is a physical copy of the source file plus metadata (sequence,
//! timestamp, source name/path, content hash, optional note, auto diff summary).
//!
//! Everything lives under `<root>/.shtuka-history/tracks/<id>/`:
//!   manifest.json                       -- the changelog source of truth
//!   snapshots/001__<epoch>__<name>.xlsx -- physical backups
//!
//! The `root` is a project folder the user picks; storing history inside it lets
//! the changelog travel with the project (and go into git).

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::{dispatch, DiffResult};

const HISTORY_DIR: &str = ".shtuka-history";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Snapshot {
    pub seq: u32,
    /// Epoch seconds; the frontend formats for display.
    #[serde(rename = "takenAt")]
    pub taken_at: i64,
    /// Original file name at ingest time (metadata only).
    #[serde(rename = "sourceName")]
    pub source_name: String,
    /// Absolute path the snapshot was ingested from (metadata only).
    #[serde(rename = "sourcePath")]
    pub source_path: String,
    pub sha256: String,
    /// Path to the stored copy, relative to the track directory.
    pub file: String,
    /// Optional human note (may be empty).
    #[serde(default)]
    pub note: String,
    /// Auto-generated one-line diff summary vs the previous snapshot.
    #[serde(default)]
    pub summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Track {
    pub id: String,
    pub name: String,
    #[serde(rename = "createdAt")]
    pub created_at: i64,
    /// Last source path ingested — enables one-click "snapshot again" with no
    /// re-pick when the user keeps updating the same file in place.
    #[serde(rename = "lastSourcePath", default)]
    pub last_source_path: String,
    pub snapshots: Vec<Snapshot>,
}

/// Lightweight track listing entry (no per-snapshot detail).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackSummary {
    pub id: String,
    pub name: String,
    #[serde(rename = "createdAt")]
    pub created_at: i64,
    #[serde(rename = "snapshotCount")]
    pub snapshot_count: usize,
    #[serde(rename = "lastSnapshotAt")]
    pub last_snapshot_at: i64,
    #[serde(rename = "lastSourcePath")]
    pub last_source_path: String,
}

/// Result of attempting a snapshot. `created == false` means the source was
/// byte-identical to the latest snapshot, so nothing was stored.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnapshotResult {
    pub created: bool,
    pub track: Track,
    #[serde(rename = "message")]
    pub message: String,
}

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn tracks_dir(root: &str) -> PathBuf {
    Path::new(root).join(HISTORY_DIR).join("tracks")
}

fn track_dir(root: &str, id: &str) -> PathBuf {
    tracks_dir(root).join(id)
}

fn manifest_path(root: &str, id: &str) -> PathBuf {
    track_dir(root, id).join("manifest.json")
}

/// Slugify a human name into a filesystem-safe track id.
fn slugify(name: &str) -> String {
    let mut s = String::with_capacity(name.len());
    let mut prev_dash = false;
    for ch in name.trim().chars() {
        if ch.is_ascii_alphanumeric() {
            s.push(ch.to_ascii_lowercase());
            prev_dash = false;
        } else if !prev_dash {
            s.push('-');
            prev_dash = true;
        }
    }
    let s = s.trim_matches('-').to_string();
    if s.is_empty() {
        "track".to_string()
    } else {
        s
    }
}

fn read_manifest(path: &Path) -> io::Result<Track> {
    let data = fs::read_to_string(path)?;
    serde_json::from_str(&data).map_err(|e| io::Error::other(format!("manifest parse: {e}")))
}

fn write_manifest(root: &str, track: &Track) -> io::Result<()> {
    let path = manifest_path(root, &track.id);
    let data = serde_json::to_string_pretty(track)
        .map_err(|e| io::Error::other(format!("manifest serialize: {e}")))?;
    fs::write(path, data)
}

fn hash_file(path: &Path) -> io::Result<String> {
    let mut file = fs::File::open(path)?;
    let mut hasher = Sha256::new();
    io::copy(&mut file, &mut hasher)?;
    Ok(crate::folder_hex(&hasher.finalize()))
}

/// List all tracks under `<root>/.shtuka-history`. Returns empty if none exist.
pub fn list_tracks(root: &str) -> io::Result<Vec<TrackSummary>> {
    let dir = tracks_dir(root);
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for entry in fs::read_dir(&dir)? {
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            continue;
        }
        let mpath = entry.path().join("manifest.json");
        if !mpath.exists() {
            continue;
        }
        let track = read_manifest(&mpath)?;
        let last = track.snapshots.last();
        out.push(TrackSummary {
            id: track.id.clone(),
            name: track.name.clone(),
            created_at: track.created_at,
            snapshot_count: track.snapshots.len(),
            last_snapshot_at: last.map(|s| s.taken_at).unwrap_or(0),
            last_source_path: track.last_source_path.clone(),
        });
    }
    out.sort_by(|a, b| b.last_snapshot_at.cmp(&a.last_snapshot_at));
    Ok(out)
}

/// Load one track's full manifest.
pub fn get_track(root: &str, id: &str) -> io::Result<Track> {
    read_manifest(&manifest_path(root, id))
}

/// Create a new track and ingest `source_path` as its first snapshot (v1).
pub fn create_track(root: &str, name: &str, source_path: &str, note: &str) -> io::Result<Track> {
    let src = Path::new(source_path);
    if !src.is_file() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            format!("source file not found: {source_path}"),
        ));
    }

    // Allocate a unique id under the tracks dir.
    let base = slugify(name);
    let mut id = base.clone();
    let mut n = 2;
    while track_dir(root, &id).exists() {
        id = format!("{base}-{n}");
        n += 1;
    }

    let tdir = track_dir(root, &id);
    fs::create_dir_all(tdir.join("snapshots"))?;

    let now = now_secs();
    let mut track = Track {
        id: id.clone(),
        name: name.trim().to_string(),
        created_at: now,
        last_source_path: source_path.to_string(),
        snapshots: Vec::new(),
    };

    let snap = ingest(root, &mut track, src, note, "initial version")?;
    track.snapshots.push(snap);
    write_manifest(root, &track)?;
    Ok(track)
}

/// Take a new snapshot of a track. If `source_path` is empty, the track's
/// `last_source_path` is used (one-click re-snapshot). If the file is identical
/// to the latest snapshot, nothing is stored and `created == false`.
pub fn take_snapshot(
    root: &str,
    id: &str,
    source_path: &str,
    note: &str,
) -> io::Result<SnapshotResult> {
    let mut track = get_track(root, id)?;

    let src_str = if source_path.is_empty() {
        track.last_source_path.clone()
    } else {
        source_path.to_string()
    };
    if src_str.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "no source file: pick a file for this snapshot",
        ));
    }
    let src = PathBuf::from(&src_str);
    if !src.is_file() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            format!("source file not found: {src_str}"),
        ));
    }

    let new_hash = hash_file(&src)?;
    if let Some(prev) = track.snapshots.last() {
        if prev.sha256 == new_hash {
            return Ok(SnapshotResult {
                created: false,
                message: "No change — file is identical to the latest snapshot.".to_string(),
                track,
            });
        }
    }

    // Compute the auto summary by diffing the previous stored snapshot against
    // the incoming file before we store it.
    let summary = match track.snapshots.last() {
        Some(prev) => {
            let prev_path = track_dir(root, id).join(&prev.file);
            summarize_pair(prev_path.to_string_lossy().as_ref(), &src_str)
        }
        None => "initial version".to_string(),
    };

    let snap = ingest(root, &mut track, &src, note, &summary)?;
    track.snapshots.push(snap);
    track.last_source_path = src_str;
    write_manifest(root, &track)?;

    Ok(SnapshotResult {
        created: true,
        message: format!("Snapshot v{} saved.", track.snapshots.len()),
        track,
    })
}

/// Diff two snapshots of a track (by sequence number), routing through the
/// normal format-aware dispatch.
pub fn diff_snapshots(root: &str, id: &str, seq_a: u32, seq_b: u32) -> Result<DiffResult, String> {
    let track = get_track(root, id).map_err(|e| e.to_string())?;
    let find = |seq: u32| {
        track
            .snapshots
            .iter()
            .find(|s| s.seq == seq)
            .ok_or_else(|| format!("snapshot v{seq} not found"))
    };
    let a = find(seq_a)?;
    let b = find(seq_b)?;
    let pa = track_dir(root, id).join(&a.file);
    let pb = track_dir(root, id).join(&b.file);
    dispatch(&pa.to_string_lossy(), &pb.to_string_lossy())
}

/// Copy `src` into the track's snapshots dir and build the Snapshot record.
/// Does NOT push to the track or persist the manifest (caller does that), but it
/// does need the current snapshot count to assign the next sequence number.
fn ingest(
    root: &str,
    track: &mut Track,
    src: &Path,
    note: &str,
    summary: &str,
) -> io::Result<Snapshot> {
    let seq = track.snapshots.len() as u32 + 1;
    let now = now_secs();
    let source_name = src
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "file".to_string());
    let ext = src
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();
    // Stored name: zero-padded seq + epoch + original stem, keeping the original
    // extension so format dispatch still works on the stored copy.
    let stem = src
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "file".to_string());
    let stored = format!("{seq:03}__{now}__{stem}{ext}");
    let rel = format!("snapshots/{stored}");
    let dest = track_dir(root, &track.id).join(&rel);
    fs::copy(src, &dest)?;
    let sha256 = hash_file(&dest)?;

    Ok(Snapshot {
        seq,
        taken_at: now,
        source_name,
        source_path: src.to_string_lossy().to_string(),
        sha256,
        file: rel,
        note: note.trim().to_string(),
        summary: summary.to_string(),
    })
}

/// Diff two files and reduce the result to a short one-line changelog summary.
fn summarize_pair(path_a: &str, path_b: &str) -> String {
    match dispatch(path_a, path_b) {
        Ok(res) => summarize(&res),
        Err(e) => format!("changed (diff failed: {e})"),
    }
}

fn summarize(res: &DiffResult) -> String {
    if let Some(x) = &res.excel {
        let changed = x
            .sheets
            .iter()
            .filter(|s| s.status != "equal")
            .count();
        let added: usize = x.sheets.iter().map(|s| s.added_rows).sum();
        let removed: usize = x.sheets.iter().map(|s| s.removed_rows).sum();
        let modified: usize = x.sheets.iter().map(|s| s.modified_rows).sum();
        if changed == 0 && added == 0 && removed == 0 && modified == 0 {
            return "no cell changes".to_string();
        }
        let sheets = if changed == 1 { "sheet" } else { "sheets" };
        return format!(
            "{changed} {sheets} changed · {modified} rows modified, +{added} −{removed}"
        );
    }
    if let Some(d) = &res.docx {
        return format!(
            "{} ¶ added, {} modified, {} deleted",
            d.added_p.len(),
            d.modified_p.len(),
            d.deleted_p.len()
        );
    }
    if let Some(t) = &res.text {
        return format!("+{} −{} lines", t.summary.insert, t.summary.delete);
    }
    "changed".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp() -> PathBuf {
        let base = std::env::temp_dir().join(format!("shtuka-track-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).unwrap();
        base
    }

    #[test]
    fn slugify_basic() {
        assert_eq!(slugify("ADaM Mapping Spec!"), "adam-mapping-spec");
        assert_eq!(slugify("  weird___name  "), "weird-name");
        assert_eq!(slugify("***"), "track");
    }

    #[test]
    fn create_then_snapshot_dedup_and_summary() {
        let base = tmp();
        let root = base.to_string_lossy().to_string();
        let src = base.join("spec.csv");
        fs::write(&src, "a,b\n1,2\n").unwrap();

        let t = create_track(&root, "My Spec", src.to_string_lossy().as_ref(), "").unwrap();
        assert_eq!(t.snapshots.len(), 1);
        assert_eq!(t.snapshots[0].seq, 1);
        assert_eq!(t.snapshots[0].summary, "initial version");

        // Identical file -> no new snapshot.
        let r = take_snapshot(&root, &t.id, src.to_string_lossy().as_ref(), "").unwrap();
        assert!(!r.created);
        assert_eq!(r.track.snapshots.len(), 1);

        // Change content -> new snapshot with a text summary, reusing last source.
        fs::write(&src, "a,b\n1,2\n3,4\n").unwrap();
        let r = take_snapshot(&root, &t.id, "", "added a row").unwrap();
        assert!(r.created);
        assert_eq!(r.track.snapshots.len(), 2);
        assert_eq!(r.track.snapshots[1].note, "added a row");
        assert!(r.track.snapshots[1].summary.contains('+'));

        // Listing + reload.
        let list = list_tracks(&root).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].snapshot_count, 2);
        let reloaded = get_track(&root, &t.id).unwrap();
        assert_eq!(reloaded.snapshots.len(), 2);

        let _ = fs::remove_dir_all(&base);
    }
}
