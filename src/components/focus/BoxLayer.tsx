// ───────────────────────────────────────────────────────────────────────────
// BoxLayer — the canvas overlay for the focus image. Its pointer surface spans
// the ENTIRE middle viewport (the ImageStage container), but box coordinates map
// to the rendered image rect: the boxes/preview render inside an inner element
// sized/positioned to `imageBox` (the centered image), and pointer positions are
// normalized against that inner rect:
//   nx = ((clientX - imageRect.left) / imageRect.width) * 1000   (NOT clamped —
//   the letterbox area is part of the canvas, so values can go <0 or >1000).
//
// Modeless interaction (no tool palette) — BoxItems are non-interactive, so this
// overlay receives every pointer event and hit-tests:
//   • hover a border / a selected box's interior → grab cursor (move affordance).
//   • click (no drag)            → select the box under the cursor (border first,
//                                  then containment); empty / letterbox → clear.
//   • drag FROM a border, or inside a selected box → move (the whole selection).
//   • drag on a resize handle    → resize that box.
//   • drag inside the image      → draw a new box (obj by default; press `t` mid-
//                                  draw to toggle text/obj). Preview is orange.
//   • drag in the letterbox, or shift+drag → marquee-select (adds to selection);
//                                  the marquee may start/extend/end outside the image.
//   • drop a tag (#name)         → append it to the desc of the box under the cursor.
// Also: scoped keyboard (delete / copy / paste / arrow-nudge) — focus view only,
// never while editing a text field. The selected box is edited in BoxPanel.
// ───────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, DragEvent as ReactDragEvent, PointerEvent as ReactPointerEvent } from "react";
import type { BoxKind, ID, PromptBox } from "../../types";
import { useSceneStore, useCurrentNodeLocked } from "../../state/sceneStore";
import { useUiStore } from "../../state/uiStore";
import { newId } from "../../util/id";
import { clamp } from "../../util/misc";
import { BoxItem, BoxHandles, BoxLabel, HANDLES, type Edges } from "./BoxItem";

const EMPTY_BOXES: PromptBox[] = [];
const TAG_MIME = "application/x-ideoboard-tag";
/** Pointer travel (normalized) before a press becomes a drag rather than a click. */
const DRAG_START = 6;
/** A fresh draw must be at least this big (normalized) on both axes to count. */
const DRAW_MIN = 12;
/** Minimum box extent (normalized) preserved while resizing. */
const MIN_SIZE = 10;
/** Hit-test tolerances in CSS px (converted to normalized via the image rect). */
const BORDER_TOL_PX = 6;
const HANDLE_TOL_PX = 10;
/** New-box draw preview (semitransparent orange, object-style solid outline). */
const DRAW_BORDER = "rgba(249,115,22,0.95)";
const DRAW_FILL = "rgba(249,115,22,0.18)";
/** Black halo so the draw preview reads over busy images (matches BoxItem). */
const DRAW_HALO = "0 0 0 2px rgba(0,0,0,0.85), inset 0 0 0 2px rgba(0,0,0,0.85)";
/** Hover-highlight outline: a darker orange than the selection color, drawn on a
 *  top layer over whichever box a click would select. */
const HOVER_COLOR = "#c2410c";

type BBox = { xMin: number; yMin: number; xMax: number; yMax: number };

export interface BoxLayerProps {
  /** The rendered image rect within the container (px), or null until measured. */
  imageBox: { x: number; y: number; w: number; h: number } | null;
}

interface Gesture {
  rect: DOMRect;
  startNx: number;
  startNy: number;
  shift: boolean;
  alt: boolean; // alt/option held at press → a move-drag duplicates the selection
  outside: boolean; // press began outside the image (letterbox) → drag = marquee
  dragging: boolean;
  mode: "idle" | "move" | "draw" | "marquee" | "resize";
  boxHitId: ID | null; // box under the press (for click-select)
  moveHitId: ID | null; // box a drag would move (any border, or a selected box's interior)
  drawKind: BoxKind; // kind of the box being drawn (toggled by `t`)
  origBoxes: { id: ID; bbox: BBox }[]; // snapshot for move
  resizeId: ID | null;
  edges: Edges;
  resizeOrig: BBox | null;
}

