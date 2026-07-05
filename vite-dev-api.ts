import type { Plugin, Connect } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import { generate, describe, image } from "./api/handlers";

// Mounts the framework-agnostic proxy handlers at /api/* inside the Vite dev
// server, so `npm run dev` serves the app AND the proxy on one port (6868).
// Node 18+ provides global Request/Response/fetch — no extra deps.

const ROUTES: Record<string, (req: Request) => Promise<Response>> = {
  "/api/generate": generate,
  "/api/describe": describe,
  "/api/image": image,
};

async function nodeToWebRequest(req: IncomingMessage): Promise<Request> {
  const url = `http://localhost${req.url ?? "/"}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }

  const method = req.method ?? "GET";
  let body: Buffer | undefined;
  if (method !== "GET" && method !== "HEAD") {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    body = Buffer.concat(chunks);
  }

  return new Request(url, {
    method,
    headers,
    body: body && body.length ? body : undefined,
  });
}

async function writeWebResponse(res: ServerResponse, webRes: Response): Promise<void> {
  res.statusCode = webRes.status;
  webRes.headers.forEach((value, key) => res.setHeader(key, value));
  const buf = Buffer.from(await webRes.arrayBuffer());
  res.end(buf);
}

export function devApiPlugin(): Plugin {
  return {
    name: "ideoboard-dev-api",
    configureServer(server) {
      const handler: Connect.NextHandleFunction = (req, res, next) => {
        const pathname = (req.url ?? "").split("?")[0];
        const route = ROUTES[pathname];
        if (!route) return next();

        nodeToWebRequest(req)
          .then((webReq) => route(webReq))
          .then((webRes) => writeWebResponse(res, webRes))
          .catch((err) => {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: String(err) }));
          });
      };
      server.middlewares.use(handler);
    },
  };
}
