import { useEffect, useRef, useState } from 'react';
import { check, Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { getVersion } from '@tauri-apps/api/app';

// In-app updates from the GitHub release latest.json (via the updater plugin).
//
// Two entry points:
//  - Automatic: on launch we silently check for a newer signed version and, if
//    one exists, pop a dialog asking the user to update now or later.
//  - Manual: the header button re-runs the same check on demand.
//
// Checking is separated from installing so nothing downloads until the user
// confirms. No-ops gracefully in a plain browser (dev) where the plugin is
// absent — check() throws and we just stay idle.
type State =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'uptodate' }
  | { kind: 'available'; version: string } // waiting for the user to decide
  | { kind: 'downloading'; pct: number }
  | { kind: 'installed' }
  | { kind: 'error'; msg: string };

export function UpdateChecker() {
  const [s, setS] = useState<State>({ kind: 'idle' });
  // Current app version, read from the bundle so it always matches the build.
  // Empty in a plain browser (dev) where the Tauri API isn't present.
  const [version, setVersion] = useState('');
  // The pending Update handle, kept across the confirm dialog so the user's
  // "Update" click can install the exact release we found.
  const pending = useRef<Update | null>(null);

  // Look for a newer release. `auto` keeps the launch check quiet: no "up to
  // date" flash and no red error button when offline / the plugin is missing.
  const runCheck = async (auto: boolean) => {
    if (!auto) setS({ kind: 'checking' });
    try {
      const update = await check();
      if (!update) {
        if (!auto) setS({ kind: 'uptodate' });
        return;
      }
      pending.current = update;
      setS({ kind: 'available', version: update.version });
    } catch (e) {
      if (!auto) setS({ kind: 'error', msg: String(e) });
    }
  };

  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
    // Auto-check shortly after launch.
    runCheck(true);
  }, []);

  // User confirmed: download + install the pending update, then relaunch.
  const install = async () => {
    const update = pending.current;
    if (!update) return;
    try {
      let total = 0;
      let got = 0;
      setS({ kind: 'downloading', pct: 0 });
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
      await relaunch();
    } catch (e) {
      setS({ kind: 'error', msg: String(e) });
    }
  };

  // User dismissed the prompt: keep running the current version.
  const dismiss = () => {
    pending.current = null;
    setS({ kind: 'idle' });
  };

  const label = () => {
    switch (s.kind) {
      case 'checking':
        return 'Checking…';
      case 'uptodate':
        return 'Up to date';
      case 'available':
        return `v${s.version} available`;
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

  const busy = s.kind === 'checking' || s.kind === 'downloading' || s.kind === 'installed';
  // Clicking the button: when an update is waiting, re-open the prompt; else check.
  const onClick = () => {
    if (s.kind === 'available') return; // dialog already showing
    runCheck(false);
  };

  return (
    <>
      <div className="flex items-center gap-1.5">
        {version && (
          <span className="text-[11px] text-gray-400 tabular-nums select-none" title="Installed version">
            v{version}
          </span>
        )}
        <button
          onClick={onClick}
          disabled={busy}
          title={s.kind === 'error' ? s.msg : 'Check GitHub for a newer release'}
          className={`text-[11px] px-2 py-1 rounded transition-colors ${
            s.kind === 'error'
              ? 'text-red-600 hover:bg-red-50'
              : s.kind === 'available'
              ? 'text-indigo-600 hover:bg-indigo-50 font-medium'
              : s.kind === 'uptodate'
              ? 'text-green-700'
              : 'text-gray-500 hover:bg-gray-100'
          } disabled:opacity-60`}
        >
          {label()}
        </button>
      </div>

      {s.kind === 'available' && (
        <UpdatePrompt
          current={version}
          next={s.version}
          onUpdate={install}
          onLater={dismiss}
        />
      )}
    </>
  );
}

// Centered modal asking the user to update now or later.
function UpdatePrompt({
  current,
  next,
  onUpdate,
  onLater,
}: {
  current: string;
  next: string;
  onUpdate: () => void;
  onLater: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onLater}>
      <div
        className="bg-white rounded-lg shadow-xl border border-gray-200 w-[340px] p-5"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-2">
          <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 text-lg">
            ↑
          </div>
          <h2 className="text-sm font-semibold text-gray-800">A new version is available</h2>
        </div>
        <p className="text-xs text-gray-600 leading-relaxed mb-4">
          shtuka <span className="font-mono">v{next}</span> is ready to install
          {current && (
            <>
              {' '}
              (you have <span className="font-mono">v{current}</span>)
            </>
          )}
          . The app will restart to finish updating.
        </p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onLater}
            className="px-3 py-1.5 text-xs font-medium text-gray-600 rounded-md hover:bg-gray-100"
          >
            Later
          </button>
          <button
            onClick={onUpdate}
            className="px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700"
          >
            Update now
          </button>
        </div>
      </div>
    </div>
  );
}