function isEditable(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  if (!t) return false;
  return (
    t.tagName === "INPUT" ||
    t.tagName === "TEXTAREA" ||
    t.tagName === "SELECT" ||
    t.isContentEditable
  );
}

function rectStyle(aX: number, aY: number, bX: number, bY: number): CSSProperties {
  const xMin = Math.min(aX, bX);
  const yMin = Math.min(aY, bY);
  const xMax = Math.max(aX, bX);
  const yMax = Math.max(aY, bY);
  return {
    left: `${xMin / 10}%`,
    top: `${yMin / 10}%`,
    width: `${(xMax - xMin) / 10}%`,
    height: `${(yMax - yMin) / 10}%`,
  };
}

export function BoxLayer({ imageBox }: BoxLayerProps) {
  const boxes = useSceneStore((s) => s.draft?.boxes ?? EMPTY_BOXES);
  const addBox = useSceneStore((s) => s.addBox);
  const addBoxes = useSceneStore((s) => s.addBoxes);
  const updateBox = useSceneStore((s) => s.updateBox);
  const selectedBoxIds = useUiStore((s) => s.selectedBoxIds);
  const setSelectedBoxes = useUiStore((s) => s.setSelectedBoxes);
  const toggleBoxSelection = useUiStore((s) => s.toggleBoxSelection);
  const clearBoxSelection = useUiStore((s) => s.clearBoxSelection);
  const focusBoxField = useUiStore((s) => s.focusBoxField);
  const setPendingBox = useUiStore((s) => s.setPendingBox);
  const showPrompts = useUiStore((s) => s.showPrompts);
  const showImage = useUiStore((s) => s.showImage);
  // Locked nodes (already have an image) are read-only: selection/marquee still
  // work for inspection, but drawing / moving / resizing boxes is disabled.
  const locked = useCurrentNodeLocked();
  // A generated image is actually on screen beneath the boxes (locked ⇒ has a
  // result) → BoxItem drops its black halo so only the colored lines draw.
  const imageVisible = locked && showImage;

  const overlayRef = useRef<HTMLDivElement | null>(null); // container-filling pointer surface
  const imageRectRef = useRef<HTMLDivElement | null>(null); // sized to the image rect (coord space)
  const gesture = useRef<Gesture | null>(null);
  const [preview, setPreview] = useState<{ style: CSSProperties; kind: BoxKind | null } | null>(null);
  const [dropHoverId, setDropHoverId] = useState<ID | null>(null);
  // The box a click would currently select (topmost under the cursor); highlighted
  // on a top layer while hovering. Null during any active gesture / outside a box.
  const [hoverBoxId, setHoverBoxId] = useState<ID | null>(null);

  // Coordinate conversions use the IMAGE rect (the inner element), so 0–1000 maps to
  // the image even though the pointer surface is the whole viewport.
  const getRect = () => imageRectRef.current?.getBoundingClientRect() ?? null;
  const setCursor = (c: string) => {
    if (overlayRef.current) overlayRef.current.style.cursor = c;
  };

  // NOT clamped — the letterbox is canvas too (values may be <0 or >1000).
  const toNorm = (clientX: number, clientY: number, rect: DOMRect) => ({
    nx: ((clientX - rect.left) / rect.width) * 1000,
    ny: ((clientY - rect.top) / rect.height) * 1000,
  });
  const isOutside = (nx: number, ny: number) => nx < 0 || nx > 1000 || ny < 0 || ny > 1000;

  // ── Hit testing (topmost box wins → iterate render order in reverse) ─────────
  const hitHandle = (
    nx: number,
    ny: number,
    rect: DOMRect
  ): { id: ID; edges: Edges; cursor: string } | null => {
    if (!selectedBoxIds.length) return null;
    const tolX = (HANDLE_TOL_PX / rect.width) * 1000;
    const tolY = (HANDLE_TOL_PX / rect.height) * 1000;
    for (let i = boxes.length - 1; i >= 0; i--) {
      const b = boxes[i];
      if (!selectedBoxIds.includes(b.id)) continue;
      const w = b.bbox.xMax - b.bbox.xMin;
      const h = b.bbox.yMax - b.bbox.yMin;
      for (const handle of HANDLES) {
        const hx = b.bbox.xMin + (handle.x / 100) * w;
        const hy = b.bbox.yMin + (handle.y / 100) * h;
        if (Math.abs(nx - hx) <= tolX && Math.abs(ny - hy) <= tolY) {
          return { id: b.id, edges: handle.edges, cursor: handle.cursor };
        }
      }
    }
    return null;
  };

  // Border-only hit (the part that would also drive a move). Topmost first.
  const hitBorder = (nx: number, ny: number, rect: DOMRect): ID | null => {
    const tolX = (BORDER_TOL_PX / rect.width) * 1000;
    const tolY = (BORDER_TOL_PX / rect.height) * 1000;
    for (let i = boxes.length - 1; i >= 0; i--) {
      const b = boxes[i];
      const spanX = nx >= b.bbox.xMin - tolX && nx <= b.bbox.xMax + tolX;
      const spanY = ny >= b.bbox.yMin - tolY && ny <= b.bbox.yMax + tolY;
      const nearLeft = Math.abs(nx - b.bbox.xMin) <= tolX && spanY;
      const nearRight = Math.abs(nx - b.bbox.xMax) <= tolX && spanY;
      const nearTop = Math.abs(ny - b.bbox.yMin) <= tolY && spanX;
      const nearBottom = Math.abs(ny - b.bbox.yMax) <= tolY && spanX;
      if (nearLeft || nearRight || nearTop || nearBottom) return b.id;
    }
    return null;
  };

  // Select hit: a near-edge hit beats a box that merely contains the point.
  const hitBox = (nx: number, ny: number, rect: DOMRect): ID | null => {
    const border = hitBorder(nx, ny, rect);
    if (border) return border;
    for (let i = boxes.length - 1; i >= 0; i--) {
      const b = boxes[i];
      if (nx >= b.bbox.xMin && nx <= b.bbox.xMax && ny >= b.bbox.yMin && ny <= b.bbox.yMax)
        return b.id;
    }
    return null;
  };

  // ── Scoped keyboard (focus view, not while editing text) ────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // `t` toggles the kind of the box being actively drawn (works regardless of
      // focus, since a draw is in progress and gated tightly on the live gesture).
      const g = gesture.current;
      if ((e.key === "t" || e.key === "T") && g?.dragging && g.mode === "draw") {
        e.preventDefault();
        g.drawKind = g.drawKind === "text" ? "obj" : "text";
        setPreview((p) => (p ? { ...p, kind: g.drawKind } : p));
        return;
      }

      if (useUiStore.getState().viewMode !== "focus") return;
      if (isEditable(document.activeElement)) return;

      const ui = useUiStore.getState();
      const scene = useSceneStore.getState();
      const sel = ui.selectedBoxIds;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key;

      if (key === "Escape" && sel.length) {
        e.preventDefault();
        ui.clearBoxSelection();
        return;
      }

      // `e` / `d` focus the selected box's fields in the BoxPanel:
      //   e → primary entry (Text for a text box, Label for an object box)
      //   d → Description (either kind)
      if ((key === "e" || key === "d") && !mod && !e.altKey && !e.shiftKey && ui.inspectorBoxId) {
        e.preventDefault();
        ui.focusBoxField(key === "e" ? "primary" : "desc");
        return;
      }

      if ((key === "Delete" || key === "Backspace") && sel.length) {
        e.preventDefault();
        scene.removeBoxes(sel);
        ui.clearBoxSelection();
        return;
      }

      if (mod && key.toLowerCase() === "c" && sel.length) {
        e.preventDefault();
        const items = (scene.draft?.boxes ?? [])
          .filter((b) => sel.includes(b.id))
          .map((b) => structuredClone(b));
        ui.setClipboard({ kind: "boxes", items });
        return;
      }

      if (mod && key.toLowerCase() === "v") {
        const clip = ui.clipboard;
        if (clip?.kind === "boxes" && clip.items.length) {
          e.preventDefault();
          const pasted = clip.items.map((b) => {
            const nb = structuredClone(b);
            nb.id = newId();
            const w = nb.bbox.xMax - nb.bbox.xMin;
            const h = nb.bbox.yMax - nb.bbox.yMin;
            const nxMin = clamp(nb.bbox.xMin + 20, 0, 1000 - w);
            const nyMin = clamp(nb.bbox.yMin + 20, 0, 1000 - h);
            nb.bbox = { xMin: nxMin, yMin: nyMin, xMax: nxMin + w, yMax: nyMin + h };
            return nb;
          });
          scene.addBoxes(pasted);
          ui.setSelectedBoxes(pasted.map((b) => b.id));
        }
        return;
      }

      if (
        sel.length &&
        (key === "ArrowLeft" || key === "ArrowRight" || key === "ArrowUp" || key === "ArrowDown")
      ) {
        e.preventDefault();
        const step = e.shiftKey ? 20 : 5;
        const dx = key === "ArrowLeft" ? -step : key === "ArrowRight" ? step : 0;
        const dy = key === "ArrowUp" ? -step : key === "ArrowDown" ? step : 0;
        for (const id of sel) {
          scene.updateBox(id, (b) => {
            const w = b.bbox.xMax - b.bbox.xMin;
            const h = b.bbox.yMax - b.bbox.yMin;
            const nxMin = clamp(b.bbox.xMin + dx, 0, 1000 - w);
            const nyMin = clamp(b.bbox.yMin + dy, 0, 1000 - h);
            b.bbox = { xMin: nxMin, yMin: nyMin, xMax: nxMin + w, yMax: nyMin + h };
          });
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── Pointer gestures ─────────────────────────────────────────────────────────
  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    const rect = getRect();
    if (!rect) return;
    const { nx, ny } = toNorm(e.clientX, e.clientY, rect);
    const shift = e.shiftKey;
    const alt = e.altKey;
    const outside = isOutside(nx, ny);
    overlayRef.current?.setPointerCapture(e.pointerId);
    setPendingBox(null); // any new gesture cancels a just-drawn box's revert window

    // Resize handle takes precedence (selected box, never with shift / from
    // outside, never on a locked node).
    const rz = !shift && !outside && !locked ? hitHandle(nx, ny, rect) : null;
    if (rz) {
      const b = boxes.find((x) => x.id === rz.id);
      setCursor(rz.cursor);
      gesture.current = {
        rect,
        startNx: nx,
        startNy: ny,
        shift: false,
        alt: false,
        outside: false,
        dragging: false,
        mode: "resize",
        boxHitId: rz.id,
        moveHitId: null,
        drawKind: "obj",
        origBoxes: [],
        resizeId: rz.id,
        edges: rz.edges,
        resizeOrig: b ? { ...b.bbox } : null,
      };
      return;
    }

    // A drag moves a box if it starts on any border, or inside an already-selected
    // box; in the letterbox or with shift it marquees; otherwise it draws.
    const boxHitId = hitBox(nx, ny, rect);
    const moveHitId =
      shift || outside || locked
        ? null
        : (hitBorder(nx, ny, rect) ?? (boxHitId && selectedBoxIds.includes(boxHitId) ? boxHitId : null));
    gesture.current = {
      rect,
      startNx: nx,
      startNy: ny,
      shift,
      alt,
      outside,
      dragging: false,
      mode: "idle",
      boxHitId,
      moveHitId,
      drawKind: "obj",
      origBoxes: [],
      resizeId: null,
      edges: {},
      resizeOrig: null,
    };
  };

  const applyMove = (g: Gesture, nx: number, ny: number) => {
    let minDx = -Infinity;
    let maxDx = Infinity;
    let minDy = -Infinity;
    let maxDy = Infinity;
    for (const o of g.origBoxes) {
      minDx = Math.max(minDx, -o.bbox.xMin);
      maxDx = Math.min(maxDx, 1000 - o.bbox.xMax);
      minDy = Math.max(minDy, -o.bbox.yMin);
      maxDy = Math.min(maxDy, 1000 - o.bbox.yMax);
    }
    const dx = clamp(nx - g.startNx, minDx, maxDx);
    const dy = clamp(ny - g.startNy, minDy, maxDy);
    for (const o of g.origBoxes) {
      updateBox(o.id, (b) => {
        b.bbox = {
          xMin: o.bbox.xMin + dx,
          yMin: o.bbox.yMin + dy,
          xMax: o.bbox.xMax + dx,
          yMax: o.bbox.yMax + dy,
        };
      });
    }
  };

  const applyResize = (g: Gesture, nx: number, ny: number) => {
    const o = g.resizeOrig;
    if (!o || !g.resizeId) return;
    const dx = nx - g.startNx;
    const dy = ny - g.startNy;
    let xMin = o.xMin;
    let yMin = o.yMin;
    let xMax = o.xMax;
    let yMax = o.yMax;
    if (g.edges.left) xMin = clamp(o.xMin + dx, 0, o.xMax - MIN_SIZE);
    if (g.edges.right) xMax = clamp(o.xMax + dx, o.xMin + MIN_SIZE, 1000);
    if (g.edges.top) yMin = clamp(o.yMin + dy, 0, o.yMax - MIN_SIZE);
    if (g.edges.bottom) yMax = clamp(o.yMax + dy, o.yMin + MIN_SIZE, 1000);
    updateBox(g.resizeId, (b) => {
      b.bbox = { xMin, yMin, xMax, yMax };
    });
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const g = gesture.current;

    // No active gesture → hover affordance (grab on a border / selected interior)
    // plus the hover highlight over the box a click would select.
    if (!g) {
      const rect = getRect();
      if (!rect) return;
      const { nx, ny } = toNorm(e.clientX, e.clientY, rect);
      // Locked: no draw/move affordance — just show a selectable cursor over boxes.
      if (locked) {
        const id = hitBox(nx, ny, rect);
        setHoverBoxId(id);
        setCursor(id ? "pointer" : "default");
        return;
      }
      if (e.shiftKey || isOutside(nx, ny)) {
        setHoverBoxId(null);
        setCursor("crosshair");
        return;
      }
      const handle = hitHandle(nx, ny, rect);
      if (handle) {
        setHoverBoxId(null);
        setCursor(handle.cursor);
        return;
      }
      const boxId = hitBox(nx, ny, rect);
      setHoverBoxId(boxId);
      const movable = !!boxId && (hitBorder(nx, ny, rect) === boxId || selectedBoxIds.includes(boxId));
      setCursor(movable ? "grab" : "crosshair");
      return;
    }

    setHoverBoxId(null); // an active gesture (move/draw/resize/marquee) → no hover
    const { nx, ny } = toNorm(e.clientX, e.clientY, g.rect);

    if (!g.dragging) {
      if (Math.abs(nx - g.startNx) < DRAG_START && Math.abs(ny - g.startNy) < DRAG_START) return;
      g.dragging = true;
      if (g.mode !== "resize") {
        // Locked nodes can only marquee-select (no draw / move).
        g.mode = g.shift || g.outside || locked ? "marquee" : g.moveHitId ? "move" : "draw";
        if (g.mode === "move") {
          const hitId = g.moveHitId!;
          const inSel = selectedBoxIds.includes(hitId);
          const groupIds = inSel ? selectedBoxIds : [hitId];
          if (g.alt) {
            // Alt-drag: duplicate the group, select the copies, and drag those
            // (originals stay put). Copies start co-located, so the drag separates them.
            const dupes = boxes
              .filter((b) => groupIds.includes(b.id))
              .map((b) => ({ ...structuredClone(b), id: newId() }));
            addBoxes(dupes);
            setSelectedBoxes(dupes.map((d) => d.id));
            g.origBoxes = dupes.map((d) => ({ id: d.id, bbox: { ...d.bbox } }));
          } else {
            if (!inSel) setSelectedBoxes([hitId]);
            g.origBoxes = boxes
              .filter((b) => groupIds.includes(b.id))
              .map((b) => ({ id: b.id, bbox: { ...b.bbox } }));
          }
          setCursor("grabbing");
        } else if (g.mode === "draw") {
          g.drawKind = "obj";
        }
      }
    }

    if (g.mode === "move") applyMove(g, nx, ny);
    else if (g.mode === "resize") applyResize(g, nx, ny);
    else if (g.mode === "draw") {
      // New boxes live inside the image → clamp the preview to 0–1000.
      const sx = clamp(g.startNx, 0, 1000);
      const sy = clamp(g.startNy, 0, 1000);
      setPreview({ style: rectStyle(sx, sy, clamp(nx, 0, 1000), clamp(ny, 0, 1000)), kind: g.drawKind });
    } else if (g.mode === "marquee")
      // Marquee may spill into the letterbox (unclamped) — the inner rect doesn't clip.
      setPreview({ style: rectStyle(g.startNx, g.startNy, nx, ny), kind: null });
  };

  const onPointerUp = (e: ReactPointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    try {
      overlayRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* capture may already be gone */
    }
    const { nx, ny } = toNorm(e.clientX, e.clientY, g.rect);

    if (!g.dragging) {
      // Click: select via hit-test (handle-clicks do nothing). Empty / letterbox clears.
      if (g.mode !== "resize") {
        if (g.shift) {
          if (g.boxHitId) toggleBoxSelection(g.boxHitId, true);
        } else if (g.boxHitId) {
          setSelectedBoxes([g.boxHitId]);
        } else {
          clearBoxSelection();
        }
      }
    } else if (g.mode === "draw") {
      const sx = clamp(g.startNx, 0, 1000);
      const sy = clamp(g.startNy, 0, 1000);
      const ex = clamp(nx, 0, 1000);
      const ey = clamp(ny, 0, 1000);
      const xMin = Math.min(sx, ex);
      const yMin = Math.min(sy, ey);
      const xMax = Math.max(sx, ex);
      const yMax = Math.max(sy, ey);
      if (xMax - xMin >= DRAW_MIN && yMax - yMin >= DRAW_MIN) {
        const id = newId();
        const bbox = { xMin, yMin, xMax, yMax };
        addBox(
          g.drawKind === "text"
            ? { id, kind: "text", text: "", desc: "", bbox }
            : { id, kind: "obj", desc: "", bbox }
        );
        setSelectedBoxes([id]);
        setPendingBox(id);
        focusBoxField("draw");
      }
    } else if (g.mode === "marquee") {
      const xMin = Math.min(g.startNx, nx);
      const yMin = Math.min(g.startNy, ny);
      const xMax = Math.max(g.startNx, nx);
      const yMax = Math.max(g.startNy, ny);
      const hit = boxes
        .filter(
          (b) =>
            !(b.bbox.xMax < xMin || b.bbox.xMin > xMax || b.bbox.yMax < yMin || b.bbox.yMin > yMax)
        )
        .map((b) => b.id);
      setSelectedBoxes(Array.from(new Set([...selectedBoxIds, ...hit])));
    }
    // move / resize were applied live — nothing to finalize.

    gesture.current = null;
    setPreview(null);
    setCursor(locked ? "default" : "crosshair");
  };

  // ── Tag drop (drag a #tag from TagsPanel onto a box → append to its desc) ─────
  const onDragOver = (e: ReactDragEvent) => {
    if (!Array.from(e.dataTransfer.types).includes(TAG_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    const rect = getRect();
    if (!rect) return;
    const { nx, ny } = toNorm(e.clientX, e.clientY, rect);
    setDropHoverId(hitBox(nx, ny, rect));
  };

  const onDragLeave = () => setDropHoverId(null);

  const onDrop = (e: ReactDragEvent) => {
    const name = e.dataTransfer.getData(TAG_MIME);
    setDropHoverId(null);
    if (!name) return;
    e.preventDefault();
    const rect = getRect();
    if (!rect) return;
    const { nx, ny } = toNorm(e.clientX, e.clientY, rect);
    const id = hitBox(nx, ny, rect);
    if (id) updateBox(id, (b) => void (b.desc = (b.desc ? b.desc + " " : "") + "#" + name));
  };

  const hoverBox = hoverBoxId ? boxes.find((b) => b.id === hoverBoxId) : undefined;

  return (
    <div
      ref={overlayRef}
      style={{ touchAction: "none", cursor: locked || !showPrompts ? "default" : "crosshair" }}
      className="absolute inset-0"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => setHoverBoxId(null)}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {imageBox && showPrompts && (
        <div
          ref={imageRectRef}
          className="pointer-events-none absolute"
          style={{ left: imageBox.x, top: imageBox.y, width: imageBox.w, height: imageBox.h }}
        >
          {boxes.map((b) => (
            <BoxItem
              key={b.id}
              box={b}
              selected={selectedBoxIds.includes(b.id)}
              dropHover={dropHoverId === b.id}
              imageVisible={imageVisible}
            />
          ))}

          {/* Selected box's label on a top layer so an overlapping box can't clip
              it. Suppressed over a visible image (colored lines only). */}
          {!imageVisible &&
            boxes
              .filter((b) => selectedBoxIds.includes(b.id))
              .map((b) => (
                <BoxLabel key={`l-${b.id}`} box={b} />
              ))}

          {/* Resize grips on a top layer (above all boxes); not on locked nodes. */}
          {!locked &&
            boxes
              .filter((b) => selectedBoxIds.includes(b.id))
              .map((b) => <BoxHandles key={`h-${b.id}`} box={b} />)}

          {/* Hover highlight: a darker-orange duplicate of the box a click would
              select, drawn on top of every other box (matching its dash style). */}
          {hoverBox && (
            <div
              className={`pointer-events-none absolute border-2 ${
                hoverBox.kind === "text" ? "border-dashed" : "border-solid"
              }`}
              style={{
                left: `${hoverBox.bbox.xMin / 10}%`,
                top: `${hoverBox.bbox.yMin / 10}%`,
                width: `${(hoverBox.bbox.xMax - hoverBox.bbox.xMin) / 10}%`,
                height: `${(hoverBox.bbox.yMax - hoverBox.bbox.yMin) / 10}%`,
                borderColor: HOVER_COLOR,
              }}
            />
          )}

          {preview &&
            (preview.kind ? (
              <div
                style={{
                  ...preview.style,
                  borderColor: DRAW_BORDER,
                  backgroundColor: DRAW_FILL,
                  boxShadow: DRAW_HALO,
                }}
                className={`pointer-events-none absolute border-2 ${
                  preview.kind === "text" ? "border-dashed" : "border-solid"
                }`}
              />
            ) : (
              <div
                style={preview.style}
                className="pointer-events-none absolute border border-dashed border-accent/70 bg-accent/10"
              />
            ))}
        </div>
      )}
    </div>
  );
}
