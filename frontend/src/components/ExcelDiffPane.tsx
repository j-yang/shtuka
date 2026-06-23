import { useMemo, useState } from 'react';
import { ExcelResult, SheetDiff, GridRow, TrackContext } from '../types';
import { VarHistoryView } from './VarHistoryView';

// Tab color reflects the sheet's overall status.
const tabStatusClass: Record<SheetDiff['status'], string> = {
  added: 'text-green-700',
  removed: 'text-red-700',
  modified: 'text-amber-700',
  equal: 'text-gray-500',
};

const tabDot: Record<SheetDiff['status'], string> = {
  added: 'bg-green-500',
  removed: 'bg-red-500',
  modified: 'bg-amber-500',
  equal: 'bg-gray-300',
};

export function ExcelDiffPane({ result, trackContext }: { result: ExcelResult; trackContext?: TrackContext }) {
  // Show whole sheets flattened; the row toggle collapses unchanged runs.
  const [showAllRows, setShowAllRows] = useState(true);
  // Unchanged sheets are hidden by default; this reveals them.
  const [showAllSheets, setShowAllSheets] = useState(false);
  const [activeName, setActiveName] = useState<string | null>(null);
  // When in a Track snapshot diff, clicking a variable name opens its history.
  const [histVar, setHistVar] = useState<string | null>(null);

  const changedCount = result.sheets.filter(s => s.status !== 'equal').length;

  // Tabs honor the "show unchanged sheets" toggle; if everything is unchanged,
  // show all so the pane is never empty.
  const visible = useMemo(() => {
    if (showAllSheets || changedCount === 0) return result.sheets;
    return result.sheets.filter(s => s.status !== 'equal');
  }, [result.sheets, showAllSheets, changedCount]);

  // Resolve the active sheet by name so it survives filter toggles.
  const sheet =
    visible.find(s => s.name === activeName) ?? visible[0] ?? null;

  const hiddenCount = result.sheets.length - visible.length;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Sheet tabs */}
      <div className="flex items-stretch border-b border-gray-200 bg-gray-50 overflow-x-auto flex-shrink-0">
        {visible.map(s => (
          <button
            key={s.name}
            onClick={() => setActiveName(s.name)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs border-r border-gray-200 whitespace-nowrap transition-colors ${
              sheet?.name === s.name ? 'bg-white font-semibold' : 'hover:bg-gray-100'
            } ${tabStatusClass[s.status]}`}
            title={sheetSummary(s)}
          >
            <span className={`w-2 h-2 rounded-full ${tabDot[s.status]}`} />
            {s.name}
            {s.status !== 'equal' && <span className="opacity-70">{statusMark(s)}</span>}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-3 px-3 flex-shrink-0">
          {hiddenCount > 0 && (
            <button
              onClick={() => setShowAllSheets(true)}
              className="text-[11px] text-indigo-600 hover:underline whitespace-nowrap"
            >
              show {hiddenCount} unchanged sheet{hiddenCount > 1 ? 's' : ''}
            </button>
          )}
          {showAllSheets && changedCount < result.sheets.length && (
            <button
              onClick={() => setShowAllSheets(false)}
              className="text-[11px] text-gray-500 hover:underline whitespace-nowrap"
            >
              hide unchanged sheets
            </button>
          )}
          <label className="flex items-center gap-1.5 text-[11px] text-gray-500 cursor-pointer whitespace-nowrap">
            <input
              type="checkbox"
              checked={showAllRows}
              onChange={e => setShowAllRows(e.target.checked)}
              className="accent-indigo-600"
            />
            show unchanged rows
          </label>
        </div>
      </div>

      {sheet ? (
        <SheetGrid
          key={sheet.name}
          sheet={sheet}
          showAll={showAllRows}
          onVar={trackContext ? setHistVar : undefined}
        />
      ) : (
        <div className="p-4 text-gray-400 text-sm">No sheets</div>
      )}

      {trackContext && sheet && histVar && (
        <VarHistoryView
          root={trackContext.root}
          trackId={trackContext.id}
          sheet={sheet.name}
          varName={histVar}
          onClose={() => setHistVar(null)}
        />
      )}
    </div>
  );
}

function statusMark(s: SheetDiff): string {
  if (s.status === 'added') return '+';
  if (s.status === 'removed') return '−';
  return '~';
}

function sheetSummary(s: SheetDiff): string {
  const parts: string[] = [];
  if (s.addedRows) parts.push(`+${s.addedRows} rows`);
  if (s.removedRows) parts.push(`−${s.removedRows} rows`);
  if (s.modifiedRows) parts.push(`~${s.modifiedRows} rows`);
  if (s.addedCols) parts.push(`+${s.addedCols} cols`);
  if (s.removedCols) parts.push(`−${s.removedCols} cols`);
  return parts.length ? parts.join(', ') : 'no changes';
}

const CONTEXT = 2; // unchanged rows kept around a change before collapsing

interface DisplayItem {
  kind: 'row' | 'collapsed';
  row?: GridRow;
  index?: number;
  count?: number; // collapsed count
  fromIdx?: number;
}

function SheetGrid({ sheet, showAll, onVar }: { sheet: SheetDiff; showAll: boolean; onVar?: (varName: string) => void }) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  // Decide which unchanged rows to hide. Keep CONTEXT rows around any change.
  const items = useMemo<DisplayItem[]>(() => {
    const rows = sheet.rows;
    const keep = new Array(rows.length).fill(showAll);
    if (!showAll) {
      rows.forEach((r, i) => {
        if (r.status !== 'equal') {
          for (let k = Math.max(0, i - CONTEXT); k <= Math.min(rows.length - 1, i + CONTEXT); k++) {
            keep[k] = true;
          }
        }
      });
    }

    const out: DisplayItem[] = [];
    let i = 0;
    while (i < rows.length) {
      if (keep[i]) {
        out.push({ kind: 'row', row: rows[i], index: i });
        i++;
      } else {
        const start = i;
        while (i < rows.length && !keep[i]) i++;
        out.push({ kind: 'collapsed', count: i - start, fromIdx: start });
      }
    }
    return out;
  }, [sheet, showAll]);

  const toggle = (fromIdx: number) =>
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(fromIdx)) next.delete(fromIdx);
      else next.add(fromIdx);
      return next;
    });

  const colCount = sheet.columns.length;

  return (
    <div className="flex-1 overflow-auto">
      <table className="border-collapse text-xs font-mono w-max">
        <thead className="sticky top-0 z-10">
          <tr>
            <th className="sticky left-0 z-20 bg-gray-100 border border-gray-200 px-2 py-1 text-gray-400 font-normal w-20">
              <span className="text-red-500">A</span>/<span className="text-green-600">B</span>
            </th>
            {sheet.columns.map((c, ci) => (
              <th
                key={ci}
                className={`border border-gray-200 px-2 py-1 text-left font-semibold whitespace-nowrap ${
                  c.status === 'added'
                    ? 'bg-green-100 text-green-800'
                    : c.status === 'removed'
                    ? 'bg-red-100 text-red-800 line-through'
                    : 'bg-gray-100 text-gray-700'
                }`}
                title={c.status !== 'equal' ? `${c.status} column` : c.name}
              >
                {c.status === 'added' && '+ '}
                {c.status === 'removed' && '− '}
                {c.name || <span className="text-gray-300">(blank)</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item, idx) => {
            if (item.kind === 'collapsed') {
              const isOpen = expanded.has(item.fromIdx!);
              if (!isOpen) {
                return (
                  <tr key={`c-${idx}`} className="bg-gray-50">
                    <td
                      colSpan={colCount + 1}
                      onClick={() => toggle(item.fromIdx!)}
                      className="border border-gray-200 px-3 py-1 text-center text-gray-500 cursor-pointer hover:bg-gray-100 italic"
                    >
                      ⋯ {item.count} unchanged row{item.count! > 1 ? 's' : ''} — click to expand
                    </td>
                  </tr>
                );
              }
              // Expanded: render the hidden rows, with a collapse affordance first.
              const rows = sheet.rows.slice(item.fromIdx!, item.fromIdx! + item.count!);
              return (
                <RowsFragment
                  key={`e-${idx}`}
                  rows={rows}
                  baseIdx={item.fromIdx!}
                  onCollapse={() => toggle(item.fromIdx!)}
                  onVar={onVar}
                />
              );
            }
            return <Row key={`r-${item.index}`} row={item.row!} onVar={onVar} />;
          })}
        </tbody>
      </table>
    </div>
  );
}

function RowsFragment({
  rows,
  onCollapse,
  onVar,
}: {
  rows: GridRow[];
  baseIdx: number;
  onCollapse: () => void;
  onVar?: (varName: string) => void;
}) {
  return (
    <>
      <tr className="bg-gray-50">
        <td
          colSpan={(rows[0]?.cells.length || 0) + 1}
          onClick={onCollapse}
          className="border border-gray-200 px-3 py-0.5 text-center text-gray-400 cursor-pointer hover:bg-gray-100 italic text-[10px]"
        >
          ▲ collapse
        </td>
      </tr>
      {rows.map((r, i) => (
        <Row key={i} row={r} onVar={onVar} />
      ))}
    </>
  );
}

const rowBg: Record<GridRow['status'], string> = {
  added: 'bg-green-50',
  removed: 'bg-red-50',
  modified: '',
  equal: '',
};

function Row({ row, onVar }: { row: GridRow; onVar?: (varName: string) => void }) {
  // Emphasize a detected, unchanged header row; if the header row itself changed,
  // its change status colors take precedence.
  const headerStyle = row.header && row.status === 'equal';
  // First cell is the variable name in mapping specs; make it the history entry
  // point on data rows when track context is available.
  const c0 = row.cells[0];
  const varName = (c0?.new || c0?.old || '').trim();
  const canHistory = !!onVar && !row.header && !!varName;
  return (
    <tr className={`${rowBg[row.status]} ${headerStyle ? 'bg-slate-100 font-semibold text-slate-800' : ''}`}>
      <td className="sticky left-0 z-10 bg-inherit border border-gray-200 px-2 py-1 text-gray-400 whitespace-nowrap text-[10px]">
        {row.status === 'added' ? (
          <span className="text-green-600">+{row.rowB}</span>
        ) : row.status === 'removed' ? (
          <span className="text-red-500">−{row.rowA}</span>
        ) : (
          <span>{row.rowB || row.rowA}</span>
        )}
      </td>
      {row.cells.map((c, ci) =>
        ci === 0 && canHistory ? (
          <td
            key={ci}
            onClick={() => onVar!(varName)}
            title={`View "${varName}" history across versions`}
            className="border border-gray-200 px-2 py-1 whitespace-nowrap min-w-[3rem] max-w-[28rem] truncate text-indigo-700 underline decoration-dotted cursor-pointer hover:bg-indigo-50"
          >
            {c.new || c.old}
          </td>
        ) : (
          <Cell key={ci} change={c} header={headerStyle} />
        )
      )}
    </tr>
  );
}

function Cell({ change, header }: { change: { status: string; old?: string; new?: string }; header?: boolean }) {
  if (header && change.status === 'equal') {
    return (
      <td className="border border-gray-300 px-2 py-1 bg-slate-100 text-slate-800 font-semibold whitespace-nowrap min-w-[3rem] max-w-[28rem] truncate">
        {change.new || change.old || ' '}
      </td>
    );
  }
  if (change.status === 'modified') {
    return (
      <td
        className="border border-gray-200 px-2 py-1 bg-amber-100 text-amber-900 whitespace-nowrap cursor-help min-w-[3rem] max-w-[28rem] truncate"
        title={`was: ${change.old || '(empty)'}`}
      >
        {change.new || <span className="text-gray-400">(empty)</span>}
        <span className="ml-1 text-amber-400 text-[10px]">●</span>
      </td>
    );
  }
  if (change.status === 'added') {
    return (
      <td className="border border-gray-200 px-2 py-1 bg-green-50 text-green-900 whitespace-nowrap min-w-[3rem] max-w-[28rem] truncate">
        {change.new || ' '}
      </td>
    );
  }
  if (change.status === 'removed') {
    return (
      <td className="border border-gray-200 px-2 py-1 bg-red-50 text-red-900 whitespace-nowrap line-through min-w-[3rem]">
        {change.old || ' '}
      </td>
    );
  }
  return (
    <td className="border border-gray-200 px-2 py-1 text-gray-700 whitespace-nowrap min-w-[3rem] max-w-[28rem] truncate">
      {change.new || change.old || ' '}
    </td>
  );
}
