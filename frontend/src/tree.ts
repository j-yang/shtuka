import { Comparison } from './types';

export type FileStatus = 'unchanged' | 'modified' | 'added' | 'removed' | 'renamed';

export interface TreeNode {
  name: string;
  path: string; // relative path within the tree (B-side path, or A-side for removed)
  isDir: boolean;
  status: FileStatus;
  inA: boolean;
  inB: boolean;
  pathA: string; // relative path on side A, or '' if absent
  pathB: string; // relative path on side B, or '' if absent
  hasChanges: boolean; // for directories: any changed descendant
  children: TreeNode[];
}

interface BuildNode extends Omit<TreeNode, 'children'> {
  childrenMap: Record<string, BuildNode>;
}

function makeNode(name: string, path: string, isDir: boolean): BuildNode {
  return {
    name,
    path,
    isDir,
    status: 'unchanged',
    inA: false,
    inB: false,
    pathA: '',
    pathB: '',
    hasChanges: false,
    childrenMap: {},
  };
}

type Side = 'A' | 'B' | 'both';

/**
 * Build a single merged tree from a folder Comparison. Each node carries which
 * sides it exists on (inA/inB) plus the concrete relative paths, so a row can be
 * rendered as two aligned columns and clicked to open the correct diff.
 */
export function buildTree(cmp: Comparison): TreeNode {
  const root = makeNode('', '', true);

  const add = (
    treePath: string,
    side: Side,
    status: FileStatus,
    pathA: string,
    pathB: string,
  ) => {
    const parts = treePath.split(/[/\\]/).filter(Boolean);
    let node = root;
    let acc = '';
    for (let i = 0; i < parts.length; i++) {
      acc = acc ? `${acc}/${parts[i]}` : parts[i];
      const isLeaf = i === parts.length - 1;
      let child = node.childrenMap[parts[i]];
      if (!child) {
        child = makeNode(parts[i], acc, !isLeaf);
        node.childrenMap[parts[i]] = child;
      }
      if (side === 'A' || side === 'both') child.inA = true;
      if (side === 'B' || side === 'both') child.inB = true;
      if (isLeaf) {
        child.isDir = false;
        child.status = status;
        if (side === 'A' || side === 'both') child.pathA = pathA;
        if (side === 'B' || side === 'both') child.pathB = pathB;
      }
      node = child;
    }
  };

  cmp.unchanged.forEach(p => add(p, 'both', 'unchanged', p, p));
  cmp.modified.forEach(p => add(p, 'both', 'modified', p, p));
  cmp.added.forEach(p => add(p, 'B', 'added', '', p));
  cmp.removed.forEach(p => add(p, 'A', 'removed', p, ''));
  cmp.renamed.forEach(r => {
    add(r.from, 'A', 'renamed', r.from, r.to);
    add(r.to, 'B', 'renamed', r.from, r.to);
  });

  return finalize(root);
}

function finalize(node: BuildNode): TreeNode {
  const children = Object.values(node.childrenMap)
    .map(finalize)
    .sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  let hasChanges = node.status !== 'unchanged' && !node.isDir;
  for (const c of children) {
    if (c.hasChanges || c.status !== 'unchanged') hasChanges = true;
  }

  // Directories carry no status from the backend (it reports files only). Derive
  // one so a wholly new/deleted folder highlights its name: a dir that exists on
  // exactly one side is itself added/removed; otherwise it stays neutral.
  let status = node.status;
  if (node.isDir && node.path !== '') {
    if (node.inB && !node.inA) status = 'added';
    else if (node.inA && !node.inB) status = 'removed';
  }

  return {
    name: node.name,
    path: node.path,
    isDir: node.isDir,
    status,
    inA: node.inA,
    inB: node.inB,
    pathA: node.pathA,
    pathB: node.pathB,
    hasChanges,
    children,
  };
}

export interface FlatRow {
  node: TreeNode;
  depth: number;
}

/**
 * Flatten the tree into visible rows given the current collapsed set.
 * When hideUnchanged is true, unchanged files and change-free directories are skipped.
 */
export function flattenTree(
  root: TreeNode,
  collapsed: Set<string>,
  hideUnchanged: boolean,
): FlatRow[] {
  const out: FlatRow[] = [];
  const walk = (node: TreeNode, depth: number) => {
    for (const child of node.children) {
      if (hideUnchanged && !child.hasChanges) continue;
      out.push({ node: child, depth });
      if (child.isDir && !collapsed.has(child.path)) {
        walk(child, depth + 1);
      }
    }
  };
  walk(root, 0);
  return out;
}

/** All directories start collapsed; the user expands what they want to inspect. */
export function defaultCollapsed(root: TreeNode): Set<string> {
  const collapsed = new Set<string>();
  const walk = (node: TreeNode) => {
    for (const child of node.children) {
      if (child.isDir) {
        collapsed.add(child.path);
        walk(child);
      }
    }
  };
  walk(root);
  return collapsed;
}
