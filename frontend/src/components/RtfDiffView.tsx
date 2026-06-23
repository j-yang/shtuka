import { RtfResult, RtfCell, RtfDiffCell, RtfDiffRow } from '../types';
import { CSSProperties } from 'react';

interface RtfDiffViewProps {
  result: RtfResult;
}

// Tint for a changed cell, per side. Modified shows amber on both sides.
function tint(status: RtfDiffCell['status'], side: 'a' | 'b'): string {
  if (status === 'modified') return 'outline outline-1 outline-amber-400';
  if (status === 'added' && side === 'b') return 'outline outline-1 outline-green-500';
  if (status === 'removed' && side === 'a') return 'outline outline-1 outline-red-500';
  return '';
}

function cellStyle(cell: RtfCell | undefined): CSSProperties {
  if (!cell) return {};
  const s = cell.style;
  const css: CSSProperties = {};
  if (s.bg) css.background = s.bg;
  if (s.color) css.color = s.color;
  if (s.align) css.textAlign = s.align as CSSProperties['textAlign'];
  if (s.bold) css.fontWeight = 600;
  if (s.mono) css.fontFamily = 'ui-monospace, "Courier New", monospace';
  if (s.fs) css.fontSize = `${s.fs / 2}pt`;
  if (s.widthPct) css.width = `${(s.widthPct * 100).toFixed(2)}%`;
  const b = '1px solid #999';
  if (s.bt) css.borderTop = b;
  if (s.bb) css.borderBottom = b;
  if (s.bl) css.borderLeft = b;
  if (s.br) css.borderRight = b;
  return css;
}

// The cells of one side of a row.
function sideCells(row: RtfDiffRow, side: 'a' | 'b') {
  return row.cells.map((dc, ci) => {
    const cell = side === 'a' ? dc.a : dc.b;
    const other = side === 'a' ? dc.b : dc.a;
    const segs = side === 'a' ? dc.aSegs : dc.bSegs;
    const title =
      dc.status === 'modified'
        ? side === 'a'
          ? `-> ${other?.text ?? ''}`
          : `was: ${other?.text ?? ''}`
        : undefined;
    // Modified cell with word-level segments: highlight only the changed words.
    const strong = side === 'a' ? 'bg-red-200 text-red-900' : 'bg-green-200 text-green-900';
    const content =
      dc.status === 'modified' && segs && segs.length > 0
        ? segs.map((s, k) =>
            s.changed ? (
              <span key={k} className={`rounded-sm ${strong}`}>
                {s.text}
              </span>
            ) : (
              <span key={k}>{s.text}</span>
            )
          )
        : cell
        ? cell.text
        : '';
    return (
      <td
        key={`${side}-${ci}`}
        title={title}
        className={`align-top px-1.5 py-0.5 whitespace-pre-wrap break-words ${tint(dc.status, side)}`}
        style={cellStyle(cell)}
      >
        {content}
      </td>
    );
  });
}

export function RtfDiffView({ result }: RtfDiffViewProps) {
  const rows = result.rows;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 py-1.5 border-b border-gray-100 bg-gray-50 flex items-center gap-3 text-xs flex-shrink-0">
        <span className="text-gray-500">{result.rows.length} rows</span>
        <span className="text-gray-300">·</span>
        <span className="text-green-700">{result.added} added</span>
        <span className="text-amber-700">{result.modified} modified</span>
        <span className="text-red-700">{result.removed} removed</span>
        <span className="ml-auto text-[10px] text-gray-400">left: old · right: new</span>
      </div>
      {/* Single table: each logical row holds A's cells | divider | B's cells in
          one <tr>, so the two sides stay row-aligned regardless of text wrapping.
          Each side is a nested table so it keeps its own column widths. */}
      <div className="flex-1 overflow-auto bg-white">
        <table className="border-collapse text-xs w-full" style={{ tableLayout: 'fixed' }}>
          <tbody>
            {rows.map((row, ri) => {
              const rowBg =
                row.status === 'added'
                  ? 'rgba(34,197,94,0.06)'
                  : row.status === 'removed'
                  ? 'rgba(239,68,68,0.06)'
                  : row.status === 'modified'
                  ? 'rgba(245,158,11,0.05)'
                  : undefined;
              return (
                <tr key={ri} style={{ background: rowBg }}>
                  <td className="p-0 align-top border-r-2 border-gray-300" style={{ width: '50%' }}>
                    <table className="border-collapse w-full" style={{ tableLayout: 'fixed' }}>
                      <tbody>
                        <tr>{sideCells(row, 'a')}</tr>
                      </tbody>
                    </table>
                  </td>
                  <td className="p-0 align-top" style={{ width: '50%' }}>
                    <table className="border-collapse w-full" style={{ tableLayout: 'fixed' }}>
                      <tbody>
                        <tr>{sideCells(row, 'b')}</tr>
                      </tbody>
                    </table>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
