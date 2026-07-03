// ───────────────────────────────────────────────────────────────────────────
// Fal.ai send-time client for Ideogram v4.
//
// Called DIRECTLY from the browser (fal supports CORS) — no /api proxy — via the
// queue REST API: submit → poll status → fetch result. Ideogram v4 was trained
// natively on its structured-JSON layout schema, and fal forwards the raw string
// `prompt` straight to the model — so we pass the SAME stringified `V4JsonPrompt`
// we send to the direct API's `json_prompt` field, preserving boxes/bboxes/style
// (not a flattened text prompt). Results come back in the same shape as the
// direct Ideogram path (`IdeogramResponse`) so the caller treats both uniformly.
// ───────────────────────────────────────────────────────────────────────────
import { promptToV4Json } from "./ideogram";
import type { IdeogramResponse } from "./ideogram";
import type { StructuredPrompt, RenderingSpeed } from "../types";

const FAL_MODEL_URL = "https://queue.fal.run/ideogram/v4";
const POLL_INTERVAL_MS = 1000;
const MAX_WAIT_MS = 5 * 60_000;

// Ideogram's own speed enum (TURBO|DEFAULT|QUALITY) → Fal's (TURBO|BALANCED|QUALITY).
const SPEED_MAP: Record<RenderingSpeed, string> = {
  TURBO: "TURBO",
  DEFAULT: "BALANCED",
  QUALITY: "QUALITY",
};

// Our resolution strings are "WIDTHxHEIGHT"; Fal wants a {width,height} object
// (or a named preset). Parse to explicit dims, falling back to a square preset.
function toImageSize(resolution: string): { width: number; height: number } | string {
  const m = /^(\d+)x(\d+)$/.exec(resolution.trim());
  if (!m) return "square_hd";
  return { width: Number(m[1]), height: Number(m[2]) };
}

interface FalSubmit {
  status_url?: string;
  response_url?: string;
}
interface FalResultImage {
  url: string;
  width?: number;
  height?: number;
}
interface FalResult {
  images?: FalResultImage[];
  seed?: number;
  has_nsfw_concepts?: boolean[];
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Unexpected response from Fal.ai: ${text.slice(0, 200)}`);
  }
}

function falError(json: unknown, status: number): string {
  const e = json as { detail?: unknown; error?: string; message?: string };
  if (typeof e?.detail === "string") return e.detail;
  if (Array.isArray(e?.detail) && e.detail.length) {
    const first = e.detail[0] as { msg?: string };
    if (first?.msg) return first.msg;
  }
  return e?.error || e?.message || `Fal.ai request failed (HTTP ${status})`;
}

/** Submit → poll → fetch via Fal's queue API. Throws on error. */
export async function generateImageViaFal(
  prompt: StructuredPrompt,
  apiKey: string
): Promise<IdeogramResponse> {
  const auth = { Authorization: `Key ${apiKey}` };

  const submitRes = await fetch(FAL_MODEL_URL, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      // Stringified Ideogram v4 layout schema — fal forwards it verbatim to the
      // model, which was trained on exactly this JSON (must match the schema or
      // the reference pipeline rejects it).
      prompt: JSON.stringify(promptToV4Json(prompt)),
      image_size: toImageSize(prompt.resolution),
      rendering_speed: SPEED_MAP[prompt.renderingSpeed] ?? "BALANCED",
      num_images: 1,
      // Embed the result as a data: URI so we never depend on a media host's CORS.
      sync_mode: true,
    }),
  });
  const submitJson = await readJson(submitRes);
  if (!submitRes.ok) throw new Error(falError(submitJson, submitRes.status));

  const { status_url, response_url } = submitJson as FalSubmit;
  if (!status_url || !response_url) {
    throw new Error("Fal.ai response missing status/response URLs.");
  }

  // Poll until COMPLETED (or the model reports a terminal failure / we time out).
  const deadline = Date.now() + MAX_WAIT_MS;
  for (;;) {
    await sleep(POLL_INTERVAL_MS);
    const statusRes = await fetch(status_url, { headers: auth });
    const statusJson = await readJson(statusRes);
    if (!statusRes.ok) throw new Error(falError(statusJson, statusRes.status));
    const status = (statusJson as { status?: string }).status;
    if (status === "COMPLETED") break;
    if (status && status !== "IN_QUEUE" && status !== "IN_PROGRESS") {
      throw new Error(`Fal.ai generation ${status.toLowerCase()}.`);
    }
    if (Date.now() > deadline) throw new Error("Fal.ai generation timed out.");
  }

  const resultRes = await fetch(response_url, { headers: auth });
  const resultJson = await readJson(resultRes);
  if (!resultRes.ok) throw new Error(falError(resultJson, resultRes.status));

  const result = resultJson as FalResult;
  const images = result.images ?? [];
  if (!images.length) throw new Error("Fal.ai returned no images.");

  return {
    data: images.map((img) => ({
      url: img.url,
      seed: result.seed,
      resolution: img.width && img.height ? `${img.width}x${img.height}` : undefined,
      is_image_safe: result.has_nsfw_concepts ? !result.has_nsfw_concepts[0] : undefined,
    })),
  };
}
