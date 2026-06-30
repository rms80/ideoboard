import { useLayoutEffect, useRef, useState } from "react";
import { useSceneStore } from "../../state/sceneStore";
import { useGenerationStore } from "../../state/generationStore";
import { useUiStore } from "../../state/uiStore";
import { useObjectUrl } from "../../hooks/useObjectUrl";
import { Button } from "../common/ui";
import { BoxLayer } from "./BoxLayer";

/** Largest "WxH"-aspect rectangle that fits inside cw×ch (the contain fit, upscaled). */
function fitRect(
  resolution: string | undefined,
  cw: number,
  ch: number
): { width: number; height: number } | null {
  if (cw <= 0 || ch <= 0) return null;
  const [w, h] = (resolution ?? "").split("x").map(Number);
  const ar = Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? w / h : 1;
  const containerAr = cw / ch;
  const r = ar > containerAr ? { width: cw, height: cw / ar } : { width: ch * ar, height: ch };
  return { width: Math.round(r.width), height: Math.round(r.height) };
}

export function ImageStage() {
  const scene = useSceneStore((s) => s.scene);
  const resolution = useSceneStore((s) => s.draft?.resolution);
  const node = scene ? scene.nodes[scene.currentNodeId] : null;
  const result =
    node && node.results.length ? node.results[node.currentResultIndex] : undefined;
  const url = useObjectUrl(result?.imageId, "image");

  const status = useGenerationStore((s) => (node ? s.status[node.id] : undefined));
  const error = useGenerationStore((s) => (node ? s.errors[node.id] : undefined));
  const clearError = useGenerationStore((s) => s.clearError);
  const regenerate = useGenerationStore((s) => s.regenerate);
  const showImage = useUiStore((s) => s.showImage);
  const openLightbox = useUiStore((s) => s.openLightbox);

  // Measure the viewport so the image (and the box overlay) can fill it edge-to-edge
  // at the right aspect ratio. The wrapper is sized to the displayed image rect so
  // BoxLayer (inset-0) lines up exactly with the pixels.
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = fitRect(result?.resolution ?? resolution, size.w, size.h);
  // The image rect within the container (centered). BoxLayer's pointer surface spans
  // the whole container but maps coordinates to this rect.
  const imageBox = fit
    ? {
        x: Math.round((size.w - fit.width) / 2),
        y: Math.round((size.h - fit.height) / 2),
        w: fit.width,
        h: fit.height,
      }
    : null;

  // Magnify button flush against the image's top-right corner: top-aligned with
  // the image top, left edge touching the image's right edge (zero gap).
  const MAG = 20;
  const magnifyPos = imageBox ? { top: imageBox.y, left: imageBox.x + imageBox.w } : null;

  return (
    <div ref={containerRef} className="relative min-h-0 flex-1 overflow-hidden bg-surface-0">
      {imageBox && (
        <div
          className="absolute"
          style={{ left: imageBox.x, top: imageBox.y, width: imageBox.w, height: imageBox.h }}
        >
          {url && showImage ? (
            <img
              src={url}
              alt={result?.promptSnapshot.highLevelDescription || "result"}
              className="block h-full w-full select-none object-contain"
              draggable={false}
            />
          ) : (
            <div className="h-full w-full rounded border border-dashed border-border/50 bg-surface-0" />
          )}
        </div>
      )}
      {/* Magnify → open the fullscreen lightbox (only when a result image exists). */}
      {url && magnifyPos && (
        <button
          type="button"
          title="View fullscreen"
          onClick={() => openLightbox()}
          style={{ ...magnifyPos, height: MAG, width: MAG }}
          className="absolute z-20 flex items-center justify-center border border-border bg-surface-1/90 text-ink-dim transition hover:bg-surface-2 hover:text-ink"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-3 w-3"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
        </button>
      )}

      <BoxLayer imageBox={imageBox} />

      {status === "generating" && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="flex items-center gap-2 text-ink">
            <Spinner /> Generating…
          </div>
        </div>
      )}

      {status === "error" && node && (
        <div className="absolute inset-x-3 bottom-3 z-30 flex items-start gap-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-ink">
          <div className="flex-1">
            <div className="font-medium text-danger">Generation failed</div>
            <div className="text-ink-dim">{error}</div>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => clearError(node.id)}>
              Dismiss
            </Button>
            <Button
              variant="default"
              onClick={() => {
                clearError(node.id);
                regenerate(node.id);
              }}
            >
              Retry
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-ink-faint border-t-accent" />
  );
}
