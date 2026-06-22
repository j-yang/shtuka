export interface Summary {
  totalA: number;
  totalB: number;
  unchanged: number;
  modified: number;
  added: number;
  removed: number;
  renamed: number;
}

export interface Rename {
  from: string;
  to: string;
}

export interface Comparison {
  pathA: string;
  pathB: string;
  unchanged: string[];
  modified: string[];
  added: string[];
  removed: string[];
  renamed: Rename[];
  summary: Summary;
}

export type OpType = 'equal' | 'insert' | 'delete' | 'replace';

export interface InlineSeg {
  text: string;
  changed: boolean;
}

export interface DiffOp {
  type: OpType;
  a: number;
  b: number;
  aVal?: string;
  bVal?: string;
  // Inline char/word segments for 'replace' rows (modified-in-place lines).
  aSegs?: InlineSeg[];
  bSegs?: InlineSeg[];
}

export interface TextSummary {
  equal: number;
  insert: number;
  delete: number;
}

export interface TextResult {
  fileType: 'text';
  pathA: string;
  pathB: string;
  ops: DiffOp[];
  summary: TextSummary;
}

export type CellStatus = 'equal' | 'modified' | 'added' | 'removed';

export interface CellChange {
  status: CellStatus;
  old?: string;
  new?: string;
}

export interface GridColumn {
  name: string;
  status: 'equal' | 'added' | 'removed';
}

export interface GridRow {
  status: 'equal' | 'modified' | 'added' | 'removed';
  rowA: number;
  rowB: number;
  header: boolean;
  cells: CellChange[];
}

export interface SheetDiff {
  name: string;
  status: 'equal' | 'modified' | 'added' | 'removed';
  columns: GridColumn[];
  rows: GridRow[];
  addedRows: number;
  removedRows: number;
  modifiedRows: number;
  addedCols: number;
  removedCols: number;
}

export interface ExcelResult {
  fileType: 'excel';
  pathA: string;
  pathB: string;
  sheets: SheetDiff[];
  notes?: string[];
}

export interface DocxParagraph {
  index: number;
  text: string;
  style?: string;
}

export interface DocxParaDiff {
  index: number;
  old: string;
  new: string;
}

export interface DocxResult {
  fileType: 'docx';
  pathA: string;
  pathB: string;
  paragraphs: DocxParagraph[];
  addedParagraphs: DocxParagraph[];
  deletedParagraphs: DocxParagraph[];
  modifiedParagraphs: DocxParaDiff[];
  addedTables: number;
  deletedTables: number;
  modifiedTables: number;
}

export interface DiffResult {
  fileType: string;
  pathA: string;
  pathB: string;
  text?: TextResult;
  excel?: ExcelResult;
  docx?: DocxResult;
  error?: string;
}

// --- Track / changelog -----------------------------------------------------

export interface Snapshot {
  seq: number;
  takenAt: number; // epoch seconds
  sourceName: string;
  sourcePath: string;
  sha256: string;
  file: string;
  note: string;
  summary: string;
}

export interface Track {
  id: string;
  name: string;
  createdAt: number;
  lastSourcePath: string;
  snapshots: Snapshot[];
}

export interface TrackSummary {
  id: string;
  name: string;
  createdAt: number;
  snapshotCount: number;
  lastSnapshotAt: number;
  lastSourcePath: string;
}

export interface SnapshotResult {
  created: boolean;
  track: Track;
  message: string;
}

// --- PDF diff (B-primary, single-document highlight) ------------------------

// Highlight rect normalized to 0..1 (top-left origin) over a rendered page.
export interface HiRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type ChangeKind = 'added' | 'modified' | 'removed';

export interface ChangedPage {
  page: number;
  count: number;
}

export interface RowPair {
  a?: number; // 0-based A page, absent if this row is a gap on the A side
  b?: number; // 0-based B page, absent if gap on the B side
}

export interface DocDiff {
  pagesA: number;
  pagesB: number;
  changedPagesA: ChangedPage[];
  changedPagesB: ChangedPage[];
  rows: RowPair[]; // paired page layout for single-scroll side-by-side
  changeRows: number[]; // row indices containing a change, for jump-to-next
  added: number;
  modified: number;
  removed: number;
}

export interface PageChange {
  kind: ChangeKind;
  rects: HiRect[];
  counterpart: string; // the other side's text (old/new), for hover
  text: string;
}

export interface PageLink {
  rect: HiRect;
  target: number; // 0-based destination page in the same doc
}
