# Releasing shtuka

Releases are built for **Windows, macOS, and Linux** by GitHub Actions
(`.github/workflows/release.yml`) and published to a GitHub Release. The app
can self-update from the latest release via **Check for update** (top-right),
using Tauri's signed updater.

## One-time setup (before the first release)

Add these to the repo's **Settings → Secrets and variables → Actions**:

| Secret | Value |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | contents of the updater private key file (see below) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | the password set when the key was generated (GitHub rejects empty secrets, so the key has a real password) |

The updater **public** key is committed in `src-tauri/tauri.conf.json`
(`plugins.updater.pubkey`). The matching **private** key was generated with
`tauri signer generate` — keep it secret; if lost, updates can no longer be
signed and you must ship a new pubkey.

> The private key is NOT in the repo. It was generated locally during setup;
> store it in a password manager and paste it into the secret above.

## Cutting a release

1. Bump `version` in `src-tauri/tauri.conf.json` (and optionally `package.json`).
   The released version must be **greater** than what users have installed for
   the updater to offer it.
2. Commit and push to `main`.
3. Tag and push:
   ```
   git tag v0.2.0
   git push origin v0.2.0
   ```
4. The `release` workflow runs on all three OSes, fetches the matching pdfium
   runtime, builds + signs, and creates the GitHub Release with:
   - Windows: NSIS `.exe` / MSI installer
   - macOS: `.dmg` / `.app.tar.gz`
   - Linux: AppImage / `.deb`
   - `latest.json` (the updater manifest the app reads)

## How updates work

`tauri.conf.json` points the updater at:
`https://github.com/azu-oncology-rd/shtuka/releases/latest/download/latest.json`.
The app downloads it, compares versions, and if newer, downloads the signed
artifact for the current OS, verifies it against the embedded public key,
installs, and relaunches.

## pdfium

The PDF engine (`pdfium`) is a native lib bundled as an app **resource**
(`src-tauri/resources/`). CI downloads the platform build from
`bblanchon/pdfium-binaries` (pinned to `chromium/7763`, matching the
`pdfium-render 0.9.2` ABI). At runtime the app sets `PDFIUM_LIB_PATH` to the
resolved resource dir so pdfium loads regardless of the installer's layout.
Bumping `pdfium-render` means bumping the `chromium/<N>` build in the workflow.
