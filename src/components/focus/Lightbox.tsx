// ───────────────────────────────────────────────────────────────────────────
// Lightbox — modal fullscreen viewer for the current node's active result.
//
// Pan (drag) + zoom (wheel, anchored to the cursor) the single image. Escape or
// the top-right ✕ exits. For multi-result nodes a prev/next/index control shows
// bottom-left; ←/→ cycle this node's results, Shift+←/→ switch to the previous
// (parent) / next (primary child) node — all staying in the lightbox, keeping the
// current zoom/pan. While open it owns the keyboard (useKeyboardShortcuts bails on
// lightboxOpen).
// ───────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { useSceneStore } from "../../state/sceneStore";
import { useUiStore } from "../../state/uiStore";
import { useObjectUrl } from "../../hooks/useObjectUrl";

const MIN_SCALE = 1;
const MAX_SCALE = 8;
const IDENTITY = { scale: 1, tx: 0, ty: 0 };
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function Lightbox() {
  const open = useUiStore((s) => s.lightboxOpen);
  const close = useUiStore((s) => s.closeLightbox);
  const scene = useSceneStore((s) => s.scene);
  const setCurrentResultIndex = useSceneStore((s) => s.setCurrentResultIndex);

  const node = scene ? scene.nodes[scene.currentNodeId] : null;
  const count = node?.results.length ?? 0;
  const idx = node?.currentResultIndex ?? 0;
  const result = node && count ? node.results[idx] : undefined;
  const url = useObjectUrl(result?.imageId, "image");

  // Pan/zoom transform. A ref mirrors state so the (once-attached) wheel listener
  // and pointer handlers can read the latest values without re-subscribing.
  const [tf, setTf] = useState(IDENTITY);
  const tfRef = useRef(tf);
  tfRef.current = tf;
  const containerRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  // Reset the transform when the lightbox (re)opens — but NOT when cycling images,
  // so the current zoom/pan carries across left/right navigation.
  useEffect(() => setTf(IDENTITY), [open]);

  // Keyboard: Esc closes; ←/→ cycle this node's results (wrapping); Shift+←/→
  // switch to the previous (parent) / next (primary child) node. Read fresh store
  // state so there are no stale closures over node/idx/count.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      const dir = e.key === "ArrowLeft" ? -1 : 1;
      const s = useSceneStore.getState();
      const sc = s.scene;
      const n = sc ? sc.nodes[sc.currentNodeId] : null;
      if (!sc || !n) return;

      if (e.shiftKey) {
        // Prev = parent; next = earliest-created child (the primary continuation).
        const targetId =
          dir < 0
            ? n.parentId && sc.nodes[n.parentId]
              ? n.parentId
              : null
            : (Object.values(sc.nodes)
                .filter((c) => c.parentId === n.id)
                .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1))[0]?.id ??
              null);
        if (!targetId) return;
        // Only switch to a node that actually has an image — otherwise the lightbox
        // would go blank. Ignore the hotkey in that case.
        if (sc.nodes[targetId].results.length === 0) return;
        s.selectNode(targetId);
        return;
      }

      if (n.results.length <= 1) return;
      const len = n.results.length;
      s.setCurrentResultIndex(n.id, (n.currentResultIndex + dir + len) % len);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  // Wheel zoom anchored to the cursor (native non-passive listener so we can
  // preventDefault). transform-origin is the element center, so we work in
  // cursor-relative-to-center coordinates: screen = T + p·S, keep p fixed.
  useEffect(() => {
    if (!open) return;
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left - rect.width / 2;
      const cy = e.clientY - rect.top - rect.height / 2;
      const cur = tfRef.current;
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const scale = clamp(cur.scale * factor, MIN_SCALE, MAX_SCALE);
      if (scale === cur.scale) return;
      if (scale === 1) {
        setTf(IDENTITY);
        return;
      }
      const ratio = scale / cur.scale;
      setTf({ scale, tx: cx - (cx - cur.tx) * ratio, ty: cy - (cy - cur.ty) * ratio });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [open]);

  if (!open) return null;

  const cycle = (dir: number) => {
    if (!node || count <= 1) return;
    setCurrentResultIndex(node.id, (idx + dir + count) % count);
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    // Only pan when zoomed in; a fit image stays centered.
    if (e.button !== 0 || tfRef.current.scale <= 1) return;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, tx: tfRef.current.tx, ty: tfRef.current.ty };
    setDragging(true);
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    setTf((t) => ({ ...t, tx: d.tx + (e.clientX - d.x), ty: d.ty + (e.clientY - d.y) }));
  };
  const endDrag = () => {
    drag.current = null;
    setDragging(false);
  };

  return createPortal(
    <div
      ref={containerRef}
      className="fixed inset-0 z-[80] select-none overflow-hidden bg-black/90"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {url && (
        <img
          src={url}
          alt={result?.promptSnapshot.highLevelDescription || "result"}
          draggable={false}
          className="absolute inset-0 h-full w-full object-contain"
          style={{
            transform: `translate(${tf.tx}px, ${tf.ty}px) scale(${tf.scale})`,
            cursor: tf.scale > 1 ? (dragging ? "grabbing" : "grab") : "default",
            willChange: "transform",
          }}
        />
      )}

      {/* Close (large ✕, top-right) */}
      <button
        type="button"
        title="Close (Esc)"
        onClick={close}
        onPointerDown={(e) => e.stopPropagation()}
        className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-white/90 transition hover:bg-black/70 hover:text-white"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          className="h-6 w-6"
          aria-hidden="true"
        >
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>

      {/* Result cycler (bottom-left) for multi-result nodes */}
      {count > 1 && (
        <div
          className="absolute bottom-4 left-4 z-10 flex items-center gap-2 rounded-md bg-black/40 px-2 py-1 text-sm text-white/90"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            title="Previous result (←)"
            onClick={() => cycle(-1)}
            className="flex h-6 w-6 items-center justify-center rounded transition hover:bg-white/15"
          >
            ◀
          </button>
          <span className="min-w-12 text-center tabular-nums">
            {idx + 1} / {count}
          </span>
          <button
            type="button"
            title="Next result (→)"
            onClick={() => cycle(1)}
            className="flex h-6 w-6 items-center justify-center rounded transition hover:bg-white/15"
          >
            ▶
          </button>
        </div>
      )}
    </div>,
    document.body,
  );
}
