import snapshot from "./self-snapshot.json";
import type { FileContent, FileEntry, RepoData } from "./types";

/**
 * Everything that talks to GitHub lives here, on the server.
 * A GITHUB_TOKEN is optional: without one GitHub allows 60 requests an hour
 * per IP address, with one it allows 5,000.
 */

const API = (process.env.GITHUB_API_URL ?? "https://api.github.com").replace(/\/$/, "");
const RAW = (process.env.GITHUB_RAW_URL ?? "https://raw.githubusercontent.com").replace(/\/$/, "");

export const MAX_FILES = 1200;
const MAX_FILE_BYTES = 80_000;
const IGNORED = /(^|\/)(node_modules|vendor|dist|build|out|target|\.git|\.next|\.venv|__pycache__|coverage|\.yarn)(\/|$)/;

const self = snapshot as { files: FileEntry[]; contents: Record<string, string> };

export class RepoError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
  ) {
    super(message);
  }
}

/** Accepts "owner/name", a github.com URL, or "self". Returns a clean id. */
export function parseRepo(input: string): string {
  const text = input.trim();
  if (text === "self") return "self";
  const match = /^(?:https?:\/\/)?(?:www\.)?(?:github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/?#].*)?$/i.exec(text);
  if (!match || match[1] === "." || match[2] === "." || match[1] === ".." || match[2] === "..") {
    throw new RepoError("Enter a repo as owner/name, or paste its GitHub link.", 400, "bad_repo");
  }
  return `${match[1]}/${match[2]}`;
}

export function safePath(path: string): string {
  if (!path || path.length > 400 || path.startsWith("/") || path.split("/").some((part) => part === ".." || part === "")) {
    throw new RepoError("That file path is not valid.", 400, "bad_path");
  }
  return path;
}

export function safeRef(ref: string): string {
  if (!/^[\w./-]{1,120}$/.test(ref) || ref.includes("..")) {
    throw new RepoError("That branch name is not valid.", 400, "bad_ref");
  }
  return ref;
}

function headers(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "repoverse",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

async function github<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: headers() });
  if (res.ok) return (await res.json()) as T;
  if (res.status === 404) {
    throw new RepoError("That repo was not found. Private repos need a GITHUB_TOKEN on the server.", 404, "not_found");
  }
  if (res.status === 403 || res.status === 429) {
    throw new RepoError(
      "GitHub's hourly request limit is used up. Explore this app's own source instead, or add a GITHUB_TOKEN on the server.",
      429,
      "github_rate_limited",
    );
  }
  throw new RepoError(`GitHub returned ${res.status}.`, 502, "github");
}

const cache = new Map<string, { at: number; data: RepoData }>();
const CACHE_MS = 10 * 60 * 1000;

export async function loadRepo(id: string): Promise<RepoData> {
  if (id === "self") {
    return {
      meta: {
        id: "self",
        fullName: "Repoverse",
        description: "The source code of the app you are using right now.",
        stars: null,
        ref: "main",
        url: null,
      },
      files: self.files,
      truncated: false,
      totalFiles: self.files.length,
    };
  }

  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;

  const repo = await github<{
    full_name: string;
    description: string | null;
    stargazers_count: number;
    default_branch: string;
    html_url: string;
  }>(`/repos/${id}`);

  const tree = await github<{ tree: Array<{ path: string; type: string; size?: number }> }>(
    `/repos/${id}/git/trees/${encodeURIComponent(repo.default_branch)}?recursive=1`,
  );

  const all = tree.tree
    .filter((item) => item.type === "blob" && !IGNORED.test(item.path))
    .map((item) => ({ path: item.path, size: item.size ?? 0 }));

  // When a repo is too big to chart, keep the shallowest files: they explain the most.
  const files =
    all.length > MAX_FILES
      ? [...all].sort((a, b) => a.path.split("/").length - b.path.split("/").length).slice(0, MAX_FILES)
      : all;

  const data: RepoData = {
    meta: {
      id: repo.full_name,
      fullName: repo.full_name,
      description: repo.description ?? "",
      stars: repo.stargazers_count,
      ref: repo.default_branch,
      url: repo.html_url,
    },
    files,
    truncated: all.length > MAX_FILES,
    totalFiles: all.length,
  };
  cache.set(id, { at: Date.now(), data });
  if (cache.size > 50) cache.delete(cache.keys().next().value as string);
  return data;
}

export async function loadFile(id: string, ref: string, path: string): Promise<FileContent> {
  safePath(path);
  if (id === "self") {
    const content = self.contents[path];
    if (content === undefined) throw new RepoError("That file was not found.", 404, "not_found");
    return { content, truncated: false, binary: false };
  }
  safeRef(ref);
  const url = `${RAW}/${id}/${ref}/${path.split("/").map(encodeURIComponent).join("/")}`;
  const res = await fetch(url, {
    headers: process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {},
  });
  if (!res.ok) {
    throw new RepoError(res.status === 404 ? "That file was not found." : `GitHub returned ${res.status}.`, res.status === 404 ? 404 : 502, "file");
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  const head = bytes.subarray(0, 2000);
  if (head.includes(0)) return { content: "", truncated: false, binary: true };
  const content = new TextDecoder().decode(bytes.subarray(0, MAX_FILE_BYTES));
  return { content, truncated: bytes.length > MAX_FILE_BYTES, binary: false };
}

export function repoErrorResponse(err: unknown): Response | null {
  if (err instanceof RepoError) {
    return Response.json({ error: err.message, code: err.code }, { status: err.status });
  }
  return null;
}
