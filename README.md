# Ideoboard

Ideoboard is a browser front-end for [Ideogram's](https://ideogram.ai) v4 text-to-image model. Instead of a single prompt box, it gives you a structured, spatial editor: you compose a scene from a high-level description, style fields, reusable text fragments (**tags**), and **boxes** drawn directly on the canvas — text or object regions with their own descriptions and z-order — then generate, branch, and iterate across a node graph of results. It's a client-side app (React + TypeScript + Vite + Tailwind, with all scenes and images stored locally in IndexedDB); the only network calls are to the image-generation provider.

## Running locally

Requires Node 18+ (the dev server uses the global `fetch`/`Request`/`Response`).

```bash
npm install
npm run dev
```

This starts Vite on **http://localhost:6868** (the port is pinned). The same dev server also mounts the `/api/*` proxy used by the Ideogram provider, so everything runs on one port — no separate backend to start.

Other scripts:

- `npm run build` — type-check (`tsc -b`) and produce a production bundle in `dist/`.
- `npm run preview` — serve the built bundle locally (also on port 6868).
- `npm run typecheck` — type-check only.

## Deployment

Ideoboard is designed to run **serverless**. It's a static single-page app (built to `dist/`) plus a couple of tiny stateless proxy functions in `api/` — there's no database, no server-side session, and no secrets to configure (provider keys are supplied per-request from the browser; see below).

- **Vercel** is the reference target. Point a Vercel project at the repo (Vite framework preset): the frontend is served as static assets and the files in `api/` (`generate`, `describe`, `image`) deploy automatically as **Edge functions** — the same handlers the dev server mounts, so dev and prod behave identically. No environment variables are required.
- **Any static host** works if you only use the Fal.ai provider, since fal is called directly from the browser and the proxy is never hit. In that case the `dist/` bundle can be dropped on Netlify, GitHub Pages, S3/CloudFront, etc. The `api/` proxy is only needed for the Ideogram provider (it exists solely to relay around Ideogram's CORS restriction).

## API support & keys

Ideoboard can talk to Ideogram through either of two providers, selectable in the in-app **Settings** dialog:

- **Fal.ai** (default) — calls the `ideogram/v4` model on the [fal.ai](https://fal.ai) queue **directly from the browser**. fal supports CORS, so no proxy is involved.
- **Ideogram API** — calls Ideogram's official API. Ideogram's endpoints don't allow direct browser (CORS) requests, so requests are **relayed through the app's own same-origin proxy** (`/api/generate`, `/api/describe`). In development the proxy is Vite middleware; in production it's a Vercel Edge function. Some features are Ideogram-only — notably **Generate Prompt from Guide**, which uses Ideogram's `describe` endpoint to reconstruct a structured prompt from a guide image.

### How keys are configured and stored

- Each provider has its **own API key**, entered in the Settings dialog. The selected provider determines which key is used.
- Keys are persisted **only in your browser's `localStorage`** (under `ideoboard-settings`). They are never written to the repo and there is no server-side key storage.
- The key is supplied **per request**: for Fal it's sent from the browser straight to fal; for Ideogram it's forwarded by the same-origin proxy to Ideogram (the proxy holds no secret of its own, so deploying needs zero environment configuration).
- With no key set for the active provider, generation falls back to a locally-rendered placeholder image, so the graph/branching flow still works offline.
