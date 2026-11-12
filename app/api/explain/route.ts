import { loadFile, parseRepo, repoErrorResponse } from "@/lib/github";
import { MODELS, chatStream, errorResponse, hasKey, GroqError } from "@/lib/groq";
import { clientId, overLimit, tooMany } from "@/lib/ratelimit";
import { textStream } from "@/lib/stream";

export const maxDuration = 60;

const SYSTEM = `You explain one source file to a developer who is new to the repository.
Write Markdown, under 170 words, in this order:
1. One sentence on what the file is for.
2. A short bullet list of the important functions, components or settings, with names in backticks.
3. One sentence on how it connects to the rest of the project. Refer to other files by their path in backticks.
4. One thing to watch out for, only if there is a real one.
Be concrete. Never invent code that is not in the file. No preamble, no closing remarks.`;

/** POST /api/explain {repo, ref, path} -> streamed Markdown explanation. */
export async function POST(req: Request) {
  const wait = overLimit(`explain:${clientId(req)}`, 15, 60);
  if (wait) return tooMany(wait);
  try {
    if (!hasKey()) throw new GroqError("GROQ_API_KEY is not set on the server.", 503, "no_key");
    const body = await req.json();
    const id = parseRepo(String(body.repo ?? ""));
    const path = String(body.path ?? "");
    const neighbours = Array.isArray(body.neighbours) ? body.neighbours.slice(0, 40).map(String) : [];
    const file = await loadFile(id, String(body.ref ?? "main"), path);
    if (file.binary) {
      return new Response("This is a binary file, so there is no source to explain.");
    }

    const parts = chatStream({
      model: MODELS.smart,
      temperature: 0.3,
      max_completion_tokens: 700,
      reasoning_effort: "low",
      include_reasoning: false,
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: `Repository: ${id}\nFile: ${path}\nOther files nearby:\n${neighbours.join("\n")}\n\n--- ${path} ---\n${file.content.slice(0, 14_000)}`,
        },
      ],
    });

    // Pull the first chunk before answering, so API errors become a real error response.
    const first = await parts.next();
    return textStream(
      (async function* () {
        if (!first.done && first.value.type === "text") yield first.value.text;
        for await (const part of parts) if (part.type === "text") yield part.text;
      })(),
    );
  } catch (err) {
    return repoErrorResponse(err) ?? errorResponse(err);
  }
}
