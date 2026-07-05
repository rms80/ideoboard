import { useLayoutEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useSceneStore } from "../../state/sceneStore";
import { useGenerationStore } from "../../state/generationStore";
import { useUiStore } from "../../state/uiStore";
import { useImageActions } from "../../hooks/useImageActions";
import { Button } from "../common/ui";
import { useContextMenu } from "../common/ContextMenu";
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

  const { result, url, guideUrl, buildMenuItems } = useImageActions();

  const status = useGenerationStore((s) => (node ? s.status[node.id] : undefined));
  const error = useGenerationStore((s) => (node ? s.errors[node.id] : undefined));
  const clearError = useGenerationStore((s) => s.clearError);
  const regenerate = useGenerationStore((s) => s.regenerate);
  const showImage = useUiStore((s) => s.showImage);
  const showGuide = useUiStore((s) => s.showGuide);
  const describing = useUiStore((s) => s.describing);
  const describeError = useUiStore((s) => s.describeError);
  const setDescribeError = useUiStore((s) => s.setDescribeError);
  const { menu: ctxMenu, open: openCtx } = useContextMenu();

  const onContextMenu = (e: ReactMouseEvent) => openCtx(e, buildMenuItems());

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

  return (
    <div
      ref={containerRef}
      className="relative min-h-0 flex-1 overflow-hidden bg-surface-0"
      onContextMenu={onContextMenu}
    >
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
          ) : guideUrl && showGuide ? (
            // Guide image: a faint (30% opacity / 70% transparent) reference behind
            // the prompt boxes, shown only until this node has a generated result
            // (and only while the Guide toggle is on). A small corner label marks it
            // as the guide (not a result).
            <>
              <img
                src={guideUrl}
                alt="guide"
                className="block h-full w-full select-none object-contain opacity-[0.3]"
                draggable={false}
              />
              <span className="pointer-events-none absolute bottom-1.5 right-1.5 select-none rounded bg-black/40 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white/70">
                guide image
              </span>
            </>
          ) : (
            <div className="h-full w-full rounded border border-dashed border-border/50 bg-surface-0" />
          )}
        </div>
      )}
      <BoxLayer imageBox={imageBox} />

      {ctxMenu}

      {status === "generating" && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="flex items-center gap-2 text-ink">
            <Spinner /> Generating…
          </div>
        </div>
      )}

      {describing && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="flex items-center gap-2 text-ink">
            <Spinner /> Describing guide image…
          </div>
        </div>
      )}

      {describeError && (
        <div className="absolute inset-x-3 bottom-3 z-30 flex items-start gap-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-ink">
          <div className="flex-1">
            <div className="font-medium text-danger">Describe failed</div>
            <div className="text-ink-dim">{describeError}</div>
          </div>
          <Button variant="ghost" onClick={() => setDescribeError(null)}>
            Dismiss
          </Button>
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
