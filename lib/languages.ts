export interface Language {
  name: string;
  color: string;
}

const GROUPS: Array<[Language, string[]]> = [
  [{ name: "TypeScript", color: "#6AA8FF" }, ["ts", "tsx", "mts", "cts"]],
  [{ name: "JavaScript", color: "#F4D35E" }, ["js", "jsx", "mjs", "cjs"]],
  [{ name: "Python", color: "#7BD389" }, ["py", "pyi", "ipynb"]],
  [{ name: "Go", color: "#5ED3E8" }, ["go"]],
  [{ name: "Rust", color: "#F2916B" }, ["rs"]],
  [{ name: "Java and Kotlin", color: "#E57A7A" }, ["java", "kt", "kts", "scala", "gradle"]],
  [{ name: "C and C++", color: "#B49CFF" }, ["c", "h", "cc", "cpp", "hpp", "cxx", "m", "mm"]],
  [{ name: "C#", color: "#9FE0B0" }, ["cs"]],
  [{ name: "Ruby", color: "#FF7A9A" }, ["rb", "erb", "gemspec"]],
  [{ name: "PHP", color: "#A9A0FF" }, ["php"]],
  [{ name: "Swift", color: "#FF9D6B" }, ["swift"]],
  [{ name: "Styles", color: "#F29AD8" }, ["css", "scss", "sass", "less", "styl"]],
  [{ name: "Markup", color: "#FFA95E" }, ["html", "htm", "vue", "svelte", "astro", "xml"]],
  [{ name: "Shell", color: "#A8E05F" }, ["sh", "bash", "zsh", "fish", "ps1", "bat"]],
  [{ name: "Config", color: "#9AA7C7" }, ["json", "yaml", "yml", "toml", "ini", "lock", "env", "conf"]],
  [{ name: "Docs", color: "#EDE6D3" }, ["md", "mdx", "txt", "rst", "adoc"]],
  [{ name: "Assets", color: "#6E7AA8" }, ["png", "jpg", "jpeg", "gif", "svg", "ico", "webp", "avif", "woff", "woff2", "ttf", "mp4", "mp3", "pdf"]],
];

const OTHER: Language = { name: "Other", color: "#8590B5" };

const BY_EXT = new Map<string, Language>();
for (const [lang, exts] of GROUPS) for (const ext of exts) BY_EXT.set(ext, lang);

export function languageOf(path: string): Language {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return OTHER;
  return BY_EXT.get(name.slice(dot + 1).toLowerCase()) ?? OTHER;
}

export function isAsset(path: string): boolean {
  return languageOf(path).name === "Assets";
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** "1 file", "23 files", "1,204 files". */
export function fileCount(count: number): string {
  return `${count.toLocaleString()} ${count === 1 ? "file" : "files"}`;
}
