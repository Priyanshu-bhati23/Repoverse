import { languageOf } from "./languages";
import type { FileEntry } from "./types";

/**
 * Turns a flat list of file paths into a 3D "galaxy".
 *
 * Every folder is a star. Its files orbit it on a small shell, and its
 * sub-folders are thrown outward inside a cone that points away from the
 * parent, so the tree keeps expanding instead of folding back on itself.
 * The layout is deterministic: the same repo always draws the same sky.
 */

export interface GalaxyNode {
  id: number;
  path: string;
  name: string;
  kind: "dir" | "file";
  depth: number;
  parent: number;
  x: number;
  y: number;
  z: number;
  /** Radius of the body in world units. */
  radius: number;
  bytes: number;
  /** Files in this folder's subtree. 1 for a file. */
  count: number;
  language: string;
  color: string;
  children: number[];
}

export interface Galaxy {
  nodes: GalaxyNode[];
  byPath: Map<string, number>;
  /** Distance from the centre to the farthest body. */
  radius: number;
  languages: Array<{ name: string; color: string; count: number }>;
}

type Vec = [number, number, number];

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** The i-th of n points spread evenly over a spherical cap around +Y. */
function capPoint(i: number, n: number, halfAngle: number): Vec {
  const t = 1 - ((i + 0.5) / n) * (1 - Math.cos(halfAngle));
  const r = Math.sqrt(Math.max(0, 1 - t * t));
  const phi = i * GOLDEN_ANGLE;
  return [r * Math.cos(phi), t, r * Math.sin(phi)];
}

