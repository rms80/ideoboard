// ───────────────────────────────────────────────────────────────────────────
// Framework-agnostic proxy handlers (Web `Request` → `Response`).
//
// Single source of truth shared by the Vercel edge wrappers (api/generate.ts,
// api/image.ts) and the Vite dev server plugin (vite-dev-api.ts), so dev and
// prod behave identically. No server secret: the Ideogram key is user-supplied
// per request, so deploy needs zero env config.
// ───────────────────────────────────────────────────────────────────────────

const IDEOGRAM_GENERATE_URL = "https://api.ideogram.ai/v1/ideogram-v4/generate";
const IDEOGRAM_DESCRIBE_URL = "https://api.ideogram.ai/v1/ideogram-v4/describe";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Api-Key",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/** Relay a multipart POST to an Ideogram endpoint with the user's key, passing the
 *  upstream status + body straight back (errors included) with CORS. Shared by the
 *  /api/generate and /api/describe routes — both forward the raw multipart body. */
async function relayMultipart(req: Request, upstreamUrl: string): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const apiKey = req.headers.get("x-api-key");
  if (!apiKey) {
    return json({ error: "Missing API key. Set it in Settings." }, 400);
  }

  // Preserve the incoming multipart Content-Type (it carries the boundary).
  const contentType = req.headers.get("content-type") ?? "multipart/form-data";
  const body = await req.arrayBuffer();

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers: { "Api-Key": apiKey, "Content-Type": contentType },
      body,
    });
  } catch (err) {
    return json({ error: `Upstream request failed: ${String(err)}` }, 502);
  }

  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": upstream.headers.get("content-type") ?? "application/json",
    },
  });
}

/** POST /api/generate — relay the multipart body to Ideogram with the user's key. */
export function generate(req: Request): Promise<Response> {
  return relayMultipart(req, IDEOGRAM_GENERATE_URL);
}

/** POST /api/describe — relay the guide image to Ideogram's describe endpoint,
 *  which returns a `json_prompt` reconstruction of the image. Ideogram-only. */
export function describe(req: Request): Promise<Response> {
  return relayMultipart(req, IDEOGRAM_DESCRIBE_URL);
}

function isAllowedImageHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return (
    h === "ideogram.ai" ||
    h.endsWith(".ideogram.ai") ||
    h.endsWith(".ideogramusercontent.com") ||
    // Ideogram serves generated images from cloud storage / CDN hosts.
    h.endsWith(".amazonaws.com") ||
    h.endsWith(".cloudfront.net") ||
    h.endsWith(".googleapis.com") ||
    h.endsWith(".storage.googleapis.com")
  );
}

/** GET /api/image?url=<ideogram-url> — stream the (expiring) image back with CORS. */
export async function image(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const target = new URL(req.url).searchParams.get("url");
  if (!target) return json({ error: "Missing ?url=" }, 400);

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return json({ error: "Invalid url" }, 400);
  }
  if (parsed.protocol !== "https:" || !isAllowedImageHost(parsed.hostname)) {
    return json({ error: `Host not allowed: ${parsed.hostname}` }, 403);
  }

  let upstream: Response;
  try {
    upstream = await fetch(parsed.toString());
  } catch (err) {
    return json({ error: `Image fetch failed: ${String(err)}` }, 502);
  }
  if (!upstream.ok) {
    return json({ error: `Image fetch returned ${upstream.status}` }, upstream.status);
  }

  const bytes = await upstream.arrayBuffer();
  return new Response(bytes, {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": upstream.headers.get("content-type") ?? "image/png",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
