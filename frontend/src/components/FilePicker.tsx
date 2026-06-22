import { useState } from 'react';
import { SelectFile } from '../../wailsjs/go/main/App';

interface FilePickerProps {
  label: string;
  value: string;
  onChange: (path: string) => void;
}

export function FilePicker({ label, value, onChange }: FilePickerProps) {
  const [picking, setPicking] = useState(false);

  const handlePick = async () => {
    setPicking(true);
    try {
      const path = await SelectFile(label);
      if (path) onChange(path);
    } catch (e) {
      console.error('File pick error:', e);
    } finally {
      setPicking(false);
    }
  };

  return (
    <div className="flex-1 min-w-0">
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <div className="flex gap-2">
        <input
          type="text"
          value={value}
          readOnly
          placeholder="Select a file..."
          className="flex-1 min-w-0 px-3 py-2 border border-gray-300 rounded-md text-sm font-mono bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
        />
        <button
          onClick={handlePick}
          disabled={picking}
          className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-md hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {picking ? '...' : 'Browse'}
        </button>
      </div>
    </div>
  );
}