/** Rotate a vector defined around +Y so that +Y lines up with `dir`. */
function orient(v: Vec, dir: Vec): Vec {
  const helper: Vec = Math.abs(dir[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = normalize(cross(helper, dir));
  const w = cross(dir, u);
  return [
    u[0] * v[0] + dir[0] * v[1] + w[0] * v[2],
    u[1] * v[0] + dir[1] * v[1] + w[1] * v[2],
    u[2] * v[0] + dir[2] * v[1] + w[2] * v[2],
  ];
}

function cross(a: Vec, b: Vec): Vec {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalize(v: Vec): Vec {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

/** Stable pseudo-random number in [0, 1) from a string. */
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

export function buildGalaxy(files: FileEntry[], rootName: string): Galaxy {
  const nodes: GalaxyNode[] = [];
  const byPath = new Map<string, number>();

  const add = (path: string, name: string, kind: "dir" | "file", parent: number, depth: number, bytes: number) => {
    const lang = kind === "file" ? languageOf(path) : { name: "Folder", color: "#F3E9CF" };
    const node: GalaxyNode = {
      id: nodes.length,
      path,
      name,
      kind,
      depth,
      parent,
      x: 0,
      y: 0,
      z: 0,
      radius: 0,
      bytes,
      count: kind === "file" ? 1 : 0,
      language: lang.name,
      color: lang.color,
      children: [],
    };
    nodes.push(node);
    byPath.set(path, node.id);
    if (parent >= 0) nodes[parent].children.push(node.id);
    return node.id;
  };

  add("", rootName, "dir", -1, 0, 0);

  for (const file of files) {
    const parts = file.path.split("/");
    let parent = 0;
    let prefix = "";
    for (let i = 0; i < parts.length - 1; i++) {
      prefix = prefix ? `${prefix}/${parts[i]}` : parts[i];
      parent = byPath.get(prefix) ?? add(prefix, parts[i], "dir", parent, i + 1, 0);
    }
    add(file.path, parts[parts.length - 1], "file", parent, parts.length, file.size);
  }

  // Roll file counts and sizes up to every folder (children always come after parents).
  for (let i = nodes.length - 1; i > 0; i--) {
    const node = nodes[i];
    nodes[node.parent].count += node.count;
    nodes[node.parent].bytes += node.bytes;
  }

  for (const node of nodes) {
    node.radius =
      node.kind === "file"
        ? Math.min(0.34, 0.11 + 0.05 * Math.log10(1 + node.bytes / 200))
        : Math.min(0.95, 0.3 + 0.085 * Math.log2(1 + node.count));
  }

  const place = (id: number, dir: Vec) => {
    const node = nodes[id];
    const files = node.children.filter((c) => nodes[c].kind === "file");
    const dirs = node.children.filter((c) => nodes[c].kind === "dir").sort((a, b) => nodes[b].count - nodes[a].count);

    const shell = files.length ? node.radius + 0.7 + 0.42 * Math.sqrt(files.length) : node.radius;
    files.forEach((fileId, i) => {
      const file = nodes[fileId];
      const p = capPoint(i, files.length, Math.PI);
      const r = shell * (0.82 + 0.36 * hash(file.path));
      file.x = node.x + p[0] * r;
      file.y = node.y + p[1] * r;
      file.z = node.z + p[2] * r;
    });

    const isRoot = id === 0;
    const halfAngle = isRoot ? Math.PI : Math.min(1.3, 0.55 + 0.11 * dirs.length);
    dirs.forEach((dirId, i) => {
      const child = nodes[dirId];
      const outward = orient(capPoint(i, dirs.length, halfAngle), dir);
      const distance = shell + 2.4 + 1.55 * Math.sqrt(child.count) + (isRoot ? 1.5 : 0);
      child.x = node.x + outward[0] * distance;
      child.y = node.y + outward[1] * distance;
      child.z = node.z + outward[2] * distance;
      place(dirId, outward);
    });
  };

  place(0, [0, 1, 0]);

  // Centre the whole chart on the origin so the camera frames all of it.
  const min: Vec = [Infinity, Infinity, Infinity];
  const max: Vec = [-Infinity, -Infinity, -Infinity];
  for (const node of nodes) {
    min[0] = Math.min(min[0], node.x);
    min[1] = Math.min(min[1], node.y);
    min[2] = Math.min(min[2], node.z);
    max[0] = Math.max(max[0], node.x);
    max[1] = Math.max(max[1], node.y);
    max[2] = Math.max(max[2], node.z);
  }
  for (const node of nodes) {
    node.x -= (min[0] + max[0]) / 2;
    node.y -= (min[1] + max[1]) / 2;
    node.z -= (min[2] + max[2]) / 2;
  }

  let radius = 1;
  const counts = new Map<string, { name: string; color: string; count: number }>();
  for (const node of nodes) {
    radius = Math.max(radius, Math.hypot(node.x, node.y, node.z));
    if (node.kind === "file") {
      const entry = counts.get(node.language) ?? { name: node.language, color: node.color, count: 0 };
      entry.count++;
      counts.set(node.language, entry);
    }
  }

  return {
    nodes,
    byPath,
    radius,
    languages: [...counts.values()].sort((a, b) => b.count - a.count),
  };
}

/** A made-up repo, used only as the backdrop before a real one is charted. */
export function backdropFiles(count = 420): FileEntry[] {
  const exts = ["ts", "ts", "tsx", "tsx", "js", "css", "json", "md", "py", "go", "rs", "html", "svg"];
  const files: FileEntry[] = [];
  let seed = 7;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const dirs: string[] = [""];
  for (let i = 0; i < 46; i++) {
    const parent = dirs[Math.floor(rand() * rand() * dirs.length)];
    if (parent.split("/").length > 4) continue;
    dirs.push(parent ? `${parent}/d${i}` : `d${i}`);
  }
  for (let i = 0; i < count; i++) {
    const dir = dirs[Math.floor(rand() * dirs.length)];
    const ext = exts[Math.floor(rand() * exts.length)];
    files.push({ path: `${dir ? `${dir}/` : ""}f${i}.${ext}`, size: Math.floor(200 + rand() * rand() * 60000) });
  }
  return files;
}
