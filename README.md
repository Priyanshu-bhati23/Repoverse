# Repoverse

Turn any GitHub repository into a 3D star chart you can fly through. Every folder is a star, every file orbits it, and AI explains whatever you select.

## What it does

- **Chart**: paste `owner/name` or a GitHub link. The file tree is laid out in 3D, sized by file size and coloured by language.
- **Read**: select a file to get a plain-language explanation, streamed as it is written. Paths in the explanation are links that fly the camera to that file.
- **Ask**: ask a question about the codebase. A fast model reads the file tree and picks the files worth opening, the server fetches them, and a stronger model answers from them. The files it opened light up in the chart.
- **No setup demo**: "this app's own source" charts Repoverse itself from a snapshot taken at build time, so it works without calling GitHub.

## How it is built

| Part | Where | Notes |
| --- | --- | --- |
| 3D layout | `lib/layout.ts` | Deterministic. Folders are thrown outward in a cone, files sit on a shell around their folder. |
| 3D scene | `components/Galaxy.tsx` | React Three Fiber. Instanced meshes, so 1,200 files draw in a handful of draw calls. |
| GitHub access | `lib/github.ts` | Server only. Validates repo names and paths, caches trees for 10 minutes. |
| Groq client | `lib/groq.ts` | A small `fetch` wrapper with streaming, typed errors and one patient retry on rate limits. |
| Retrieval | `app/api/ask/route.ts` | No vector database: the model picks files from the tree, then answers from their contents. |
| Rate limiting | `lib/ratelimit.ts` | Per-IP, in memory. A speed bump that protects the API quota. |

Stack: Next.js (App Router), TypeScript, React Three Fiber, three.js, Groq (`openai/gpt-oss-120b` and `openai/gpt-oss-20b`).

## Run it locally

```bash
npm install
cp .env.example .env.local   # then add your GROQ_API_KEY
npm run dev
```

Open http://localhost:3000.

## Deploy to Vercel

1. Import the repository in Vercel.
2. Add the environment variable `GROQ_API_KEY`.
3. Optional: add `GITHUB_TOKEN` to raise GitHub's limit from 60 to 5,000 requests an hour.
4. Deploy.

## Limits

- Repos with more than 1,200 files are charted from the files closest to the root.
- Without `GITHUB_TOKEN`, GitHub allows 60 requests an hour per server IP address.
- Groq's free plan has per-minute token limits. When one is hit, the app says so and asks you to wait.
