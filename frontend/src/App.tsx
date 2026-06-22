import { useState } from 'react';
import { Toolbar } from './components/Toolbar';
import { DualTree } from './components/DualTree';
import { DiffView } from './components/DiffView';
import { CompareFiles } from './components/CompareFiles';
import { TrackView } from './components/TrackView';
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
      <header className="px-4 py-2.5 border-b border-gray-200 flex items-center justify-between bg-white flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-indigo-500" />
            <span className="font-semibold text-sm tracking-tight">shtuka</span>
          </div>
          <div className="flex items-center gap-1 ml-2">
            {tab('folders', 'Folders')}
            {tab('files', 'Files')}
            {tab('track', 'Track')}
          </div>
        </div>
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
                <div className="text-4xl mb-2 opacity-30">⇌</div>
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
