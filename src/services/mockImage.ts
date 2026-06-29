// ───────────────────────────────────────────────────────────────────────────
// services/mockImage.ts — Testing-mode placeholder renderer.
//
// When no Ideogram API key is configured, the generation flow synthesizes a
// local image instead of calling the API, so the full Generate / Regenerate /
// branch workflow can be exercised offline. The image is drawn on a canvas at
// the prompt's resolution: a random background, each Object box filled with a
// (random or chosen) color with its label drawn on top, and each Text box's
// literal text drawn centered. Everything is clipped to its box.
// ───────────────────────────────────────────────────────────────────────────
import type { StructuredPrompt } from "../types";

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface MockImage {
  blob: Blob;
  width: number;
  height: number;
}

/** Pleasant-ish random HSL color. */
function randColor(satBase = 55, lightBase = 45): string {
  const h = Math.floor(Math.random() * 360);
  const s = satBase + Math.floor(Math.random() * 30);
  const l = lightBase + Math.floor(Math.random() * 20);
  return `hsl(${h}, ${s}%, ${l}%)`;
}

function parseResolution(res: string | undefined): { w: number; h: number } {
  const [w, h] = (res ?? "").split("x").map((n) => parseInt(n, 10));
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return { w, h };
  return { w: 1024, h: 1024 };
}

function makeCanvas(w: number, h: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

async function canvasToBlob(canvas: OffscreenCanvas | HTMLCanvasElement): Promise<Blob> {
  if (typeof OffscreenCanvas !== "undefined" && canvas instanceof OffscreenCanvas) {
    return canvas.convertToBlob({ type: "image/png" });
  }
  const el = canvas as HTMLCanvasElement;
  return new Promise<Blob>((resolve, reject) =>
    el.toBlob((b) => (b ? resolve(b) : reject(new Error("canvas.toBlob returned null"))), "image/png")
  );
}

/** Draw text centered + clipped within a box rect, shrinking to fit the width. */
function drawCenteredText(
  ctx: Ctx2D,
  text: string,
  x: number,
  y: number,
  bw: number,
  bh: number,
  color: string
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, bw, bh);
  ctx.clip();
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  let fontSize = Math.max(10, Math.min(bh * 0.5, bw * 0.3));
  ctx.font = `bold ${fontSize}px sans-serif`;
  while (fontSize > 8 && ctx.measureText(text).width > bw * 0.92) {
    fontSize -= 1;
    ctx.font = `bold ${fontSize}px sans-serif`;
  }
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = Math.max(1, fontSize * 0.08);
  ctx.fillText(text, x + bw / 2, y + bh / 2);
  ctx.restore();
}

/** Render a placeholder image for the given prompt (testing mode). */
export async function renderMockImage(prompt: StructuredPrompt): Promise<MockImage> {
  const { w, h } = parseResolution(prompt.resolution);
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext("2d") as Ctx2D | null;
  if (!ctx) throw new Error("Could not acquire a 2D canvas context for the test image.");

  // Random background.
  ctx.fillStyle = randColor(30, 35);
  ctx.fillRect(0, 0, w, h);

  const thin = Math.max(1, Math.min(w, h) * 0.0025);

  for (const b of prompt.boxes) {
    const x = (b.bbox.xMin / 1000) * w;
    const y = (b.bbox.yMin / 1000) * h;
    const bw = ((b.bbox.xMax - b.bbox.xMin) / 1000) * w;
    const bh = ((b.bbox.yMax - b.bbox.yMin) / 1000) * h;
    if (bw <= 0 || bh <= 0) continue;

    if (b.kind === "obj") {
      ctx.fillStyle = b.color || randColor();
      ctx.fillRect(x, y, bw, bh);
      ctx.lineWidth = thin;
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.strokeRect(x, y, bw, bh);
      const label = b.label?.trim();
      if (label) drawCenteredText(ctx, label, x, y, bw, bh, "#ffffff");
    } else {
      // Text box: dashed outline + the literal text.
      ctx.save();
      ctx.lineWidth = thin;
      ctx.strokeStyle = "rgba(0,0,0,0.55)";
      ctx.setLineDash([Math.max(3, bw * 0.03), Math.max(3, bw * 0.03)]);
      ctx.strokeRect(x, y, bw, bh);
      ctx.restore();
      const text = b.text?.trim() || "Text";
      drawCenteredText(ctx, text, x, y, bw, bh, "#111111");
    }
  }

  const blob = await canvasToBlob(canvas);
  return { blob, width: w, height: h };
}
