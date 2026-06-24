import { useEffect, useState } from 'react';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { getVersion } from '@tauri-apps/api/app';

// "Check for update" button. Queries the GitHub release latest.json (via the
// updater plugin), and if a newer signed version exists, downloads + installs it
// with progress, then relaunches. No-ops gracefully when running in a plain
// browser (dev) where the Tauri plugin isn't present.
type State =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'uptodate' }
  | { kind: 'available'; version: string }
  | { kind: 'downloading'; pct: number }
  | { kind: 'installed' }
  | { kind: 'error'; msg: string };

export function UpdateChecker() {
  const [s, setS] = useState<State>({ kind: 'idle' });
  // Current app version, read from the bundle so it always matches the build.
  // Empty in a plain browser (dev) where the Tauri API isn't present.
  const [version, setVersion] = useState('');

  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
  }, []);

  const doCheck = async () => {
    setS({ kind: 'checking' });
    try {
      const update = await check();
      if (!update) {
        setS({ kind: 'uptodate' });
        return;
      }
      setS({ kind: 'available', version: update.version });

      // Download + install with progress.
      let total = 0;
      let got = 0;
      await update.downloadAndInstall(event => {
        if (event.event === 'Started') {
          total = event.data.contentLength ?? 0;
          setS({ kind: 'downloading', pct: 0 });
        } else if (event.event === 'Progress') {
          got += event.data.chunkLength;
          setS({ kind: 'downloading', pct: total ? Math.round((got / total) * 100) : 0 });
        } else if (event.event === 'Finished') {
          setS({ kind: 'installed' });
        }
      });
      setS({ kind: 'installed' });
      // Relaunch into the new version.
      await relaunch();
    } catch (e) {
      setS({ kind: 'error', msg: String(e) });
    }
  };

  const label = () => {
    switch (s.kind) {
      case 'checking':
        return 'Checking…';
      case 'uptodate':
        return 'Up to date';
      case 'available':
        return `Updating to ${s.version}…`;
      case 'downloading':
        return `Downloading ${s.pct}%`;
      case 'installed':
        return 'Restarting…';
      case 'error':
        return 'Update failed';
      default:
        return 'Check for update';
    }
  };

  const busy = s.kind === 'checking' || s.kind === 'available' || s.kind === 'downloading' || s.kind === 'installed';

  return (
    <div className="flex items-center gap-1.5">
      {version && (
        <span className="text-[11px] text-gray-400 tabular-nums select-none" title="Installed version">
          v{version}
        </span>
      )}
      <button
        onClick={doCheck}
        disabled={busy}
        title={s.kind === 'error' ? s.msg : 'Check GitHub for a newer release'}
        className={`text-[11px] px-2 py-1 rounded transition-colors ${
          s.kind === 'error'
            ? 'text-red-600 hover:bg-red-50'
            : s.kind === 'uptodate'
            ? 'text-green-700'
            : 'text-gray-500 hover:bg-gray-100'
        } disabled:opacity-60`}
      >
        {label()}
      </button>
    </div>
  );
}
