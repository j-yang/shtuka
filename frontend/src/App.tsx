import { useState } from 'react';
import { Toolbar } from './components/Toolbar';
import { DualTree } from './components/DualTree';
import { DiffView } from './components/DiffView';
import { CompareFiles } from './components/CompareFiles';
import { TrackView } from './components/TrackView';
import { UpdateChecker } from './components/UpdateChecker';
import { Comparison } from './types';
import { CompareFolders } from '../wailsjs/go/main/App';

type Mode = 'folders' | 'files' | 'track';

interface DiffTarget {
  pathA: string;
  pathB: string;
  label: string;
}

// Join a folder root and a relative path. An empty rel means the file is absent
// on that side (added/removed); pass '' through so the backend diffs against empty.
function joinPath(root: string, rel: string): string {
  if (!rel) return '';
  return `${root.replace(/[/\\]+$/, '')}/${rel}`;
}

export default function App() {
  const [mode, setMode] = useState<Mode>('folders');
  const [folderA, setFolderA] = useState('');
  const [folderB, setFolderB] = useState('');
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [diffTarget, setDiffTarget] = useState<DiffTarget | null>(null);
  const [comparing, setComparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trackRoot, setTrackRoot] = useState('');

  const handleCompare = async () => {
    setComparing(true);
    setError(null);
    setComparison(null);
    setDiffTarget(null);
    try {
      const result = await CompareFolders(folderA, folderB);
      setComparison(result as Comparison);
    } catch (e) {
      setError(String(e));
    } finally {
      setComparing(false);
    }
  };

  const openDiff = (relA: string, relB: string, label: string) => {
    setDiffTarget({
      pathA: joinPath(folderA, relA),
      pathB: joinPath(folderB, relB),
      label,
    });
  };

  const tab = (m: Mode, text: string) => (
    <button
      onClick={() => setMode(m)}
      className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
        mode === m ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-100'
      }`}
    >
      {text}
    </button>
  );

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Thin brand-gradient accent line at the very top. */}
      <div className="h-0.5 bg-gradient-to-r from-indigo-500 via-violet-500 to-indigo-500 flex-shrink-0" />
      <header className="px-4 py-2.5 border-b border-gray-200 flex items-center justify-between bg-white flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            {/* Brand mark: the Cyrillic ш (shtuka), echoing the app icon. */}
            <svg width="20" height="20" viewBox="0 0 1024 1024" className="rounded-[5px] shadow-sm" aria-label="shtuka">
              <defs>
                <linearGradient id="brand" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="#6366f1" />
                  <stop offset="1" stopColor="#7c3aed" />
                </linearGradient>
              </defs>
              <rect width="1024" height="1024" rx="224" fill="url(#brand)" />
              <g fill="#fff">
                <rect x="276" y="320" width="92" height="320" rx="18" />
                <rect x="466" y="320" width="92" height="320" rx="18" />
                <rect x="656" y="320" width="92" height="320" rx="18" />
                <rect x="276" y="620" width="472" height="92" rx="18" />
              </g>
            </svg>
            <span className="font-semibold text-sm tracking-tight bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent">
              shtuka
            </span>
          </div>
          <div className="flex items-center gap-1 ml-2">
            {tab('folders', 'Folders')}
            {tab('files', 'Files')}
            {tab('track', 'Track')}
          </div>
        </div>
        <div className="flex items-center gap-3">
        {mode === 'folders' && comparison && (
          <div className="flex items-center gap-3 text-xs">
            <span className="text-gray-500">
              {comparison.summary.totalA} → {comparison.summary.totalB} files
            </span>
            <span className="w-px h-3 bg-gray-200" />
            {comparison.summary.modified > 0 && (
              <span className="text-amber-700">
                <strong>{comparison.summary.modified}</strong> modified
              </span>
            )}
            {comparison.summary.added > 0 && (
              <span className="text-green-700">
                <strong>+{comparison.summary.added}</strong>
              </span>
            )}
            {comparison.summary.removed > 0 && (
              <span className="text-red-700">
                <strong>−{comparison.summary.removed}</strong>
              </span>
            )}
            {comparison.summary.renamed > 0 && (
              <span className="text-blue-700">
                <strong>~{comparison.summary.renamed}</strong> renamed
              </span>
            )}
          </div>
        )}
          <UpdateChecker />
        </div>
      </header>

      {mode === 'folders' && (
        <>
          <Toolbar
            folderA={folderA}
            folderB={folderB}
            onFolderAChange={setFolderA}
            onFolderBChange={setFolderB}
            onCompare={handleCompare}
            comparing={comparing}
          />

          {error && (
            <div className="px-4 py-2 bg-red-50 text-red-700 text-sm border-b border-red-200 font-mono">
              {error}
            </div>
          )}

          <div className="flex-1 flex overflow-hidden relative">
            {comparison ? (
              <DualTree comparison={comparison} onOpenDiff={openDiff} />
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
                <div className="text-4xl mb-2 bg-gradient-to-br from-indigo-400 to-violet-400 bg-clip-text text-transparent">⇌</div>
                <div className="text-sm">Select two folders and click Compare</div>
                <div className="text-xs mt-1 text-gray-300">
                  Supports text, CSV, Excel (.xlsx), Word (.docx), PDF, RTF
                </div>
              </div>
            )}

            {diffTarget && (
              <DiffView
                pathA={diffTarget.pathA}
                pathB={diffTarget.pathB}
                label={diffTarget.label}
                onClose={() => setDiffTarget(null)}
              />
            )}
          </div>
        </>
      )}

      {mode === 'files' && <CompareFiles />}

      {mode === 'track' && <TrackView root={trackRoot} onRootChange={setTrackRoot} />}
    </div>
  );
}
