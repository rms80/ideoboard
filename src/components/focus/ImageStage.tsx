import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { GenerationResult } from "../../types";
import { useSceneStore } from "../../state/sceneStore";
import { useGenerationStore } from "../../state/generationStore";
import { useUiStore } from "../../state/uiStore";
import { clonePrompt } from "../../state/factory";
import { useObjectUrl } from "../../hooks/useObjectUrl";
import { promptToV4Json } from "../../services/ideogram";
import { getImage } from "../../services/db";
import { padToSquare, storeImageBlob, toPngBlob } from "../../services/images";
import { newId } from "../../util/id";
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
  const draft = useSceneStore((s) => s.draft);
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
  const { menu: ctxMenu, open: openCtx } = useContextMenu();

  // "Copied prompt" flash on the copy button (auto-clears).
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number | null>(null);
  useEffect(() => () => void (copiedTimer.current && clearTimeout(copiedTimer.current)), []);

  // The exact prompt we'd POST to Ideogram, as pretty JSON: the displayed image's
  // snapshot if there is one, otherwise the live draft (what Generate would send).
  const promptSource = result?.promptSnapshot ?? draft ?? node?.prompt ?? null;
  const buildPromptText = () =>
    promptSource ? JSON.stringify(promptToV4Json(promptSource), null, 2) : null;

  const copyPrompt = async () => {
    const text = buildPromptText();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard denied (e.g. insecure context) — silently no-op.
    }
  };

  const copyImage = async () => {
    if (!result) return;
    const blob = await getImage(result.imageId);
    if (!blob) return;
    try {
      const png = await toPngBlob(blob);
      if (!png) return;
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    } catch {
      // Clipboard image write denied / unsupported — no-op.
    }
  };

  const downloadImage = async () => {
    if (!result) return;
    const blob = await getImage(result.imageId);
    if (!blob) return;
    const ext = (blob.type.split("/")[1] || "png").replace("jpeg", "jpg");
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = `ideoboard-${result.id}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(href);
  };

  // Store an arbitrary image blob (uploaded / pasted) as a new result on the
  // current node. Non-square images are black-padded to square first, and the
  // first result freezes the prompt just like a real generation does.
  const importImageBlob = async (blob: Blob) => {
    const s0 = useSceneStore.getState();
    const scene0 = s0.scene;
    if (!scene0) return;
    const nodeId = scene0.currentNodeId;
    const target = scene0.nodes[nodeId];
    if (!target) return;

    const square = await padToSquare(blob);
    const stored = await storeImageBlob(square);

    if (target.results.length === 0) s0.commitDraftToCurrentNode();
    const snapPrompt = useSceneStore.getState().scene?.nodes[nodeId]?.prompt ?? target.prompt;
    const result: GenerationResult = {
      id: newId(),
      imageId: stored.imageId,
      thumbnailId: stored.thumbnailId,
      resolution: `${stored.width}x${stored.height}`,
      isImageSafe: true,
      promptSnapshot: clonePrompt(snapPrompt),
      createdAt: Date.now(),
    };
    s0.appendResult(nodeId, result);
  };

  const uploadImage = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) void importImageBlob(file);
    };
    input.click();
  };

  const pasteImage = async () => {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = item.types.find((t) => t.startsWith("image/"));
        if (type) {
          await importImageBlob(await item.getType(type));
          return;
        }
      }
    } catch {
      // Clipboard read denied or holds no image — no-op.
    }
  };

  const onContextMenu = (e: ReactMouseEvent) => {
    openCtx(e, [
      { label: "Upload image…", onSelect: () => uploadImage() },
      { label: "Paste image", onSelect: () => void pasteImage() },
      { label: "Copy prompt", onSelect: () => void copyPrompt(), disabled: !promptSource },
      { label: "Copy image", onSelect: () => void copyImage(), disabled: !url },
      { label: "Download image", onSelect: () => void downloadImage(), disabled: !url },
      { label: "View fullscreen", onSelect: () => openLightbox(), disabled: !url },
    ]);
  };

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

  // Tool buttons stacked flush against the image's top-right corner: top-aligned
  // with the image top, left edge touching the image's right edge (zero gap). The
  // copy button sits directly below the magnify button.
  const MAG = 20;
  const magnifyPos = imageBox ? { top: imageBox.y, left: imageBox.x + imageBox.w } : null;
  const copyPos = imageBox ? { top: imageBox.y + MAG, left: imageBox.x + imageBox.w } : null;
  const downloadPos = imageBox ? { top: imageBox.y + 2 * MAG, left: imageBox.x + imageBox.w } : null;

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
      {/* Copy the Ideogram prompt (json_prompt) for the current image to the clipboard. */}
      {url && copyPos && (
        <button
          type="button"
          title="Copy prompt"
          onClick={() => void copyPrompt()}
          style={{ ...copyPos, height: MAG, width: MAG }}
          className="absolute z-20 flex items-center justify-center border border-t-0 border-border bg-surface-1/90 text-ink-dim transition hover:bg-surface-2 hover:text-ink"
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
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        </button>
      )}
      {/* Download the current image (part of the same top-right toolbar, so it
          only shows — like magnify/copy — when a result image is present). */}
      {url && downloadPos && (
        <button
          type="button"
          title="Download image"
          onClick={() => void downloadImage()}
          style={{ ...downloadPos, height: MAG, width: MAG }}
          className="absolute z-20 flex items-center justify-center border border-t-0 border-border bg-surface-1/90 text-ink-dim transition hover:bg-surface-2 hover:text-ink"
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
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <path d="M7 10l5 5 5-5" />
            <path d="M12 15V3" />
          </svg>
        </button>
      )}
      {/* "copied prompt" flash, floated just left of the copy button. */}
      {copied && copyPos && (
        <div
          className="pointer-events-none absolute z-20 flex items-center whitespace-nowrap rounded border border-border bg-surface-1/95 px-1.5 text-[10px] text-ink-dim shadow"
          style={{ top: copyPos.top, height: MAG, right: size.w - copyPos.left + 4 }}
        >
          copied prompt
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
