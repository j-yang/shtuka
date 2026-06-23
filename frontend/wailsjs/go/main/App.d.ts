// Tauri shim type declarations (kept at the original Wails path so component
// imports are unchanged). Types come from the app's own src/types.ts.
import type {
  Comparison,
  DiffResult,
  Track,
  TrackSummary,
  SnapshotResult,
  DocDiff,
  PageChange,
  PageLink,
} from '../../src/types';

export function CompareFolders(arg1: string, arg2: string): Promise<Comparison>;
export function DiffFiles(arg1: string, arg2: string): Promise<DiffResult>;
export function SelectFolder(arg1: string): Promise<string>;
export function SelectFile(arg1: string): Promise<string>;
export function SaveTextFile(defaultName: string, contents: string): Promise<string>;

export function ListTracks(root: string): Promise<TrackSummary[]>;
export function GetTrack(root: string, id: string): Promise<Track>;
export function CreateTrack(
  root: string,
  name: string,
  sourcePath: string,
  note: string
): Promise<Track>;
export function TakeSnapshot(
  root: string,
  id: string,
  sourcePath: string,
  note: string
): Promise<SnapshotResult>;
export function DiffSnapshots(
  root: string,
  id: string,
  seqA: number,
  seqB: number
): Promise<DiffResult>;

export function RenderPdfPage(
  path: string,
  pageIndex: number,
  width: number
): Promise<string>;
export function PdfDocDiff(pathA: string, pathB: string): Promise<DocDiff>;
export function PdfPageChanges(
  pathA: string,
  pathB: string,
  side: 'a' | 'b',
  page: number
): Promise<PageChange[]>;
export function PdfPageLinks(path: string, page: number): Promise<PageLink[]>;
