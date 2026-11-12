// Writes lib/self-snapshot.json: this app's own source tree, so "Explore this
// app's source" works without calling GitHub. Runs before dev and build.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath, not URL.pathname: on Windows the pathname is "/C:/...", which is not a usable path.
const root = fileURLToPath(new URL("..", import.meta.url));
const include = ["app", "components", "lib", "scripts", "package.json", "next.config.ts", "tsconfig.json", "README.md"];
const skip = new Set(["self-snapshot.json"]);
const MAX_BYTES = 40_000;

const files = [];
const contents = {};

function walk(path) {
  const stat = statSync(path, { throwIfNoEntry: false });
  if (!stat) return;
  if (stat.isDirectory()) {
    for (const name of readdirSync(path).sort()) walk(join(path, name));
    return;
  }
  const rel = relative(root, path).split("\\").join("/");
  if (skip.has(rel.split("/").pop())) return;
  files.push({ path: rel, size: stat.size });
  contents[rel] = readFileSync(path, "utf8").slice(0, MAX_BYTES);
}

for (const entry of include) walk(join(root, entry));

writeFileSync(join(root, "lib", "self-snapshot.json"), JSON.stringify({ files, contents }));
console.log(`snapshot: ${files.length} files`);
