import { loadRepo, parseRepo, repoErrorResponse } from "@/lib/github";
import { errorResponse } from "@/lib/groq";
import { clientId, overLimit, tooMany } from "@/lib/ratelimit";

/** GET /api/repo?repo=owner/name -> the repo's file tree, ready to chart. */
export async function GET(req: Request) {
  const wait = overLimit(`repo:${clientId(req)}`, 20, 60);
  if (wait) return tooMany(wait);
  try {
    const id = parseRepo(new URL(req.url).searchParams.get("repo") ?? "");
    return Response.json(await loadRepo(id));
  } catch (err) {
    return repoErrorResponse(err) ?? errorResponse(err);
  }
}
