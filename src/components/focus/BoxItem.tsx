// ───────────────────────────────────────────────────────────────────────────
// BoxItem — a single draggable / resizable bounding box rendered over the image.
//
// Coordinates are stored NORMALIZED 0–1000 per axis (origin top-left, matching
// Ideogram). The box maps to CSS percentages of the overlay (which exactly
// covers the rendered image rect): left = xMin/10%, width = (xMax-xMin)/10%, …
// Pointer math converts px → normalized via the overlay's bounding rect, captured
// once at gesture start (so a stale layout mid-drag can't skew the math).
// ───────────────────────────────────────────────────────────────────────────
import { useRef, useState } from "react";
import type { CSSProperties, DragEvent as ReactDragEvent, PointerEvent as ReactPointerEvent } from "react";
import type { PromptBox } from "../../types";
import { useSceneStore } from "../../state/sceneStore";
import { useUiStore } from "../../state/uiStore";
import { clamp } from "../../util/misc";

const TAG_MIME = "application/x-ideoboard-tag";
/** Minimum box extent (normalized) preserved while resizing. */
const MIN_SIZE = 10;

type Edges = { left?: boolean; right?: boolean; top?: boolean; bottom?: boolean };

interface Gesture {
  mode: "move" | "resize";
  edges?: Edges;
  rect: DOMRect;
  startNx: number;
  startNy: number;
  orig: { xMin: number; yMin: number; xMax: number; yMax: number };
}

// 8 resize handles: center position (% of box) + the edges each one drives.
const HANDLES: { id: string; x: number; y: number; cursor: string; edges: Edges }[] = [
  { id: "nw", x: 0, y: 0, cursor: "nwse-resize", edges: { left: true, top: true } },
  { id: "n", x: 50, y: 0, cursor: "ns-resize", edges: { top: true } },
  { id: "ne", x: 100, y: 0, cursor: "nesw-resize", edges: { right: true, top: true } },
  { id: "e", x: 100, y: 50, cursor: "ew-resize", edges: { right: true } },
  { id: "se", x: 100, y: 100, cursor: "nwse-resize", edges: { right: true, bottom: true } },
  { id: "s", x: 50, y: 100, cursor: "ns-resize", edges: { bottom: true } },
  { id: "sw", x: 0, y: 100, cursor: "nesw-resize", edges: { left: true, bottom: true } },
  { id: "w", x: 0, y: 50, cursor: "ew-resize", edges: { left: true } },
];

export interface BoxItemProps {
  box: PromptBox;
  selected: boolean;
  /** Returns the overlay's current bounding rect (the 0–1000 canvas in px). */
  getRect: () => DOMRect | null;
}

