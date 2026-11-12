export interface FileEntry {
  path: string;
  size: number;
}

export interface RepoMeta {
  /** "owner/name", or "self" for this app's own source. */
  id: string;
  fullName: string;
  description: string;
  stars: number | null;
  ref: string;
  url: string | null;
}

export interface RepoData {
  meta: RepoMeta;
  files: FileEntry[];
  /** True when the repo had more files than we chart. */
  truncated: boolean;
  totalFiles: number;
}

export interface FileContent {
  content: string;
  truncated: boolean;
  binary: boolean;
}

export type AskEvent =
  | { t: "reading"; paths: string[] }
  | { t: "delta"; text: string }
  | { t: "done" }
  | { t: "error"; message: string; code?: string };
