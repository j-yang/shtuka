import { useEffect, useMemo, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { DiffResult, TextResult, DocxResult, TrackContext } from '../types';
import { DiffFiles } from '../../wailsjs/go/main/App';
import { ExcelDiffPane } from './ExcelDiffPane';
import { PdfPagesView } from './PdfPagesView';
import { RtfDiffView } from './RtfDiffView';
import { XmlDiffView } from './XmlDiffView';

const isPdf = (p?: string) => !!p && /\.pdf$/i.test(p);

interface PdfProgress {
  side: string;
  done: number;
  total: number;
}

interface DiffViewProps {
  // Path pair for a plain file diff. Ignored when `fetcher` is provided.
  pathA?: string;
  pathB?: string;
  label: string;
  onClose: () => void;
  // Optional custom loader (e.g. snapshot-pair diff). When set, it is used
  // instead of the default path-based DiffFiles call. `fetchKey` re-runs it.
  fetcher?: () => Promise<DiffResult>;
  fetchKey?: string;
  // When this diff is a Track snapshot pair, the Excel pane lets you open a
  // variable's history across all snapshots.
  trackContext?: TrackContext;
}

export function DiffView({ pathA, pathB, label, onClose, fetcher, fetchKey, trackContext }: DiffViewProps) {
  const [result, setResult] = useState<DiffResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<PdfProgress | null>(null);
  // Direct PDF diffs render the original pages with overlay highlights — the
  // primary view. (Snapshot PDF diffs go through `fetcher` and lack file paths,
  // so they fall back to the text diff.)
  const pdfPagesView = !fetcher && isPdf(pathA) && isPdf(pathB);

  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const syncing = useRef(false);

  useEffect(() => {
    // The rendered-pages view loads its own data; skip the text extraction.
    if (pdfPagesView) {
      setLoading(false);
      setResult(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    setProgress(null);
    // Listen for PDF extraction progress emitted by the backend (large PDFs).
    const unlisten = listen<PdfProgress>('pdf-progress', e => setProgress(e.payload));
    const load = fetcher ? fetcher() : DiffFiles(pathA || '', pathB || '');
    load
      .then(r => setResult(r as DiffResult))
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
    return () => {
      unlisten.then(f => f());
    };
  }, [pathA, pathB, fetchKey, pdfPagesView]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleScroll = (source: 'left' | 'right') => (e: React.UIEvent<HTMLDivElement>) => {
    if (syncing.current) {
      syncing.current = false;
      return;
    }
    const target = source === 'left' ? rightRef.current : leftRef.current;
    if (target) {
      syncing.current = true;
      target.scrollTop = e.currentTarget.scrollTop;
      target.scrollLeft = e.currentTarget.scrollLeft;
    }
  };

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-white">
      <div className="px-4 py-2 border-b border-gray-200 bg-gray-50 flex items-center gap-3 text-xs flex-shrink-0">
        <button
          onClick={onClose}
          className="flex items-center gap-1 px-2 py-1 -ml-1 rounded text-gray-600 hover:bg-gray-200 transition-colors"
          title="Back to tree (Esc)"
        >
          <span className="text-sm leading-none">←</span> Back
        </button>
        <span className="w-px h-3 bg-gray-300" />
        <span className="font-mono text-gray-700 truncate">{label}</span>
        {(result || pdfPagesView) && (
          <>
            <span className="text-gray-400">•</span>
            <span className="text-gray-500 uppercase tracking-wider">
              {pdfPagesView ? 'pdf' : result?.fileType}
            </span>
          </>
        )}
        <span className="ml-auto text-[10px] text-gray-400">Esc to close</span>
      </div>

      {result?.excel?.notes && result.excel.notes.length > 0 && (
        <div className="px-4 py-1.5 bg-yellow-50 border-b border-yellow-200 text-[11px] text-yellow-800 flex-shrink-0">
          ⚠ {result.excel.notes.join('; ')}
        </div>
      )}

      <div className="flex-1 flex overflow-hidden relative">
        {pdfPagesView ? (
          <PdfPagesView pathA={pathA!} pathB={pathB!} />
        ) : (
          <>
            {loading && (
              <div className="flex-1 flex flex-col items-center justify-center text-gray-400 text-sm gap-2">
                <div>Loading diff…</div>
                {progress && progress.total > 0 && (
                  <div className="text-xs text-gray-500">
                    Extracting PDF {progress.side} — page {progress.done} / {progress.total}
                    <div className="mt-1 w-48 h-1 bg-gray-200 rounded overflow-hidden">
                      <div
                        className="h-full bg-indigo-500 transition-all"
                        style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
            {!loading && error && (
              <div className="flex-1 p-4 text-red-600 text-sm">
                <div className="font-semibold mb-1">Error</div>
                <div className="font-mono text-xs">{error}</div>
              </div>
            )}
            {!loading && !error && result && (
              <>
                {result.rtf && <RtfDiffView result={result.rtf} />}
                {result.xml && <XmlDiffView result={result.xml} />}
                {result.text && <TextDiffPane result={result.text} leftRef={leftRef} rightRef={rightRef} onScroll={handleScroll} />}
                {result.excel && <ExcelDiffPane result={result.excel} trackContext={trackContext} />}
                {result.docx && <DocxDiffPane result={result.docx} />}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

interface PaneLine {
  num: number;
  text: string;
  type: 'equal' | 'delete' | 'insert' | 'empty' | 'replace';
  // Inline segments for 'replace' rows (only the changed spans are highlighted).
  segs?: { text: string; changed: boolean }[];
}

const TEXT_CONTEXT = 3; // unchanged lines kept around a change before collapsing
const MAX_RENDER_ROWS = 5000; // cap rendered rows so huge all-different diffs don't freeze the UI

function TextDiffPane({
  result,
  leftRef,
  rightRef,
  onScroll,
}: {
  result: TextResult;
  leftRef: React.RefObject<HTMLDivElement>;
  rightRef: React.RefObject<HTMLDivElement>;
  onScroll: (source: 'left' | 'right') => (e: React.UIEvent<HTMLDivElement>) => void;
}) {
  // Build aligned left/right rows from the op stream.
  const { leftLines, rightLines } = useMemo(() => {
    const left: PaneLine[] = [];
    const right: PaneLine[] = [];
    let aLine = 0;
    let bLine = 0;
    for (const op of result.ops) {
      if (op.type === 'equal') {
        aLine++;
        bLine++;
        left.push({ num: aLine, text: op.old || '', type: 'equal' });
        right.push({ num: bLine, text: op.new || '', type: 'equal' });
      } else if (op.type === 'delete') {
        aLine++;
        left.push({ num: aLine, text: op.old || '', type: 'delete' });
        right.push({ num: 0, text: '', type: 'empty' });
      } else if (op.type === 'insert') {
        bLine++;
        left.push({ num: 0, text: '', type: 'empty' });
        right.push({ num: bLine, text: op.new || '', type: 'insert' });
      } else if (op.type === 'replace') {
        // Modified-in-place: same row, both sides shown, only changed spans lit.
        aLine++;
        bLine++;
        left.push({ num: aLine, text: op.old || '', type: 'replace', segs: op.old_segs });
        right.push({ num: bLine, text: op.new || '', type: 'replace', segs: op.new_segs });
      }
    }
    return { leftLines: left, rightLines: right };
  }, [result]);

  const total = leftLines.length;

  // Decide which rows to keep: any changed row plus TEXT_CONTEXT around it.
  // Unchanged gaps collapse into expandable markers so huge diffs (thousands of
  // PDF pages) render only a few hundred rows instead of hundreds of thousands.
  const { segments, truncatedAt } = useMemo(() => {
    const keep = new Array(total).fill(false);
    for (let i = 0; i < total; i++) {
      if (leftLines[i].type !== 'equal' || rightLines[i].type !== 'equal') {
        for (let k = Math.max(0, i - TEXT_CONTEXT); k <= Math.min(total - 1, i + TEXT_CONTEXT); k++) {
          keep[k] = true;
        }
      }
    }
    // Hard cap on rendered rows. When two files differ on nearly every line, the
    // collapsing above keeps almost everything, and rendering tens of thousands
    // of rows synchronously freezes the webview. Stop emitting rows past the cap
    // and report where we cut so the UI can show a notice.
    const segs: { kind: 'rows' | 'gap'; from: number; to: number }[] = [];
    let i = 0;
    let kept = 0;
    let cut = -1;
    while (i < total) {
      const start = i;
      const k = keep[i];
      while (i < total && keep[i] === k) i++;
      if (k) {
        if (kept >= MAX_RENDER_ROWS) {
          cut = start; // already over budget — drop this and the rest
          break;
        }
        let end = i;
        if (kept + (end - start) > MAX_RENDER_ROWS) {
          end = start + (MAX_RENDER_ROWS - kept);
          cut = end;
        }
        segs.push({ kind: 'rows', from: start, to: end });
        kept += end - start;
        if (cut >= 0) break;
      } else {
        segs.push({ kind: 'gap', from: start, to: i });
      }
    }
    return { segments: segs, truncatedAt: cut };
  }, [leftLines, rightLines, total]);

  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const expand = (from: number) =>
    setExpanded(prev => {
      const next = new Set(prev);
      next.add(from);
      return next;
    });

  const renderLine = (line: PaneLine, side: 'l' | 'r', i: number) => {
    // Replace rows: light row tint (per side) + strong highlight on changed spans.
    const isReplace = line.type === 'replace';
    const rowBg =
      line.type === 'delete'
        ? 'bg-shtuka-deleted'
        : line.type === 'insert'
        ? 'bg-shtuka-added'
        : line.type === 'empty'
        ? 'bg-gray-50'
        : isReplace
        ? side === 'l'
          ? 'bg-red-50'
          : 'bg-green-50'
        : '';
    const strong = side === 'l' ? 'bg-red-200 text-red-900' : 'bg-green-200 text-green-900';
    return (
      <div key={`${side}-${i}`} className={`flex ${rowBg}`}>
        <span className="w-12 text-right pr-2 text-gray-400 select-none flex-shrink-0">{line.num || ''}</span>
        <pre className="flex-1 px-2 whitespace-pre-wrap break-all">
          {isReplace && line.segs && line.segs.length > 0
            ? line.segs.map((s, k) =>
                s.changed ? (
                  <span key={k} className={`rounded-sm ${strong}`}>
                    {s.text}
                  </span>
                ) : (
                  <span key={k}>{s.text}</span>
                )
              )
            : line.text}
        </pre>
      </div>
    );
  };

  const gapMarker = (from: number, to: number, side: 'l' | 'r') => {
    const n = to - from;
    return (
      <div
        key={`${side}-gap-${from}`}
        onClick={() => expand(from)}
        className="flex items-center justify-center py-1 bg-gray-50 text-gray-400 text-[11px] italic cursor-pointer hover:bg-gray-100 border-y border-gray-100 select-none"
        title="Click to expand unchanged lines"
      >
        ⋯ {n} unchanged line{n > 1 ? 's' : ''} — click to expand
      </div>
    );
  };

  const renderPane = (lines: PaneLine[], side: 'l' | 'r') =>
    segments.map(seg => {
      if (seg.kind === 'rows' || expanded.has(seg.from)) {
        const out = [];
        for (let i = seg.from; i < seg.to; i++) out.push(renderLine(lines[i], side, i));
        return out;
      }
      return gapMarker(seg.from, seg.to, side);
    });

  return (
    <div className="flex-1 flex flex-col min-w-0">
      {truncatedAt >= 0 && (
        <div className="px-3 py-1.5 bg-amber-50 border-b border-amber-200 text-[11px] text-amber-800 flex-shrink-0">
          ⚠ Showing the first {MAX_RENDER_ROWS.toLocaleString()} changed lines of {total.toLocaleString()}.
          The files differ too extensively to render in full.
        </div>
      )}
      <div className="flex-1 flex overflow-hidden">
        <div
          ref={leftRef}
          onScroll={onScroll('left')}
          className="flex-1 overflow-auto border-r border-gray-200 font-mono text-xs"
        >
          {renderPane(leftLines, 'l')}
        </div>
        <div
          ref={rightRef}
          onScroll={onScroll('right')}
          className="flex-1 overflow-auto font-mono text-xs"
        >
          {renderPane(rightLines, 'r')}
        </div>
      </div>
    </div>
  );
}

function DocxDiffPane({ result }: { result: DocxResult }) {
  return (
    <div className="flex-1 overflow-auto p-4">
      <div className="mb-4 text-xs text-gray-500 flex gap-4">
        <span>{result.addedParagraphs.length} added</span>
        <span className="text-amber-700">{result.modifiedParagraphs.length} modified</span>
        <span className="text-red-700">{result.deletedParagraphs.length} deleted</span>
        {result.modifiedTables > 0 && <span>{result.modifiedTables} table(s) changed</span>}
      </div>

      {result.modifiedParagraphs.slice(0, 50).map(p => (
        <div key={`m-${p.index}`} className="mb-3 border-l-2 border-amber-400 pl-3">
          <div className="text-[10px] text-gray-400 mb-1">¶ {p.index + 1}</div>
          <div className="font-mono text-xs bg-red-50 px-2 py-1 line-through text-red-900">
            {p.old}
          </div>
          <div className="font-mono text-xs bg-green-50 px-2 py-1 text-green-900 mt-0.5">
            {p.new}
          </div>
        </div>
      ))}

      {result.addedParagraphs.slice(0, 30).map(p => (
        <div key={`a-${p.index}`} className="mb-2 border-l-2 border-green-400 pl-3">
          <div className="text-[10px] text-gray-400 mb-1">¶ {p.index + 1} (new)</div>
          <div className="font-mono text-xs bg-green-50 px-2 py-1 text-green-900">
            {p.text}
          </div>
        </div>
      ))}

      {result.deletedParagraphs.slice(0, 30).map(p => (
        <div key={`d-${p.index}`} className="mb-2 border-l-2 border-red-400 pl-3">
          <div className="text-[10px] text-gray-400 mb-1">¶ {p.index + 1} (removed)</div>
          <div className="font-mono text-xs bg-red-50 px-2 py-1 line-through text-red-900">
            {p.text}
          </div>
        </div>
      ))}

      {result.modifiedParagraphs.length === 0 &&
        result.addedParagraphs.length === 0 &&
        result.deletedParagraphs.length === 0 && (
          <div className="text-gray-400 italic text-sm">No paragraph changes detected</div>
        )}
    </div>
  );
}
