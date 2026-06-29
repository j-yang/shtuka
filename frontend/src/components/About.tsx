import { useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';

// A low-key "info" button in the header. Opens a small dialog crediting the
// author and the two diff-engine crates (tate + mumford), each linking to its
// GitHub repo. Links open in the system browser via the opener plugin; in a
// plain browser (dev) openUrl is absent, so we fall back to window.open.
const REPOS = {
  tate: 'https://github.com/j-yang/tate',
  mumford: 'https://github.com/j-yang/mumford',
};

async function open(url: string) {
  try {
    await openUrl(url);
  } catch {
    window.open(url, '_blank');
  }
}

export function About() {
  const [show, setShow] = useState(false);

  return (
    <>
      <button
        onClick={() => setShow(true)}
        title="About shtuka"
        className="text-[11px] w-5 h-5 flex items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
        aria-label="About"
      >
        ⓘ
      </button>

      {show && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
          onClick={() => setShow(false)}
        >
          <div
            className="bg-white rounded-lg shadow-xl border border-gray-200 w-[360px] p-5"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-3">
              <span className="font-semibold text-sm tracking-tight bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent">
                shtuka
              </span>
              <span className="text-[11px] text-gray-400">a format-aware diff tool</span>
            </div>

            <p className="text-xs text-gray-600 leading-relaxed mb-3">
              Created by <span className="font-medium text-gray-800">Jimmy Yang</span>.
            </p>

            <p className="text-xs text-gray-500 leading-relaxed">
              Diff engines powered by{' '}
              <button
                onClick={() => open(REPOS.tate)}
                className="text-indigo-600 hover:underline font-medium"
              >
                tate
              </button>{' '}
              and{' '}
              <button
                onClick={() => open(REPOS.mumford)}
                className="text-indigo-600 hover:underline font-medium"
              >
                mumford
              </button>
              .
            </p>

            <div className="flex justify-end mt-4">
              <button
                onClick={() => setShow(false)}
                className="px-3 py-1.5 text-xs font-medium text-gray-600 rounded-md hover:bg-gray-100"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
