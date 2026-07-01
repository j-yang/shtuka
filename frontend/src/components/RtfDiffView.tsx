import { RtfResult, RtfCell, RtfDiffCell, RtfDiffRow } from '../types';
import { CSSProperties, Fragment, useState } from 'react';

interface RtfDiffViewProps {
  result: RtfResult;
}

// SAS RTF tables are laid out for a MONOSPACE font: hierarchy (SOC vs indented
// PT) and numeric right-alignment are both encoded as leading/embedded spaces
// that only line up in a fixed-pitch font. So we render the whole table
// monospace with preserved whitespace, mirroring the source's own alignment
// rather than trying to re-lay-it-out proportionally.
const MONO_STACK = 'ui-monospace, "Cascadia Mono", "Consolas", "Courier New", monospace';
// Baseline body font size (pt) that a cell's \fs maps to at 100% zoom. SAS body
// text is \fs18 (9pt); we render it a touch smaller so dense tables fit, and
// let zoom scale from there.
const BASE_FONT_PT = 8;
const BASE_FS_HALF_POINTS = 18; // \fs18 = the body baseline
const ZOOM_MIN = 0.6;
const ZOOM_MAX = 2.5;
const ZOOM_STEP = 0.1;

// --- Diff presentation constants (all visual tuning lives here) -------------
// Whole-row add/remove background tint, applied to BOTH sides so the reader sees
// the row was inserted/deleted (the empty opposite side is tinted too).
const ADDED_BG = 'rgba(34,197,94,0.14)'; // green-500 @ 14%
const REMOVED_BG = 'rgba(239,68,68,0.14)'; // red-500 @ 14%
// Inline word-level highlight for a modified cell, per side (Tailwind classes).
const MODIFIED_SEG_A = 'bg-red-200 text-red-900'; // old side: removed words
const MODIFIED_SEG_B = 'bg-green-200 text-green-900'; // new side: added words
// Vertical spacing.
const SPACER_ROW_HEIGHT = '0.6em'; // blank SAS spacer rows (e.g. between SOCs)
const REGION_GAP_HEIGHT = '1.4em'; // gap at header→body / body→footer boundary

// Per-cell background tint. We do NOT box/outline modified cells — the changed
// words are highlighted inline instead. Added → green on both sides; Removed →
// red on both sides.
function cellBg(status: RtfDiffCell['status']): string | undefined {
  if (status === 'added') return ADDED_BG;
  if (status === 'removed') return REMOVED_BG;
  return undefined;
}

function cellStyle(cell: RtfCell | undefined): CSSProperties {
  if (!cell) return {};
  const s = cell.style;
  const css: CSSProperties = {};
  if (s.bg) css.background = s.bg;
  if (s.color) css.color = s.color;
  if (s.align) css.textAlign = s.align as CSSProperties['textAlign'];
  if (s.bold) css.fontWeight = 600;
  // Everything is monospace (see MONO_STACK note); `s.mono` no longer branches.
  // Render \fs relative to the baseline as `em`, so the container's base
  // font-size (driven by zoom) scales every cell while preserving the source's
  // relative sizing (a \fs28 title stays proportionally bigger than \fs18 body).
  if (s.fs) css.fontSize = `${(s.fs / BASE_FS_HALF_POINTS).toFixed(3)}em`;
  if (s.widthPct) css.width = `${(s.widthPct * 100).toFixed(2)}%`;
  return css;
}

