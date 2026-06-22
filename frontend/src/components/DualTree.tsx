import { useMemo, useState } from 'react';
import { Comparison } from '../types';
import {
  buildTree,
  flattenTree,
  defaultCollapsed,
  FlatRow,
  FileStatus,
  TreeNode,
} from '../tree';

interface DualTreeProps {
  comparison: Comparison;
  onOpenDiff: (pathA: string, pathB: string, label: string) => void;
}

const statusStyles: Record<
  FileStatus,
  { row: string; text: string; mark: string; chip: string }
> = {
  modified: { row: 'bg-amber-50 hover:bg-amber-100', text: 'text-amber-900', mark: '~', chip: 'bg-amber-200 text-amber-900' },
  added: { row: 'bg-green-50 hover:bg-green-100', text: 'text-green-900', mark: '+', chip: 'bg-green-200 text-green-900' },
  removed: { row: 'bg-red-50 hover:bg-red-100', text: 'text-red-900', mark: '−', chip: 'bg-red-200 text-red-900' },
  renamed: { row: 'bg-blue-50 hover:bg-blue-100', text: 'text-blue-900', mark: '~', chip: 'bg-blue-200 text-blue-900' },
  unchanged: { row: 'hover:bg-gray-50', text: 'text-gray-600', mark: '', chip: '' },
};

export function DualTree({ comparison, onOpenDiff }: DualTreeProps) {
  const root = useMemo(() => buildTree(comparison), [comparison]);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => defaultCollapsed(root));
  const [hideUnchanged, setHideUnchanged] = useState(true);

  const rows = useMemo(
    () => flattenTree(root, collapsed, hideUnchanged),
    [root, collapsed, hideUnchanged],
  );

  const toggle = (path: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const handleRowClick = (node: TreeNode) => {
    if (node.isDir) {
      toggle(node.path);
      return;
    }
    if (node.status === 'unchanged') return;
    onOpenDiff(node.pathA, node.pathB, node.pathB || node.pathA);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Column headers */}
      <div className="flex text-xs font-semibold text-gray-500 border-b border-gray-200 bg-gray-50 flex-shrink-0">
        <div className="flex-1 px-3 py-1.5 border-r border-gray-200 truncate" title={comparison.pathA}>
          A · {shortPath(comparison.pathA)}
        </div>
        <div className="flex-1 px-3 py-1.5 truncate flex items-center justify-between" title={comparison.pathB}>
          <span className="truncate">B · {shortPath(comparison.pathB)}</span>
          <label className="flex items-center gap-1 text-[10px] font-normal text-gray-500 cursor-pointer whitespace-nowrap ml-2">
            <input
              type="checkbox"
              checked={hideUnchanged}
              onChange={e => setHideUnchanged(e.target.checked)}
              className="accent-indigo-600"
            />
            changes only
          </label>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {rows.length === 0 ? (
          <div className="p-6 text-center text-sm text-gray-400">No changes to show</div>
        ) : (
          rows.map((row, i) => <Row key={`${row.node.path}-${i}`} row={row} collapsed={collapsed} onClick={handleRowClick} />)
        )}
      </div>
    </div>
  );
}

function Row({
  row,
  collapsed,
  onClick,
}: {
  row: FlatRow;
  collapsed: Set<string>;
  onClick: (node: TreeNode) => void;
}) {
  const { node, depth } = row;
  const style = statusStyles[node.status];
  const clickable = node.isDir || node.status !== 'unchanged';
  const indent = depth * 14;

  const caret = node.isDir ? (collapsed.has(node.path) ? '▸' : '▾') : '';
  const icon = node.isDir ? '📁' : '';

  // Cell content for one side; empty placeholder if the node is absent there.
  // Changed names get a colored chip so added/removed folders & files stand out.
  const cell = (present: boolean) => {
    if (!present) {
      return <span className="text-gray-300 select-none">·</span>;
    }
    const changed = node.status !== 'unchanged';
    return (
      <span
        className={`truncate rounded px-1 ${
          changed ? `${style.chip} font-medium` : style.text
        }`}
      >
        {style.mark && <span className="opacity-70 mr-1">{style.mark}</span>}
        {node.name}
      </span>
    );
  };

  return (
    <div
      className={`flex text-xs font-mono ${style.row} ${clickable ? 'cursor-pointer' : ''}`}
      onClick={() => clickable && onClick(node)}
      title={node.path}
    >
      <div className="flex-1 flex items-center px-2 py-1 border-r border-gray-100 min-w-0">
        <span style={{ width: indent }} className="flex-shrink-0" />
        <span className="w-3 flex-shrink-0 text-gray-400 select-none">{caret}</span>
        {icon && <span className="mr-1 flex-shrink-0">{icon}</span>}
        {cell(node.inA)}
      </div>
      <div className="flex-1 flex items-center px-2 py-1 min-w-0">
        <span style={{ width: indent }} className="flex-shrink-0" />
        <span className="w-3 flex-shrink-0 text-gray-400 select-none">{caret}</span>
        {icon && <span className="mr-1 flex-shrink-0">{icon}</span>}
        {cell(node.inB)}
      </div>
    </div>
  );
}

function shortPath(p: string): string {
  const parts = p.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] || p;
}