export function BoxItem({ box, selected, getRect }: BoxItemProps) {
  const updateBox = useSceneStore((s) => s.updateBox);
  const setSelectedBoxes = useUiStore((s) => s.setSelectedBoxes);
  const toggleBoxSelection = useUiStore((s) => s.toggleBoxSelection);
  const setInspectorBox = useUiStore((s) => s.setInspectorBox);

  const bodyRef = useRef<HTMLDivElement | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const [dropHover, setDropHover] = useState(false);

  const id = box.id;
  const { xMin, yMin, xMax, yMax } = box.bbox;

  const pointToNorm = (clientX: number, clientY: number, rect: DOMRect) => ({
    nx: ((clientX - rect.left) / rect.width) * 1000,
    ny: ((clientY - rect.top) / rect.height) * 1000,
  });

  const beginGesture = (e: ReactPointerEvent, mode: "move" | "resize", edges?: Edges) => {
    const rect = getRect();
    if (!rect) return;
    const { nx, ny } = pointToNorm(e.clientX, e.clientY, rect);
    gesture.current = { mode, edges, rect, startNx: nx, startNy: ny, orig: { ...box.bbox } };
    bodyRef.current?.setPointerCapture(e.pointerId);
  };

  const onBodyPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    // Stop the overlay from treating this as an empty-area draw/clear.
    e.stopPropagation();
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    if (additive) {
      toggleBoxSelection(id, true);
    } else {
      setSelectedBoxes([id]);
      setInspectorBox(id);
    }
    beginGesture(e, "move");
  };

  const onHandlePointerDown = (e: ReactPointerEvent, edges: Edges) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    setSelectedBoxes([id]);
    setInspectorBox(id);
    beginGesture(e, "resize", edges);
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    const { nx, ny } = pointToNorm(e.clientX, e.clientY, g.rect);
    const dx = nx - g.startNx;
    const dy = ny - g.startNy;
    if (g.mode === "move") {
      const w = g.orig.xMax - g.orig.xMin;
      const h = g.orig.yMax - g.orig.yMin;
      const nxMin = clamp(g.orig.xMin + dx, 0, 1000 - w);
      const nyMin = clamp(g.orig.yMin + dy, 0, 1000 - h);
      updateBox(id, (b) => {
        b.bbox = { xMin: nxMin, yMin: nyMin, xMax: nxMin + w, yMax: nyMin + h };
      });
    } else {
      const E = g.edges ?? {};
      let nXMin = g.orig.xMin;
      let nYMin = g.orig.yMin;
      let nXMax = g.orig.xMax;
      let nYMax = g.orig.yMax;
      // Each axis moves at most one edge → ordering stays valid (xMin<xMax).
      if (E.left) nXMin = clamp(g.orig.xMin + dx, 0, g.orig.xMax - MIN_SIZE);
      if (E.right) nXMax = clamp(g.orig.xMax + dx, g.orig.xMin + MIN_SIZE, 1000);
      if (E.top) nYMin = clamp(g.orig.yMin + dy, 0, g.orig.yMax - MIN_SIZE);
      if (E.bottom) nYMax = clamp(g.orig.yMax + dy, g.orig.yMin + MIN_SIZE, 1000);
      updateBox(id, (b) => {
        b.bbox = { xMin: nXMin, yMin: nYMin, xMax: nXMax, yMax: nYMax };
      });
    }
  };

  const onPointerUp = (e: ReactPointerEvent) => {
    if (!gesture.current) return;
    try {
      bodyRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* capture may already be gone */
    }
    gesture.current = null;
  };

  // ── Drag a tag onto the box → append "#name" to the box's desc ──────────────
  const onDragOver = (e: ReactDragEvent) => {
    if (Array.from(e.dataTransfer.types).includes(TAG_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setDropHover(true);
    }
  };
  const onDragLeave = () => setDropHover(false);
  const onDrop = (e: ReactDragEvent) => {
    const name = e.dataTransfer.getData(TAG_MIME);
    if (!name) return;
    e.preventDefault();
    e.stopPropagation();
    setDropHover(false);
    updateBox(id, (b) => {
      b.desc = (b.desc ? b.desc + " " : "") + "#" + name;
    });
  };

  const isText = box.kind === "text";
  const style: CSSProperties = {
    left: `${xMin / 10}%`,
    top: `${yMin / 10}%`,
    width: `${(xMax - xMin) / 10}%`,
    height: `${(yMax - yMin) / 10}%`,
    borderColor: box.color || undefined,
    touchAction: "none",
  };

  const baseBorder = box.color ? "" : isText ? "border-accent/80" : "border-ink/70";
  const stateRing = dropHover
    ? "ring-2 ring-accent bg-accent-soft/40"
    : selected
      ? "ring-2 ring-accent z-10 bg-accent/5"
      : "bg-accent/5";

  return (
    <div
      ref={bodyRef}
      data-boxitem={id}
      style={style}
      className={`absolute box-border cursor-move select-none border-2 ${
        isText ? "border-dashed" : "border-solid"
      } ${baseBorder} ${stateRing}`}
      onPointerDown={onBodyPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* Kind badge */}
      <span className="pointer-events-none absolute left-0 top-0 m-0.5 rounded bg-surface-2/90 px-1 text-[10px] font-semibold leading-tight text-ink">
        {isText ? "T" : "▦"}
      </span>

      {/* Resize handles (selected only) */}
      {selected &&
        HANDLES.map((h) => (
          <span
            key={h.id}
            onPointerDown={(e) => onHandlePointerDown(e, h.edges)}
            style={{
              left: `${h.x}%`,
              top: `${h.y}%`,
              transform: "translate(-50%, -50%)",
              cursor: h.cursor,
              touchAction: "none",
            }}
            className="absolute h-2.5 w-2.5 rounded-sm border border-surface-0 bg-accent"
          />
        ))}
    </div>
  );
}
