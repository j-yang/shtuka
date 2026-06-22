import { FolderPicker } from './FolderPicker';

interface ToolbarProps {
  folderA: string;
  folderB: string;
  onFolderAChange: (path: string) => void;
  onFolderBChange: (path: string) => void;
  onCompare: () => void;
  comparing: boolean;
}

export function Toolbar({
  folderA,
  folderB,
  onFolderAChange,
  onFolderBChange,
  onCompare,
  comparing,
}: ToolbarProps) {
  return (
    <div className="border-b border-gray-200 p-4 bg-white">
      <div className="flex gap-3 items-end">
        <FolderPicker label="Folder A" value={folderA} onChange={onFolderAChange} />
        <div className="text-gray-400 pb-2">→</div>
        <FolderPicker label="Folder B" value={folderB} onChange={onFolderBChange} />
        <button
          onClick={onCompare}
          disabled={!folderA || !folderB || comparing}
          className="px-6 py-2 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
        >
          {comparing ? 'Comparing...' : 'Compare'}
        </button>
      </div>
    </div>
  );
}
