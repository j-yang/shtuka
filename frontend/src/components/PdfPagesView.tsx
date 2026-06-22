import { useEffect, useMemo, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { DocDiff, PageChange, PageLink } from '../types';
import { RenderPdfPage, PdfDocDiff, PdfPageChanges, PdfPageLinks } from '../../wailsjs/go/main/App';

interface PdfPagesViewProps {
  pathA: string; // old version (left)
  pathB: string; // new version (right)
}

interface PdfProgress {
  side: string;
  done: number;
  total: number;
}

// Render width in CSS px; multiplied by devicePixelRatio for crisp output.
const PAGE_CSS_WIDTH = 520;

export function PdfPagesView({ pathA, pathB }: PdfPagesViewProps) {
  const [diff, setDiff] = useState<DocDiff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<PdfProgress | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    setDiff(null);
    setError(null);
    setProgress(null);
    const unlisten = listen<PdfProgress>('pdf-progress', e => setProgress(e.payload));
    PdfDocDiff(pathA, pathB)
      .then(d => setDiff(d as DocDiff))
      .catch(e => setError(String(e)));
    return () => {
      unlisten.then(f => f());
    };
  }, [pathA, pathB]);

  // page -> row index, per side, so TOC links can scroll to the right row.
  const { rowOfA, rowOfB } = useMemo(() => {
    const ra = new Map<number, number>();
    const rb = new Map<number, number>();
    diff?.rows.forEach((r, i) => {
      if (r.a !== undefined) ra.set(r.a, i);
      if (r.b !== undefined) rb.set(r.b, i);
    });
    return { rowOfA: ra, rowOfB: rb };
  }, [diff]);

  const scrollToRow = (row: number) => {
    rowRefs.current[row]?.scrollIntoView({ block: 'start' });
  };
  // TOC link: scroll to the row holding the target page on that side.
  const goToPage = (side: 'a' | 'b', page: number) => {
    const row = (side === 'a' ? rowOfA : rowOfB).get(page);
    if (row !== undefined) scrollToRow(row);
  };

  const [cursor, setCursor] = useState(0);
  const jumpNext = () => {
    if (!diff || diff.changeRows.length === 0) return;
    const next = cursor % diff.changeRows.length;
    scrollToRow(diff.changeRows[next]);
    setCursor(next + 1);
  };

  if (error) {
    return (
      <div className="flex-1 p-4 text-red-600 text-sm">
        <div className="font-semibold mb-1">Could not diff PDFs</div>
        <div className="font-mono text-xs">{error}</div>
      </div>
    );
  }
  if (!diff) {
    const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-gray-500 text-sm gap-3">
        <div>Extracting & diffing PDFs…</div>
        {progress && progress.total > 0 ? (
          <div className="w-72">
            <div className="flex justify-between text-xs text-gray-400 mb-1">
              <span>Reading {progress.side === 'A' ? 'old' : 'new'} document</span>
              <span>{progress.done} / {progress.total} pages</span>
            </div>
            <div className="w-full h-1.5 bg-gray-200 rounded overflow-hidden">
              <div className="h-full bg-indigo-500 transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
        ) : (
          <div className="text-xs text-gray-300">First run reads every page; large files take a moment.</div>
        )}
      </div>
    );
  }

  const changedA = new Set(diff.changedPagesA.map(c => c.page));
  const changedB = new Set(diff.changedPagesB.map(c => c.page));

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 py-1.5 border-b border-gray-100 bg-gray-50 flex items-center gap-3 text-xs flex-shrink-0">
        <span className="text-gray-500">old {diff.pagesA} → new {diff.pagesB} pages</span>
        <span className="text-gray-300">·</span>
        <span className="text-green-700">{diff.added} added</span>
        <span className="text-amber-700">{diff.modified} modified</span>
        <span className="text-red-700">{diff.removed} removed</span>
        {diff.changeRows.length > 0 && (
          <button
            onClick={jumpNext}
            className="ml-auto px-2 py-1 rounded bg-indigo-600 text-white hover:bg-indigo-700"
          >
            Next change ↓ ({(cursor % diff.changeRows.length) + 1}/{diff.changeRows.length})
          </button>
        )}
      </div>

      {/* Column headers stay fixed above the single shared scroll area. */}
      <div className="flex text-[11px] font-medium flex-shrink-0 border-b border-gray-200">
        <div className="flex-1 px-3 py-1 text-red-700 bg-red-50 border-r-2 border-gray-300 truncate">
          OLD · {pathBase(pathA)}
        </div>
        <div className="flex-1 px-3 py-1 text-green-700 bg-green-50 truncate">
          NEW · {pathBase(pathB)}
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-auto bg-gray-200 p-3">
        <div className="space-y-3">
          {diff.rows.map((row, i) => (
            <div key={i} ref={el => (rowRefs.current[i] = el)} className="flex gap-3 items-start">
              <div className="flex-1 min-w-0">
                {row.a !== undefined ? (
                  <PageCell path={pathA} pathA={pathA} pathB={pathB} side="a" page={row.a} changed={changedA.has(row.a)} onLink={goToPage} />
                ) : (
                  <GapCell />
                )}
              </div>
              <div className="flex-1 min-w-0">
                {row.b !== undefined ? (
                  <PageCell path={pathB} pathA={pathA} pathB={pathB} side="b" page={row.b} changed={changedB.has(row.b)} onLink={goToPage} />
                ) : (
                  <GapCell />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function pathBase(p: string): string {
  return p.split(/[/\\]/).pop() || p;
}

// Placeholder shown opposite an added/removed page so rows stay aligned.
function GapCell() {
  return (
    <div className="rounded border border-dashed border-gray-300 bg-gray-50 min-h-[120px] flex items-center justify-center text-gray-300 text-xs select-none">
      no matching page
    </div>
  );
}

// One page cell: rendered image + overlay highlights + clickable TOC links, all lazy.
function PageCell({
  path,
  pathA,
  pathB,
  side,
  page,
  changed,
  onLink,
}: {
  path: string;
  pathA: string;
  pathB: string;
  side: 'a' | 'b';
  page: number;
  changed: boolean;
  onLink: (side: 'a' | 'b', page: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [src, setSrc] = useState<string | null>(null);
  const [changes, setChanges] = useState<PageChange[]>([]);
  const [links, setLinks] = useState<PageLink[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!ref.current) return;
    const obs = new IntersectionObserver(
      entries => entries.some(e => e.isIntersecting) && setVisible(true),
      { rootMargin: '600px' }
    );
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || src || failed) return;
    const width = Math.round(PAGE_CSS_WIDTH * (window.devicePixelRatio || 1));
    RenderPdfPage(path, page, width)
      .then(setSrc)
      .catch(() => setFailed(true));
  }, [visible, page, path, src, failed]);

  useEffect(() => {
    if (!visible || !changed || changes.length > 0) return;
    PdfPageChanges(pathA, pathB, side, page)
      .then(c => setChanges(c as PageChange[]))
      .catch(() => {});
  }, [visible, changed, pathA, pathB, side, page, changes.length]);

  useEffect(() => {
    if (!visible || links.length > 0) return;
    PdfPageLinks(path, page)
      .then(l => setLinks(l as PageLink[]))
      .catch(() => {});
  }, [visible, path, page, links.length]);

  const cls = (k: PageChange['kind']) =>
    k === 'removed'
      ? 'bg-red-400/40 ring-1 ring-red-500/50'
      : k === 'added'
      ? 'bg-green-400/40 ring-1 ring-green-500/50'
      : 'bg-amber-300/45 ring-1 ring-amber-500/50';

  return (
    <div
      ref={ref}
      className={`relative bg-white rounded shadow-sm overflow-hidden ${
        changed ? (side === 'a' ? 'ring-2 ring-red-300' : 'ring-2 ring-green-300') : ''
      }`}
    >
      {src ? (
        <>
          <img src={src} alt={`page ${page + 1}`} className="w-full block" />
          {changes.flatMap((c, i) =>
            c.rects.map((r, k) => (
              <div
                key={`${i}-${k}`}
                title={
                  c.kind === 'modified'
                    ? side === 'a'
                      ? `→ ${c.counterpart}`
                      : `was: ${c.counterpart}`
                    : c.text
                }
                className={`absolute pointer-events-auto rounded-[1px] ${cls(c.kind)}`}
                style={{
                  left: `${r.x * 100}%`,
                  top: `${r.y * 100}%`,
                  width: `${r.w * 100}%`,
                  height: `${r.h * 100}%`,
                }}
              />
            ))
          )}
          {links.map((lk, i) => (
            <div
              key={`lk${i}`}
              role="link"
              title={`Go to page ${lk.target + 1}`}
              onClick={() => onLink(side, lk.target)}
              className="absolute cursor-pointer hover:bg-indigo-400/20 hover:ring-1 hover:ring-indigo-400/60 rounded-[1px]"
              style={{
                left: `${lk.rect.x * 100}%`,
                top: `${lk.rect.y * 100}%`,
                width: `${lk.rect.w * 100}%`,
                height: `${lk.rect.h * 100}%`,
              }}
            />
          ))}
          <div className="absolute top-1 left-1 text-[10px] px-1 rounded bg-black/40 text-white select-none">
            p.{page + 1}
          </div>
        </>
      ) : (
        <div className="flex items-center justify-center text-gray-300 text-xs min-h-[300px]">
          {failed ? 'render failed' : `loading p.${page + 1}…`}
        </div>
      )}
    </div>
  );
}
