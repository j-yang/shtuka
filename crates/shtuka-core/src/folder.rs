//! Folder comparison with sha256 content hashing and rename detection.
//! Ported from internal/folder/compare.go.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io;
use std::path::Path;
use walkdir::WalkDir;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileInfo {
    pub path: String,
    pub size: u64,
    pub hash: String,
    pub mtime: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Rename {
    pub from: String,
    pub to: String,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct Summary {
    #[serde(rename = "totalA")]
    pub total_a: usize,
    #[serde(rename = "totalB")]
    pub total_b: usize,
    pub unchanged: usize,
    pub modified: usize,
    pub added: usize,
    pub removed: usize,
    pub renamed: usize,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct Comparison {
    #[serde(rename = "pathA")]
    pub path_a: String,
    #[serde(rename = "pathB")]
    pub path_b: String,
    pub unchanged: Vec<String>,
    pub modified: Vec<String>,
    pub added: Vec<String>,
    pub removed: Vec<String>,
    pub renamed: Vec<Rename>,
    pub summary: Summary,
}

pub fn compare(path_a: &str, path_b: &str) -> io::Result<Comparison> {
    let files_a = walk(path_a)?;
    let files_b = walk(path_b)?;

    let mut cmp = Comparison {
        path_a: path_a.into(),
        path_b: path_b.into(),
        ..Default::default()
    };

    let a_set: HashMap<&str, &FileInfo> = files_a.iter().map(|f| (f.path.as_str(), f)).collect();
    let b_set: HashMap<&str, &FileInfo> = files_b.iter().map(|f| (f.path.as_str(), f)).collect();

    // Common paths: unchanged vs modified by hash.
    let mut common: Vec<&str> = Vec::new();
    for &p in a_set.keys() {
        if b_set.contains_key(p) {
            common.push(p);
        }
    }
    let common_set: std::collections::HashSet<&str> = common.iter().copied().collect();
    for &p in &common {
        if a_set[p].hash == b_set[p].hash {
            cmp.unchanged.push(p.to_string());
        } else {
            cmp.modified.push(p.to_string());
        }
    }

    // Rename detection: hash -> path among non-common files on each side.
    let mut a_hashes: HashMap<&str, &str> = HashMap::new();
    for (&p, f) in &a_set {
        if !common_set.contains(p) {
            a_hashes.insert(f.hash.as_str(), p);
        }
    }
    let mut b_hashes: HashMap<&str, &str> = HashMap::new();
    for (&p, f) in &b_set {
        if !common_set.contains(p) {
            b_hashes.insert(f.hash.as_str(), p);
        }
    }

    let mut renamed_from: std::collections::HashSet<&str> = std::collections::HashSet::new();
    let mut renamed_to: std::collections::HashSet<&str> = std::collections::HashSet::new();
    for (h, &a_path) in &a_hashes {
        if let Some(&b_path) = b_hashes.get(h) {
            cmp.renamed.push(Rename { from: a_path.to_string(), to: b_path.to_string() });
            renamed_from.insert(a_path);
            renamed_to.insert(b_path);
        }
    }

    for &p in a_set.keys() {
        if common_set.contains(p) || renamed_from.contains(p) {
            continue;
        }
        cmp.removed.push(p.to_string());
    }
    for &p in b_set.keys() {
        if common_set.contains(p) || renamed_to.contains(p) {
            continue;
        }
        cmp.added.push(p.to_string());
    }

    cmp.unchanged.sort();
    cmp.modified.sort();
    cmp.added.sort();
    cmp.removed.sort();

    cmp.summary = Summary {
        total_a: files_a.len(),
        total_b: files_b.len(),
        unchanged: cmp.unchanged.len(),
        modified: cmp.modified.len(),
        added: cmp.added.len(),
        removed: cmp.removed.len(),
        renamed: cmp.renamed.len(),
    };

    Ok(cmp)
}

fn walk(root: &str) -> io::Result<Vec<FileInfo>> {
    let mut files = Vec::new();
    let root_path = Path::new(root);
    for entry in WalkDir::new(root).follow_links(false) {
        let entry = entry.map_err(|e| io::Error::other(e.to_string()))?;
        if entry.file_type().is_dir() {
            continue;
        }
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        let rel = path
            .strip_prefix(root_path)
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .unwrap_or_else(|_| path.to_string_lossy().to_string());
        let meta = entry.metadata().map_err(|e| io::Error::other(e.to_string()))?;
        let mtime = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        let hash = hash_file(path)?;
        files.push(FileInfo {
            path: rel,
            size: meta.len(),
            hash,
            mtime,
        });
    }
    Ok(files)
}

fn hash_file(path: &Path) -> io::Result<String> {
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    io::copy(&mut file, &mut hasher)?;
    let digest = hasher.finalize();
    Ok(hex_lower(&digest))
}

fn hex_lower(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        s.push(HEX[(b >> 4) as usize] as char);
        s.push(HEX[(b & 0x0f) as usize] as char);
    }
    s
}
