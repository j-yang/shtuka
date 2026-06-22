# shtuka

> A format-aware diff tool for the modern age. Rust + Tauri.

In arithmetic geometry, a *shtuka* encodes the compatible variations between two structures. We use the same idea: shtuka reveals every meaningful change between two documents.

## What it does

- 📁 Folder comparison with file-level and content-level analysis
- 📊 Excel diff (`.xlsx` / `.xls` / `.xlsm`) — cell-level, key-aligned row matching
- 📄 Word diff (`.docx`) — paragraph and table-level
- 📝 Plain text / CSV diff — line + character level
- 📕 PDF diff — text extraction with running header/footer stripping
- 📃 RTF diff — rendered to plain text
- 🔍 Rename detection via content hashing
- 🎨 Modern, fast, native UI

## Architecture

shtuka is a [Tauri v2](https://tauri.app) desktop app: a Rust backend driving a
React + TypeScript + Tailwind frontend in the system webview (WebView2 on
Windows). It was rewritten from an earlier Go + Wails implementation; the UI is
unchanged, and the diff engine now lives in a pure-Rust crate.

```
shtuka/
├── Cargo.toml                   # Rust workspace
├── crates/
│   └── shtuka-core/             # Pure-Rust diff engine (no GUI deps, fully tested)
│       └── src/
│           ├── myers.rs         # Patience anchors + LCS + Hirschberg
│           ├── text.rs          # Plain text
│           ├── excel.rs         # Excel (calamine), key-aligned rows
│           ├── docx.rs          # Word (zip + quick-xml)
│           ├── rtf.rs           # RTF → text
│           ├── pdf.rs           # PDF (pdf-extract) + header/footer stripping
│           ├── folder.rs        # Folder compare (sha256 + rename detection)
│           └── lib.rs           # Dispatch by file type
├── src-tauri/                   # Tauri backend (3 commands)
│   ├── src/lib.rs               # select_folder / compare_folders / diff_files
│   ├── tauri.conf.json
│   └── capabilities/
└── frontend/                    # React + TypeScript + Tailwind (unchanged UI)
    └── src/
        ├── App.tsx
        ├── tree.ts
        ├── types.ts
        └── components/
            ├── DualTree.tsx
            ├── DiffView.tsx
            ├── ExcelDiffPane.tsx
            ├── Toolbar.tsx
            └── FolderPicker.tsx
```

The three Rust commands (`select_folder`, `compare_folders`, `diff_files`) are
exposed to the frontend through `frontend/wailsjs/go/main/App.js`, a thin shim
that keeps the original import path so no component code changed: it now calls
Tauri's `invoke` instead of the Wails bridge.

## Quick start

### Prerequisites

- **Rust** (stable) — <https://rustup.rs>
- **Node 18+**
- Platform webview deps:
  - **Windows**: WebView2 (preinstalled on Windows 10/11)
  - **Linux**: `webkit2gtk-4.1`, `libgtk-3-dev`, `librsvg2-dev`, `pkg-config`
  - **macOS**: Xcode command-line tools

### Develop

```bash
cd frontend
npm install
npm run tauri:dev
```

### Build

```bash
cd frontend
npm run tauri:build
# Windows output: src-tauri/target/release/bundle/{nsis,msi}/...
```

## Testing the diff engine

The core engine is independent of the GUI and can be tested anywhere Rust runs:

```bash
cargo test -p shtuka-core
```

## License

MIT
