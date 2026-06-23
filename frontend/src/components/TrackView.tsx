import { useEffect, useState } from 'react';
import { Track, TrackSummary, Snapshot, DiffResult } from '../types';
import {
  ListTracks,
  GetTrack,
  CreateTrack,
  TakeSnapshot,
  DiffSnapshots,
  SelectFile,
  SelectFolder,
} from '../../wailsjs/go/main/App';
import { DiffView } from './DiffView';

function fmtDate(epoch: number): string {
  if (!epoch) return '—';
  const d = new Date(epoch * 1000);
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function baseName(p: string): string {
  return p.split(/[/\\]/).pop() || p;
}

interface TrackViewProps {
  root: string;
  onRootChange: (root: string) => void;
}

export function TrackView({ root, onRootChange }: TrackViewProps) {
  const [tracks, setTracks] = useState<TrackSummary[]>([]);
  const [selected, setSelected] = useState<Track | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshList = async (r: string) => {
    if (!r) return;
    try {
      setTracks((await ListTracks(r)) as TrackSummary[]);
    } catch (e) {
      setError(String(e));
    }
  };

  useEffect(() => {
    setSelected(null);
    refreshList(root);
  }, [root]);

  const pickRoot = async () => {
    const p = await SelectFolder('Select project folder for history');
    if (p) onRootChange(p);
  };

  const openTrack = async (id: string) => {
    setError(null);
    try {
      setSelected((await GetTrack(root, id)) as Track);
    } catch (e) {
      setError(String(e));
    }
  };

  const handleCreate = async () => {
    setError(null);
    const file = await SelectFile('Select the file to start tracking');
    if (!file) return;
    const suggested = baseName(file).replace(/\.[^.]+$/, '');
    const name = window.prompt('Name this track (logical document name):', suggested);
    if (!name) return;
    setBusy(true);
    try {
      const track = (await CreateTrack(root, name, file, '')) as Track;
      await refreshList(root);
      setSelected(track);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!root) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-gray-400 gap-3">
        <div className="text-4xl opacity-30">🕑</div>
        <div className="text-sm">Pick a project folder to store version history</div>
        <button
          onClick={pickRoot}
          className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700"
        >
          Choose project folder
        </button>
        <div className="text-xs text-gray-300 max-w-sm text-center">
          History is saved in a <code className="font-mono">.shtuka-history</code> folder inside it,
          so it travels with your project.
        </div>
      </div>
    );
  }

  if (selected) {
    return (
      <TrackDetail
        root={root}
        track={selected}
        onBack={() => {
          setSelected(null);
          refreshList(root);
        }}
        onUpdate={setSelected}
      />
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 py-2.5 border-b border-gray-200 flex items-center gap-3 text-xs bg-white flex-shrink-0">
        <span className="text-gray-500">History root:</span>
        <span className="font-mono text-gray-700 truncate flex-1" title={root}>
          {root}
        </span>
        <button onClick={pickRoot} className="text-indigo-600 hover:underline">
          change
        </button>
        <button
          onClick={handleCreate}
          disabled={busy}
          className="px-3 py-1.5 bg-indigo-600 text-white font-medium rounded-md hover:bg-indigo-700 disabled:opacity-50"
        >
          + Track a file
        </button>
      </div>

      {error && (
        <div className="px-4 py-2 bg-red-50 text-red-700 text-sm border-b border-red-200 font-mono">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-auto p-4">
        {tracks.length === 0 ? (
          <div className="text-gray-400 text-sm text-center mt-12">
            No tracked files yet. Click <strong>+ Track a file</strong> to start a changelog.
          </div>
        ) : (
          <div className="space-y-2 max-w-3xl mx-auto">
            {tracks.map(t => (
              <button
                key={t.id}
                onClick={() => openTrack(t.id)}
                className="w-full text-left border border-gray-200 rounded-lg px-4 py-3 hover:border-indigo-400 hover:bg-indigo-50/30 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm text-gray-800">{t.name}</span>
                  <span className="text-xs text-gray-500">
                    {t.snapshotCount} version{t.snapshotCount > 1 ? 's' : ''}
                  </span>
                </div>
                <div className="text-xs text-gray-400 mt-1 flex items-center gap-2">
                  <span>last: {fmtDate(t.lastSnapshotAt)}</span>
                  {t.lastSourcePath && (
                    <>
                      <span>·</span>
                      <span className="font-mono truncate">{baseName(t.lastSourcePath)}</span>
                    </>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface TrackDetailProps {
  root: string;
  track: Track;
  onBack: () => void;
  onUpdate: (t: Track) => void;
}

function TrackDetail({ root, track, onBack, onUpdate }: TrackDetailProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  // Snapshot pair selected for diffing: [seqA, seqB].
  const [pair, setPair] = useState<[number, number] | null>(null);

  const snaps = [...track.snapshots].sort((a, b) => b.seq - a.seq); // newest first
  const latest = track.snapshots[track.snapshots.length - 1];

  const snapshot = async (reuse: boolean) => {
    setError(null);
    setInfo(null);
    let source = '';
    if (!reuse || !track.lastSourcePath) {
      const f = await SelectFile('Select the updated file');
      if (!f) return;
      source = f;
    }
    const note = window.prompt('Optional note for this version (leave blank to skip):', '') ?? '';
    setBusy(true);
    try {
      const res = await TakeSnapshot(root, track.id, source, note);
      onUpdate(res.track);
      setInfo(res.message);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const diffPrev = (s: Snapshot) => {
    const prev = track.snapshots.find(x => x.seq === s.seq - 1);
    if (prev) setPair([prev.seq, s.seq]);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 py-2.5 border-b border-gray-200 flex items-center gap-3 text-xs bg-white flex-shrink-0">
        <button
          onClick={onBack}
          className="flex items-center gap-1 px-2 py-1 -ml-1 rounded text-gray-600 hover:bg-gray-100"
        >
          <span className="text-sm leading-none">←</span> Tracks
        </button>
        <span className="w-px h-3 bg-gray-300" />
        <span className="font-medium text-gray-800">{track.name}</span>
        <span className="text-gray-400">· {track.snapshots.length} versions</span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => snapshot(true)}
            disabled={busy}
            title={track.lastSourcePath ? `Re-read ${baseName(track.lastSourcePath)}` : 'Pick a file'}
            className="px-3 py-1.5 bg-indigo-600 text-white font-medium rounded-md hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy ? 'Saving…' : '📸 Take snapshot'}
          </button>
          <button
            onClick={() => snapshot(false)}
            disabled={busy}
            className="px-3 py-1.5 border border-gray-300 text-gray-700 font-medium rounded-md hover:bg-gray-50 disabled:opacity-50"
          >
            from another file…
          </button>
        </div>
      </div>

      {track.lastSourcePath && (
        <div className="px-4 py-1 text-[11px] text-gray-400 bg-gray-50 border-b border-gray-100 flex-shrink-0 truncate">
          tracking source: <span className="font-mono">{track.lastSourcePath}</span>
        </div>
      )}
      {error && (
        <div className="px-4 py-2 bg-red-50 text-red-700 text-sm border-b border-red-200 font-mono">
          {error}
        </div>
      )}
      {info && (
        <div className="px-4 py-2 bg-green-50 text-green-700 text-sm border-b border-green-200">
          {info}
        </div>
      )}

      <div className="flex-1 overflow-auto p-4">
        <div className="max-w-3xl mx-auto">
          <ol className="relative border-l-2 border-gray-200 ml-3">
            {snaps.map(s => {
              const hasPrev = s.seq > 1;
              return (
                <li key={s.seq} className="mb-5 ml-5">
                  <span className="absolute -left-[9px] w-4 h-4 rounded-full bg-indigo-500 border-2 border-white" />
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-gray-800">v{s.seq}</span>
                    {s.seq === latest.seq && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700">
                        latest
                      </span>
                    )}
                    <span className="text-xs text-gray-400">{fmtDate(s.takenAt)}</span>
                  </div>
                  <div className="text-sm text-gray-700 mt-0.5">{s.summary || 'changed'}</div>
                  {s.note && (
                    <div className="text-sm text-gray-600 mt-1 border-l-2 border-amber-300 pl-2 italic">
                      {s.note}
                    </div>
                  )}
                  <div className="text-[11px] text-gray-400 mt-1 font-mono">
                    {s.sourceName} · {s.sha256.slice(0, 12)}
                  </div>
                  {hasPrev && (
                    <button
                      onClick={() => diffPrev(s)}
                      className="mt-1.5 text-xs text-indigo-600 hover:underline"
                    >
                      diff v{s.seq - 1} → v{s.seq}
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      </div>

      {pair && (
        <DiffView
          label={`${track.name}: v${pair[0]} → v${pair[1]}`}
          fetchKey={`${track.id}:${pair[0]}:${pair[1]}`}
          fetcher={() => DiffSnapshots(root, track.id, pair[0], pair[1]) as Promise<DiffResult>}
          trackContext={{ root, id: track.id }}
          onClose={() => setPair(null)}
        />
      )}
    </div>
  );
}