// Column widths come from whichever side has the cell; a blank opposite side
// (an added/removed row) borrows them so both columns line up.
function widthFrom(dc: RtfDiffCell): CSSProperties {
  const w = dc.a?.style.widthPct ?? dc.b?.style.widthPct;
  return w ? { width: `${(w * 100).toFixed(2)}%` } : {};
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
    // Inline highlight for the words that changed within a modified cell.
    const strong = side === 'a' ? MODIFIED_SEG_A : MODIFIED_SEG_B;
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
    // Blank opposite side of an added/removed row: keep the column width (so the
    // present side stays aligned) and tint it faintly to show "nothing here".
    const bg = cellBg(dc.status);
    const style: CSSProperties = cell
      ? { ...cellStyle(cell), ...(bg ? { background: bg } : {}) }
      : { ...widthFrom(dc), ...(bg ? { background: bg } : {}) };
    return (
      <td
        key={`${side}-${ci}`}
        title={title}
        className="align-top px-1 py-0 whitespace-pre-wrap"
        style={style}
      >
        {content}
      </td>
    );
  });
}

export function RtfDiffView({ result }: RtfDiffViewProps) {
  const rows = result.rows;
  const [zoom, setZoom] = useState(1);
  const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 py-1.5 border-b border-gray-100 bg-gray-50 flex items-center gap-3 text-xs flex-shrink-0">
        <span className="text-gray-500">{result.rows.length} rows</span>
        <span className="text-gray-300">·</span>
        <span className="text-green-700">{result.added} added</span>
        <span className="text-amber-700">{result.modified} modified</span>
        <span className="text-red-700">{result.removed} removed</span>
        <div className="ml-auto flex items-center gap-1">
          <button
            className="px-1.5 py-0.5 rounded border border-gray-300 text-gray-600 hover:bg-gray-100 leading-none"
            title="Zoom out"
            onClick={() => setZoom((z) => clampZoom(z - ZOOM_STEP))}
          >
            A−
          </button>
          <button
            className="px-1.5 py-0.5 rounded border border-gray-300 text-gray-500 hover:bg-gray-100 leading-none tabular-nums"
            title="Reset zoom"
            onClick={() => setZoom(1)}
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            className="px-1.5 py-0.5 rounded border border-gray-300 text-gray-600 hover:bg-gray-100 leading-none"
            title="Zoom in"
            onClick={() => setZoom((z) => clampZoom(z + ZOOM_STEP))}
          >
            A+
          </button>
          <span className="ml-2 text-[10px] text-gray-400">left: old · right: new</span>
        </div>
      </div>
      {/* Single table: each logical row holds A's cells | divider | B's cells in
          one <tr>, so the two sides stay row-aligned regardless of text wrapping.
          Each side is a nested table so it keeps its own column widths. */}
      <div
        className="flex-1 overflow-auto bg-white"
        style={{
          fontSize: `${(BASE_FONT_PT * zoom).toFixed(2)}pt`,
          lineHeight: 1.15,
          fontFamily: MONO_STACK,
        }}
      >
        <table className="border-collapse w-full" style={{ tableLayout: 'fixed' }}>
          <tbody>
            {rows.map((row, ri) => {
              // No row-level background: modified rows show inline word
              // highlights only; added/removed rows are tinted per-cell (both
              // sides) inside sideCells.
              // A row whose cells are all empty is a SAS spacer row (e.g. between
              // SOCs). Give it a small fixed height so the gap is visible in our
              // compact line-height instead of collapsing to nothing.
              const isSpacer = row.cells.every(
                (dc) => !(dc.a?.text || '').trim() && !(dc.b?.text || '').trim()
              );
              // The title block (header region) sits directly next to the table
              // body with no blank row between them in the source. Insert a
              // dedicated spacer row at the region boundary (header→body,
              // body→footer) so the title stands clearly apart from the table.
              const prevRegion = ri > 0 ? rows[ri - 1].region : row.region;
              const regionBreak = ri > 0 && row.region !== prevRegion;
              return (
                <Fragment key={ri}>
                  {regionBreak && (
                    <tr aria-hidden="true">
                      <td colSpan={2} style={{ height: REGION_GAP_HEIGHT, padding: 0 }} />
                    </tr>
                  )}
                <tr
                  style={isSpacer ? { height: SPACER_ROW_HEIGHT } : undefined}
                >
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
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
