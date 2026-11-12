import { loadFile, parseRepo, repoErrorResponse } from "@/lib/github";
import { errorResponse } from "@/lib/groq";
import { clientId, overLimit, tooMany } from "@/lib/ratelimit";

/** GET /api/file?repo=&ref=&path= -> one file's text. */
export async function GET(req: Request) {
  const wait = overLimit(`file:${clientId(req)}`, 90, 60);
  if (wait) return tooMany(wait);
  try {
    const params = new URL(req.url).searchParams;
    const id = parseRepo(params.get("repo") ?? "");
    return Response.json(await loadFile(id, params.get("ref") ?? "main", params.get("path") ?? ""));
  } catch (err) {
    return repoErrorResponse(err) ?? errorResponse(err);
  }
}
