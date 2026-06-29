import { openUrl } from '@tauri-apps/plugin-opener';

// A low-key button that opens the GitHub issue tracker in the system browser
// so users can file a bug. Falls back to window.open in a plain browser (dev).
const ISSUES_URL = 'https://github.com/azu-oncology-rd/shtuka/issues/new';

async function open(url: string) {
  try {
    await openUrl(url);
  } catch {
    window.open(url, '_blank');
  }
}

export function BugReport() {
  return (
    <button
      onClick={() => open(ISSUES_URL)}
      title="Report a bug on GitHub"
      className="text-[11px] px-2 py-1 rounded text-gray-500 hover:bg-gray-100 transition-colors"
    >
      Report a bug
    </button>
  );
}
