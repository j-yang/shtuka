import { useEffect, useState } from 'react';
import { VarHistory } from '../types';
import { VariableHistory } from '../../wailsjs/go/main/App';

interface VarHistoryViewProps {
  root: string;
  trackId: string;
  sheet: string;
  varName: string;
  onClose: () => void;
}

function fmtDate(epoch: number): string {
  if (!epoch) return '';
  return new Date(epoch * 1000).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// Version × column matrix for one variable across all snapshots of a track.
// Rows = versions (v1..vN), columns = that variable's attributes; cells that
// changed from the previous version are highlighted.
export function VarHistoryView({ root, trackId, sheet, varName, onClose }: VarHistoryViewProps) {
  const [hist, setHist] = useState<VarHistory | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setHist(null);
    setError(null);
    VariableHistory(root, trackId, sheet, varName)
      .then(h => setHist(h as VarHistory))
      .catch(e => setError(String(e)));
  }, [root, trackId, sheet, varName]);

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-white">
      <div className="px-4 py-2 border-b border-gray-200 bg-gray-50 flex items-center gap-3 text-xs flex-shrink-0">
        <button
          onClick={onClose}
          className="flex items-center gap-1 px-2 py-1 -ml-1 rounded text-gray-600 hover:bg-gray-200"
        >
          <span className="text-sm leading-none">←</span> Back
        </button>
        <span className="w-px h-3 bg-gray-300" />
        <span className="font-mono text-gray-700">
          {sheet} · <strong>{varName}</strong>
        </span>
        <span className="text-gray-400">— evolution across versions</span>
      </div>

      {error && <div className="p-4 text-red-600 text-sm font-mono">{error}</div>}
      {!hist && !error && (
        <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">Loading history…</div>
      )}

      {hist && (
        <div className="flex-1 overflow-auto p-3">
          <table className="border-collapse text-xs">
            <thead>
              <tr className="bg-gray-100">
                <th className="sticky left-0 bg-gray-100 border border-gray-200 px-2 py-1 text-left">Version</th>
                {hist.headers.map((h, i) => (
                  <th key={i} className="border border-gray-200 px-2 py-1 text-left whitespace-nowrap">
                    {h || `col ${i + 1}`}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {hist.rows.map(row => (
                <tr key={row.seq} className="align-top">
                  <td className="sticky left-0 bg-white border border-gray-200 px-2 py-1 whitespace-nowrap font-medium">
                    v{row.seq}
                    <span className="text-gray-400 font-normal ml-1">{fmtDate(row.takenAt)}</span>
                  </td>
                  {!row.present ? (
                    <td
                      colSpan={hist.headers.length || 1}
                      className="border border-gray-200 px-2 py-1 text-gray-400 italic"
                    >
                      (not present in this version)
                    </td>
                  ) : (
                    hist.headers.map((_, i) => {
                      const v = row.cells[i] ?? '';
                      const changed = row.changed[i];
                      return (
                        <td
                          key={i}
                          className={`border border-gray-200 px-2 py-1 whitespace-pre-wrap break-words max-w-[260px] ${
                            changed ? 'bg-amber-200 text-amber-900 font-medium' : ''
                          }`}
                        >
                          {v}
                        </td>
                      );
                    })
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
