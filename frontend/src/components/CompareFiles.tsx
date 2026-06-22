import { useState } from 'react';
import { FilePicker } from './FilePicker';
import { DiffView } from './DiffView';

function baseName(p: string): string {
  return p.split(/[/\\]/).pop() || p;
}

export function CompareFiles() {
  const [fileA, setFileA] = useState('');
  const [fileB, setFileB] = useState('');
  // The pair currently being diffed; null until the user clicks Compare.
  const [active, setActive] = useState<{ a: string; b: string } | null>(null);

  return (
    <div className="flex-1 flex flex-col overflow-hidden relative">
      <div className="border-b border-gray-200 p-4 bg-white flex-shrink-0">
        <div className="flex gap-3 items-end">
          <FilePicker label="File A" value={fileA} onChange={setFileA} />
          <div className="text-gray-400 pb-2">→</div>
          <FilePicker label="File B" value={fileB} onChange={setFileB} />
          <button
            onClick={() => setActive({ a: fileA, b: fileB })}
            disabled={!fileA || !fileB}
            className="px-6 py-2 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
          >
            Compare
          </button>
        </div>
        <div className="text-[11px] text-gray-400 mt-2">
          The two files need not share a name — shtuka diffs by content and format.
        </div>
      </div>

      {!active && (
        <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
          <div className="text-4xl mb-2 opacity-30">⇌</div>
          <div className="text-sm">Pick two files and click Compare</div>
        </div>
      )}

      {active && (
        <DiffView
          pathA={active.a}
          pathB={active.b}
          label={`${baseName(active.a)} ↔ ${baseName(active.b)}`}
          onClose={() => setActive(null)}
        />
      )}
    </div>
  );
}
