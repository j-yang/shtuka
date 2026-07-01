import { useState } from 'react';

// Shared zoom control for all diff views. A view calls `useZoom()` to get the
// current factor + setter, renders <ZoomControls> in its toolbar, and applies
// `fontScale(zoom)` (or the raw factor) to the element that should scale.

export const ZOOM_MIN = 0.6;
export const ZOOM_MAX = 2.5;
export const ZOOM_STEP = 0.1;

/** Base body font size (pt) that a text/table view renders at 100% zoom. */
export const BASE_FONT_PT = 8.5;

export interface Zoom {
  zoom: number;
  setZoom: (updater: number | ((z: number) => number)) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
}

const clamp = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

export function useZoom(initial = 1): Zoom {
  const [zoom, setRaw] = useState(initial);
  const setZoom = (updater: number | ((z: number) => number)) =>
    setRaw(z => clamp(typeof updater === 'function' ? updater(z) : updater));
  return {
    zoom,
    setZoom,
    zoomIn: () => setZoom(z => z + ZOOM_STEP),
    zoomOut: () => setZoom(z => z - ZOOM_STEP),
    reset: () => setZoom(1),
  };
}

/** CSS font-size (pt) for a view whose text scales with zoom. */
export function fontScale(zoom: number): string {
  return `${(BASE_FONT_PT * zoom).toFixed(2)}pt`;
}

/** A−/percent/A+ button group. Drop into any view's toolbar. */
export function ZoomControls({ zoom, zoomIn, zoomOut, reset }: Zoom) {
  return (
    <div className="flex items-center gap-1">
      <button
        className="px-1.5 py-0.5 rounded border border-gray-300 text-gray-600 hover:bg-gray-100 leading-none text-[11px]"
        title="Zoom out"
        onClick={zoomOut}
      >
        A−
      </button>
      <button
        className="px-1.5 py-0.5 rounded border border-gray-300 text-gray-500 hover:bg-gray-100 leading-none tabular-nums text-[11px]"
        title="Reset zoom"
        onClick={reset}
      >
        {Math.round(zoom * 100)}%
      </button>
      <button
        className="px-1.5 py-0.5 rounded border border-gray-300 text-gray-600 hover:bg-gray-100 leading-none text-[11px]"
        title="Zoom in"
        onClick={zoomIn}
      >
        A+
      </button>
    </div>
  );
}
