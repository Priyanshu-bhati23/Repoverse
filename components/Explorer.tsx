"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fileCount, formatBytes } from "@/lib/languages";
import { backdropFiles, buildGalaxy, type GalaxyNode } from "@/lib/layout";
import { errorOf, readNdjson, readText } from "@/lib/stream";
import type { AskEvent, FileContent, RepoData } from "@/lib/types";
import { Markdown } from "./Markdown";

const GalaxyCanvas = dynamic(() => import("./Galaxy"), { ssr: false });

const SAMPLES = ["pmndrs/zustand", "vercel/swr", "expressjs/express"];
const STARTERS = ["Where does this project start running?", "What are the main parts and how do they fit together?", "How would I add a new feature here?"];

interface Turn {
  question: string;
  opened: string[];
  answer: string;
  done: boolean;
  error?: string;
}

function keyHelp(code: string, message: string): string {
  return code === "no_key"
    ? "AI answers are switched off because the server has no Groq key. Add GROQ_API_KEY to the project's environment variables and redeploy."
    : message;
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

export default function Explorer() {
  const reducedMotion = useReducedMotion();
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "ready">("idle");
  const [loadingName, setLoadingName] = useState("");
  const [notice, setNotice] = useState("");
  const [repo, setRepo] = useState<RepoData | null>(null);

  const [selected, setSelected] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [focus, setFocus] = useState<{ id: number; tick: number } | null>(null);
  const [language, setLanguage] = useState<string | null>(null);
  const [opened, setOpened] = useState<string[] | null>(null);
  const [tab, setTab] = useState<"file" | "ask">("file");
  const [panelOpen, setPanelOpen] = useState(false);
  const [query, setQuery] = useState("");

  const backdrop = useMemo(() => buildGalaxy(backdropFiles(), "backdrop"), []);
  const galaxy = useMemo(() => (repo ? buildGalaxy(repo.files, repo.meta.fullName) : null), [repo]);

  const chart = useCallback(async (value: string) => {
    const name = value.trim();
    if (!name) return;
    setStatus("loading");
    setLoadingName(name === "self" ? "this app's source" : name);
    setNotice("");
    try {
      const res = await fetch(`/api/repo?repo=${encodeURIComponent(name)}`);
      if (!res.ok) throw new Error((await errorOf(res)).message);
      const data = (await res.json()) as RepoData;
      if (!data.files.length) throw new Error("That repo has no files to chart.");
      setRepo(data);
      setSelected(null);
      setHovered(null);
      setLanguage(null);
      setOpened(null);
      setPanelOpen(false);
      setTab("file");
      setQuery("");
      setStatus("ready");
      window.history.replaceState(null, "", `?repo=${encodeURIComponent(data.meta.id)}`);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "That repo could not be loaded.");
      setStatus("idle");
    }
  }, []);

  // A shared link opens straight into its chart.
  useEffect(() => {
    const shared = new URLSearchParams(window.location.search).get("repo");
    if (shared) {
      setInput(shared === "self" ? "" : shared);
      chart(shared);
    }
  }, [chart]);

  const reset = () => {
    setRepo(null);
    setStatus("idle");
    setSelected(null);
    setPanelOpen(false);
    window.history.replaceState(null, "", window.location.pathname);
  };

  const select = useCallback((id: number | null, fly = true) => {
    setSelected(id);
    if (id === null) return;
    setTab("file");
    setPanelOpen(true);
    if (fly) setFocus({ id, tick: Date.now() });
  }, []);

  const selectPath = useCallback(
    (path: string) => {
      if (!galaxy) return;
      const clean = path.replace(/^\.?\//, "");
      const id = galaxy.byPath.get(clean) ?? galaxy.nodes.find((n) => n.path.endsWith(`/${clean}`))?.id;
      if (id !== undefined) select(id);
    },
    [galaxy, select],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelected(null);
        setPanelOpen(false);
        setQuery("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const highlight = useMemo(() => {
    if (!galaxy) return null;
    if (opened?.length && tab === "ask") {
      const ids = new Set<number>();
      for (const path of opened) {
        let id = galaxy.byPath.get(path);
        // Light up the file and the chain of folders that leads to it.
        while (id !== undefined && id >= 0) {
          ids.add(id);
          id = galaxy.nodes[id].parent;
        }
      }
      return ids;
    }
    if (language) {
      return new Set(galaxy.nodes.filter((n) => n.kind === "dir" || n.language === language).map((n) => n.id));
    }
    return null;
  }, [galaxy, opened, language, tab]);

  const matches = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (!galaxy || text.length < 2) return [];
    // File-name matches come before matches somewhere else in the path.
    const rank = (n: GalaxyNode) => (n.name.toLowerCase().includes(text) ? 0 : 1) * 1000 + n.path.length;
    return galaxy.nodes
      .filter((n) => n.kind === "file" && n.path.toLowerCase().includes(text))
      .sort((a, b) => rank(a) - rank(b))
      .slice(0, 9);
  }, [galaxy, query]);

  const selectedNode = galaxy && selected !== null ? galaxy.nodes[selected] : null;

  return (
    <main className="stage">
      <div className={`sky ${status === "ready" ? "" : "sky-backdrop"}`}>
        <GalaxyCanvas
          key={galaxy ? repo!.meta.id : "backdrop"}
          galaxy={galaxy ?? backdrop}
          interactive={Boolean(galaxy)}
          selected={galaxy ? selected : null}
          hovered={galaxy ? hovered : null}
          highlight={highlight}
          focus={focus}
          reducedMotion={reducedMotion}
          onHover={setHovered}
          onSelect={(id) => select(id)}
        />
      </div>

      {status !== "ready" && (
        <section className="landing">
          <div className="landing-inner">
            <span className="brand">Repoverse</span>
            <h1>See a whole codebase as a sky you can fly through.</h1>
            <p className="lede">
              Paste a GitHub repo. Every folder becomes a star, every file a body in its orbit. Click one and AI explains what it does and how it
              connects.
            </p>
            <form
              className="chart-form"
              onSubmit={(e) => {
                e.preventDefault();
                chart(input);
              }}
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="owner/name or a GitHub link"
                aria-label="GitHub repository"
                autoComplete="off"
                spellCheck={false}
              />
              <button className="btn" disabled={status === "loading"}>
                Chart repo
              </button>
            </form>
            <div className="samples">
              <span>Or try</span>
              {SAMPLES.map((sample) => (
                <button key={sample} className="chip" onClick={() => (setInput(sample), chart(sample))}>
                  {sample}
                </button>
              ))}
              <button className="chip chip-plain" onClick={() => chart("self")}>
                this app&apos;s own source
              </button>
            </div>
            {notice && (
              <p className="notice" role="alert">
                {notice}
              </p>
            )}
            <div className="how">
              <div>
                <strong>Chart</strong>
                The file tree is laid out in 3D, sized by file size and coloured by language.
              </div>
              <div>
                <strong>Read</strong>
                Select any file for a plain-language explanation, streamed as it is written.
              </div>
              <div>
                <strong>Ask</strong>
                Ask a question and watch which files the AI opens to answer it.
              </div>
            </div>
          </div>
        </section>
      )}

      {status === "loading" && (
        <div className="loading" role="status">
          <p>Charting the sky</p>
          <span>{loadingName}</span>
        </div>
      )}

      {status === "ready" && repo && galaxy && (
        <>
          <header className="topbar">
            <div className="title">
              <button className="brand" onClick={reset}>
                Repoverse
              </button>
              <h1>{repo.meta.fullName}</h1>
              <p>
                {fileCount(repo.totalFiles)}
                {repo.meta.stars !== null && `, ${repo.meta.stars.toLocaleString()} stars`}
                {repo.truncated && `. Showing the ${repo.files.length.toLocaleString()} closest to the root.`}
              </p>
            </div>
            <div className="finder">
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a file" aria-label="Find a file" spellCheck={false} />
              {matches.length > 0 && (
                <ul>
                  {matches.map((node) => (
                    <li key={node.id}>
                      <button
                        onClick={() => {
                          select(node.id);
                          setQuery("");
                        }}
                      >
                        <bdi>{node.path}</bdi>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <button
              className="ghost"
              onClick={() => {
                setTab("ask");
                setPanelOpen(true);
              }}
            >
              Ask the repo
            </button>
            <button className="ghost" onClick={reset}>
              Chart another
            </button>
          </header>

          <nav className="legend" aria-label="Filter by language">
            {galaxy.languages.slice(0, 9).map((lang) => (
              <button key={lang.name} aria-pressed={language === lang.name} onClick={() => setLanguage(language === lang.name ? null : lang.name)}>
                <i style={{ background: lang.color }} />
                {lang.name}
                <b>{lang.count}</b>
              </button>
            ))}
          </nav>

          {!panelOpen && <p className="hint">Drag to orbit. Scroll to zoom. Select a star to read it.</p>}

          {panelOpen && (
            <aside className="panel" aria-label="Inspector">
              <div className="tabs" role="tablist">
                <button role="tab" aria-selected={tab === "file"} onClick={() => setTab("file")}>
                  Selection
                </button>
                <button role="tab" aria-selected={tab === "ask"} onClick={() => setTab("ask")}>
                  Ask the repo
                </button>
                <button className="close" aria-label="Close panel" onClick={() => setPanelOpen(false)}>
                  ✕
                </button>
              </div>
              <div style={{ display: tab === "file" ? "contents" : "none" }}>
                <FilePanel repo={repo} node={selectedNode} nodes={galaxy.nodes} onSelect={select} onPath={selectPath} />
              </div>
              <div style={{ display: tab === "ask" ? "contents" : "none" }}>
                <AskPanel
                  key={repo.meta.id}
                  repo={repo}
                  onOpened={(paths) => {
                    setOpened(paths);
                    // Pull back so the files being read are all in view.
                    setSelected(null);
                    setFocus({ id: -1, tick: Date.now() });
                  }}
                  onPath={selectPath}
                />
              </div>
            </aside>
          )}
        </>
      )}
    </main>
  );
}

function FilePanel({
  repo,
  node,
  nodes,
  onSelect,
  onPath,
}: {
  repo: RepoData;
  node: GalaxyNode | null;
  nodes: GalaxyNode[];
  onSelect: (id: number) => void;
  onPath: (path: string) => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [source, setSource] = useState<FileContent | null>(null);
  const cache = useRef(new Map<string, string>());

  const isFile = node?.kind === "file";
  const cacheKey = node ? `${repo.meta.id}:${node.path}` : "";

  useEffect(() => {
    setText("");
    setError("");
    setSource(null);
    if (!node || !isFile) return;

    const cached = cache.current.get(cacheKey);
    if (cached) {
      setText(cached);
      return;
    }

    const controller = new AbortController();
    setBusy(true);
    (async () => {
      try {
        const neighbours = nodes[node.parent].children.map((id) => nodes[id].path).filter((p) => p !== node.path);
        const res = await fetch("/api/explain", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repo: repo.meta.id, ref: repo.meta.ref, path: node.path, neighbours }),
          signal: controller.signal,
        });
        if (!res.ok) {
          const { message, code } = await errorOf(res);
          throw new Error(keyHelp(code, message));
        }
        let full = "";
        await readText(res, (chunk) => {
          full += chunk;
          setText(full);
        });
        cache.current.set(cacheKey, full);
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "The explanation failed.");
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    })();
    return () => controller.abort();
    // The node id identifies the selection; the rest is derived from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey]);

  const loadSource = async () => {
    if (source || !node) return;
    try {
      const params = new URLSearchParams({ repo: repo.meta.id, ref: repo.meta.ref, path: node.path });
      const res = await fetch(`/api/file?${params}`);
      if (!res.ok) throw new Error((await errorOf(res)).message);
      setSource((await res.json()) as FileContent);
    } catch (err) {
      setSource({ content: err instanceof Error ? err.message : "Could not load the file.", truncated: false, binary: false });
    }
  };

  if (!node) {
    return (
      <div className="panel-body">
        <p className="muted">Select a star in the chart to read it here.</p>
      </div>
    );
  }

  if (!isFile) {
    const children = [...node.children].sort((a, b) => Number(nodes[a].kind === "file") - Number(nodes[b].kind === "file") || nodes[b].count - nodes[a].count);
    return (
      <div className="panel-body">
        <h2>{node.name}</h2>
        {node.path && <p className="path">{node.path}</p>}
        <div className="facts">
          <span>{fileCount(node.count)}</span>
          <span>{formatBytes(node.bytes)}</span>
        </div>
        <ul className="children">
          {children.slice(0, 80).map((id) => (
            <li key={id}>
              <button onClick={() => onSelect(id)}>
                <i style={{ background: nodes[id].kind === "dir" ? "#F3E9CF" : nodes[id].color }} />
                {nodes[id].name}
                {nodes[id].kind === "dir" && "/"}
                <b>{nodes[id].kind === "dir" ? fileCount(nodes[id].count) : formatBytes(nodes[id].bytes)}</b>
              </button>
            </li>
          ))}
        </ul>
        {children.length > 80 && <p className="muted">And {children.length - 80} more.</p>}
      </div>
    );
  }

  return (
    <div className="panel-body">
      <h2>{node.name}</h2>
      <p className="path">{node.path}</p>
      <div className="facts">
        <span>
          <i style={{ background: node.color }} />
          {node.language}
        </span>
        <span>{formatBytes(node.bytes)}</span>
        {repo.meta.url && (
          <a href={`${repo.meta.url}/blob/${repo.meta.ref}/${node.path}`} target="_blank" rel="noreferrer">
            Open on GitHub
          </a>
        )}
      </div>
      {error ? (
        <p className="notice" role="alert">
          {error}
        </p>
      ) : text ? (
        <div className={busy ? "cursor" : ""}>
          <Markdown text={text} onPath={onPath} />
        </div>
      ) : (
        <p className="muted cursor">Reading the file</p>
      )}
      <details className="source" onToggle={(e) => (e.currentTarget.open ? loadSource() : undefined)}>
        <summary>Show the source</summary>
        <pre>{source ? (source.binary ? "Binary file." : source.content + (source.truncated ? "\n\n(cut off here)" : "")) : "Loading"}</pre>
      </details>
    </div>
  );
}

function AskPanel({ repo, onOpened, onPath }: { repo: RepoData; onOpened: (paths: string[] | null) => void; onPath: (path: string) => void }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [turns]);

  const ask = async (question: string) => {
    const text = question.trim();
    if (!text || busy) return;
    setDraft("");
    setBusy(true);
    const history = turns
      .filter((t) => t.done && !t.error)
      .flatMap((t) => [
        { role: "user", content: t.question },
        { role: "assistant", content: t.answer },
      ]);
    setTurns((all) => [...all, { question: text, opened: [], answer: "", done: false }]);
    const patch = (change: Partial<Turn> | ((t: Turn) => Partial<Turn>)) =>
      setTurns((all) => all.map((t, i) => (i === all.length - 1 ? { ...t, ...(typeof change === "function" ? change(t) : change) } : t)));

    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: repo.meta.id, ref: repo.meta.ref, question: text, paths: repo.files.map((f) => f.path), history }),
      });
      if (!res.ok) {
        const { message, code } = await errorOf(res);
        throw new Error(keyHelp(code, message));
      }
      await readNdjson<AskEvent>(res, (event) => {
        if (event.t === "reading") {
          patch({ opened: event.paths });
          onOpened(event.paths);
        } else if (event.t === "delta") {
          patch((t) => ({ answer: t.answer + event.text }));
        } else if (event.t === "error") {
          patch({ error: keyHelp(event.code ?? "", event.message), done: true });
        } else if (event.t === "done") {
          patch({ done: true });
        }
      });
      patch({ done: true });
    } catch (err) {
      patch({ error: err instanceof Error ? err.message : "The question failed.", done: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="panel-body">
        {turns.length === 0 ? (
          <>
            <h2>Ask the repo</h2>
            <p className="muted" style={{ marginTop: 8 }}>
              The AI reads the file tree, opens the files it needs, and answers from them. The files it opens light up in the chart.
            </p>
            <div className="starters">
              {STARTERS.map((starter) => (
                <button key={starter} className="chip chip-plain" onClick={() => ask(starter)}>
                  {starter}
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="thread">
            {turns.map((turn, i) => (
              <div key={i} style={{ display: "contents" }}>
                <div className="q">{turn.question}</div>
                <div>
                  {turn.opened.length > 0 && (
                    <div className="opened">
                      Opened
                      {turn.opened.map((path) => (
                        <button key={path} className="chip" onClick={() => onPath(path)} title={path}>
                          {path.slice(path.lastIndexOf("/") + 1)}
                        </button>
                      ))}
                    </div>
                  )}
                  {turn.error ? (
                    <p className="notice" role="alert">
                      {turn.error}
                    </p>
                  ) : turn.answer ? (
                    <div className={turn.done ? "" : "cursor"}>
                      <Markdown text={turn.answer} onPath={onPath} />
                    </div>
                  ) : (
                    <p className="muted cursor">{turn.opened.length ? "Reading those files" : "Choosing which files to open"}</p>
                  )}
                </div>
              </div>
            ))}
            <div ref={bottom} />
          </div>
        )}
      </div>
      <form
        className="ask-form"
        onSubmit={(e) => {
          e.preventDefault();
          ask(draft);
        }}
      >
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Ask about this codebase" aria-label="Your question" />
        <button className="btn" disabled={busy || !draft.trim()}>
          Ask
        </button>
      </form>
    </>
  );
}
