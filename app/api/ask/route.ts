import { loadFile, parseRepo, repoErrorResponse } from "@/lib/github";
import { MODELS, chat, chatStream, errorResponse, hasKey, parseJson, GroqError, type Message } from "@/lib/groq";
import { clientId, overLimit, tooMany } from "@/lib/ratelimit";
import { ndjson } from "@/lib/stream";
import type { AskEvent } from "@/lib/types";

export const maxDuration = 60;

const MAX_PATHS = 900;
const MAX_PICKS = 5;
const MAX_CHARS_PER_FILE = 8_000;

const PICK_SYSTEM = `You choose which files to open to answer a question about a code repository.
You get the question and the list of file paths. Reply with JSON: {"files": ["path", ...]}.
Pick up to ${MAX_PICKS} paths, copied exactly from the list, most useful first.
Prefer entry points, the files named in the question, and config that decides behaviour.`;

const ANSWER_SYSTEM = `You answer questions about a code repository for a developer.
You are given the question and the contents of a few files that were opened for it.
Answer in Markdown, under 220 words. Lead with the direct answer.
Name files by their full path in backticks every time you rely on one.
If the files do not contain the answer, say what is missing instead of guessing.`;

const PICK_SCHEMA = {
  type: "json_schema",
  json_schema: {
    name: "file_picks",
    schema: {
      type: "object",
      properties: { files: { type: "array", items: { type: "string" } } },
      required: ["files"],
      additionalProperties: false,
    },
  },
};

/** Files worth reading when the model's picks are unusable. */
function fallbackPicks(paths: string[]): string[] {
  const wanted = [/^readme(\.\w+)?$/i, /^package\.json$/, /^pyproject\.toml$/, /^go\.mod$/, /^cargo\.toml$/i, /(^|\/)(main|index|app)\.\w+$/i];
  const picks: string[] = [];
  for (const pattern of wanted) {
    const hit = paths.find((p) => pattern.test(p) && !picks.includes(p));
    if (hit) picks.push(hit);
  }
  return picks.slice(0, MAX_PICKS);
}

/**
 * POST /api/ask {repo, ref, question, paths, history}
 * Retrieval without a vector database: a fast model reads the file tree and
 * picks what to open, the server fetches those files, and a stronger model
 * answers from them. Events stream back as newline-delimited JSON.
 */
export async function POST(req: Request) {
  const wait = overLimit(`ask:${clientId(req)}`, 10, 60);
  if (wait) return tooMany(wait);

  let id: string, ref: string, question: string, paths: string[], history: Message[];
  try {
    if (!hasKey()) throw new GroqError("GROQ_API_KEY is not set on the server.", 503, "no_key");
    const body = await req.json();
    id = parseRepo(String(body.repo ?? ""));
    ref = String(body.ref ?? "main");
    question = String(body.question ?? "").trim().slice(0, 600);
    paths = (Array.isArray(body.paths) ? body.paths : []).slice(0, MAX_PATHS).map(String);
    history = (Array.isArray(body.history) ? body.history : [])
      .slice(-4)
      .filter((m: Message) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .map((m: Message) => ({ role: m.role, content: String(m.content).slice(0, 1200) }));
    if (!question) return Response.json({ error: "Ask a question first.", code: "empty" }, { status: 400 });
  } catch (err) {
    return repoErrorResponse(err) ?? errorResponse(err);
  }

  return ndjson<AskEvent>(async (send) => {
    try {
      const known = new Set(paths);

      const pick = await chat({
        model: MODELS.fast,
        temperature: 0,
        max_completion_tokens: 400,
        reasoning_effort: "low",
        include_reasoning: false,
        response_format: PICK_SCHEMA,
        messages: [
          { role: "system", content: PICK_SYSTEM },
          { role: "user", content: `Question: ${question}\n\nFile paths:\n${paths.join("\n")}` },
        ],
      });

      let picks = (parseJson<{ files: string[] }>(pick.message.content)?.files ?? [])
        .filter((p) => typeof p === "string" && known.has(p))
        .slice(0, MAX_PICKS);
      if (!picks.length) picks = fallbackPicks(paths);
      send({ t: "reading", paths: picks });

      const opened = await Promise.all(
        picks.map(async (path) => {
          try {
            const file = await loadFile(id, ref, path);
            return file.binary ? null : `--- ${path} ---\n${file.content.slice(0, MAX_CHARS_PER_FILE)}`;
          } catch {
            return null;
          }
        }),
      );
      const context = opened.filter(Boolean).join("\n\n");

      const parts = chatStream({
        model: MODELS.smart,
        temperature: 0.3,
        max_completion_tokens: 900,
        reasoning_effort: "low",
        include_reasoning: false,
        messages: [
          { role: "system", content: ANSWER_SYSTEM },
          ...history,
          { role: "user", content: `Repository: ${id}\nQuestion: ${question}\n\nOpened files:\n${context || "(none could be opened)"}` },
        ],
      });
      for await (const part of parts) if (part.type === "text") send({ t: "delta", text: part.text });
      send({ t: "done" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong.";
      send({ t: "error", message, code: err instanceof GroqError ? err.code : "server" });
    }
  });
}
