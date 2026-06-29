# shtuka

> A format-aware diff tool for the modern age. Rust + Tauri.

In arithmetic geometry, a *shtuka* encodes the compatible variations between two structures. We use the same idea: shtuka reveals every meaningful change between two documents.

## What it does

- Folder comparison with file-level and content-level analysis
- Excel diff (`.xlsx` / `.xls` / `.xlsm`) — cell-level, key-aligned row matching
- Word diff (`.docx`) — paragraph and table-level
- PowerPoint diff (`.pptx`) — slide and shape-level
- Plain text / CSV diff (`.txt` / `.csv`) — line + character level
- PDF diff (`.pdf`) — text extraction with running header/footer stripping, page rendering
- RTF diff (`.rtf`) — rendered to plain text
- CDISC `define.xml` diff — ODM-aware (domain, variable, codelist, value-level mapping)
- Variable history / snapshot tracking
- Rename detection via content hashing

## Architecture

shtuka is a [Tauri v2](https://tauri.app) desktop app: a Rust backend driving a
React + TypeScript + Tailwind frontend in the system webview (WebView2 on
Windows).

The diff engines live in **two standalone Rust crates** developed alongside
shtuka and published to [crates.io](https://crates.io):

| Crate | Role | Repository |
|---|---|---|
| [**`tate`**](https://github.com/j-yang/tate) | Self-contained structured diff library — line diff, grid alignment, tree comparison. The pure algorithmic core (Myers/patience/Hirschberg, key-aligned rows, tree diff) with no format or GUI dependencies. | <https://github.com/j-yang/tate> |
| [**`mumford`**](https://github.com/j-yang/mumford) | Format-aware diff engines built on `tate` — PDF, Word, Excel, RTF, PowerPoint, JSON, plain text. Each engine parses a document format and emits a structured diff result. | <https://github.com/j-yang/mumford> |

`shtuka-core` is a thin adapter on top of these: it routes a file pair to the
right `mumford` engine by extension, adds the CDISC `define.xml` tree-diff
(using `tate`'s tree comparison), folder comparison with content-aware Excel
fingerprinting, and snapshot/version-history tracking.

```
shtuka/
├── Cargo.toml                   # Rust workspace
├── crates/
│   └── shtuka-core/             # Adapter on tate + mumford (no GUI deps, tested)
│       └── src/
│           ├── lib.rs           # DiffResult + dispatch() — route by file type
│           ├── xml.rs           # CDISC define.xml tree diff (ODM semantics)
│           ├── folder.rs        # Folder compare (sha256 + rename detection)
│           └── track.rs         # Snapshot / variable-history tracking
├── src-tauri/                   # Tauri backend
│   ├── src/lib.rs               # Tauri commands (folder/file/pdf/track)
│   ├── tauri.conf.json
│   └── capabilities/
└── frontend/                    # React + TypeScript + Tailwind
    └── src/
        ├── App.tsx
        └── components/          # DualTree, DiffView, ExcelDiffPane,
                                 # PdfPagesView, RtfDiffView, XmlDiffView, …
```

## Quick start

### Prerequisites

- **Rust** (stable) — <https://rustup.rs>
- **Node 18+**
- Platform webview deps:
  - **Windows**: WebView2 (preinstalled on Windows 10/11)
  - **Linux**: `webkit2gtk-4.1`, `libgtk-3-dev`, `librsvg2-dev`, `pkg-config`
  - **macOS**: Xcode command-line tools

The `tate` and `mumford` crates are pulled automatically from crates.io by
Cargo — no extra setup needed.

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

## Testing the core adapter

The core adapter is independent of the GUI and can be tested anywhere Rust runs:

```bash
cargo test -p shtuka-core
```

(The underlying diff algorithms and format engines have their own test suites
in the [`tate`](https://github.com/j-yang/tate) and
[`mumford`](https://github.com/j-yang/mumford) repositories.)

## Releasing

See [RELEASING.md](RELEASING.md). Releases are built for Windows, macOS, and
Linux by GitHub Actions and published as a GitHub Release; the app self-updates
via Tauri's signed updater.

## License

MIT
