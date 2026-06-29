// ───────────────────────────────────────────────────────────────────────────
// BoxLayer — the absolute overlay that exactly covers the rendered image rect
// (its parent wrapper in ImageStage). It is the 0–1000 normalized canvas:
//   • box → CSS %: left = xMin/10%, top = yMin/10%, width = (xMax-xMin)/10%, …
//     (per-axis %, so non-square images map correctly, matching Ideogram).
//   • pointer → normalized: nx = clamp((clientX - rect.left)/rect.width*1000, 0, 1000)
//     using the overlay's getBoundingClientRect (captured at gesture start).
//
// Responsibilities: render BoxItems, draw new boxes (text/obj tools), clear /
// marquee-select (select tool), host the BoxInspector, and scoped keyboard
// handling (delete / copy / paste / arrow-nudge) — focus view only, never while
// editing a text field.
// ───────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import type { PromptBox } from "../../types";
import { useSceneStore } from "../../state/sceneStore";
import { useUiStore } from "../../state/uiStore";
import { newId } from "../../util/id";
import { clamp } from "../../util/misc";
import { BoxItem } from "./BoxItem";
import { BoxInspector } from "./BoxInspector";

const EMPTY_BOXES: PromptBox[] = [];
/** A fresh draw must be at least this big (normalized) to count — ignores stray clicks. */
const DRAW_MIN = 20;
/** A marquee must drag at least this far to be a marquee rather than a click. */
const MARQUEE_MIN = 8;

interface DragState {
  mode: "draw" | "marquee";
  sx: number;
  sy: number;
  cx: number;
  cy: number;
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

export function BoxLayer() {
  const boxes = useSceneStore((s) => s.draft?.boxes ?? EMPTY_BOXES);
  const addBox = useSceneStore((s) => s.addBox);
  const boxTool = useUiStore((s) => s.boxTool);
  const setBoxTool = useUiStore((s) => s.setBoxTool);
  const selectedBoxIds = useUiStore((s) => s.selectedBoxIds);
  const inspectorBoxId = useUiStore((s) => s.inspectorBoxId);
  const setSelectedBoxes = useUiStore((s) => s.setSelectedBoxes);
  const clearBoxSelection = useUiStore((s) => s.clearBoxSelection);
  const setInspectorBox = useUiStore((s) => s.setInspectorBox);

  const overlayRef = useRef<HTMLDivElement | null>(null);
  const dragRect = useRef<DOMRect | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  const getRect = () => overlayRef.current?.getBoundingClientRect() ?? null;

  const toNorm = (clientX: number, clientY: number, rect: DOMRect) => ({
    nx: clamp(((clientX - rect.left) / rect.width) * 1000, 0, 1000),
    ny: clamp(((clientY - rect.top) / rect.height) * 1000, 0, 1000),
  });

  // ── Scoped keyboard (focus view, not while editing text) ────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useUiStore.getState().viewMode !== "focus") return;
      if (isEditable(document.activeElement)) return;

      const ui = useUiStore.getState();
      const scene = useSceneStore.getState();
      const sel = ui.selectedBoxIds;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key;

      if ((key === "Delete" || key === "Backspace") && sel.length) {
        e.preventDefault();
        scene.removeBoxes(sel);
        ui.clearBoxSelection();
        ui.setInspectorBox(null);
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

  // ── Empty-area pointer gestures: draw (text/obj) / marquee+clear (select) ────
  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    if (e.target !== overlayRef.current) return; // only the bare overlay, not a child
    const rect = getRect();
    if (!rect) return;
    dragRect.current = rect;
    const { nx, ny } = toNorm(e.clientX, e.clientY, rect);
    overlayRef.current?.setPointerCapture(e.pointerId);
    if (boxTool === "select") {
      setInspectorBox(null);
      setDrag({ mode: "marquee", sx: nx, sy: ny, cx: nx, cy: ny });
    } else {
      setDrag({ mode: "draw", sx: nx, sy: ny, cx: nx, cy: ny });
    }
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    if (!drag) return;
    const rect = dragRect.current;
    if (!rect) return;
    const { nx, ny } = toNorm(e.clientX, e.clientY, rect);
    setDrag((d) => (d ? { ...d, cx: nx, cy: ny } : d));
  };

  const onPointerUp = (e: ReactPointerEvent) => {
    if (!drag) return;
    try {
      overlayRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* capture may already be gone */
    }
    const xMin = Math.min(drag.sx, drag.cx);
    const yMin = Math.min(drag.sy, drag.cy);
    const xMax = Math.max(drag.sx, drag.cx);
    const yMax = Math.max(drag.sy, drag.cy);
    const w = xMax - xMin;
    const h = yMax - yMin;

    if (drag.mode === "draw") {
      if (w >= DRAW_MIN && h >= DRAW_MIN) {
        const kind = boxTool === "text" ? "text" : "obj";
        const id = newId();
        addBox({
          id,
          kind,
          desc: "",
          text: kind === "text" ? "" : undefined,
          bbox: { xMin, yMin, xMax, yMax },
          color: undefined,
        });
        setSelectedBoxes([id]);
        setInspectorBox(id);
        setBoxTool("select");
      }
    } else {
      // marquee: a real drag selects intersecting boxes; a click clears.
      if (w >= MARQUEE_MIN || h >= MARQUEE_MIN) {
        const hit = boxes
          .filter(
            (b) =>
              !(b.bbox.xMax < xMin || b.bbox.xMin > xMax || b.bbox.yMax < yMin || b.bbox.yMin > yMax)
          )
          .map((b) => b.id);
        setSelectedBoxes(hit);
      } else {
        clearBoxSelection();
        setInspectorBox(null);
      }
    }
    dragRect.current = null;
    setDrag(null);
  };

  const previewStyle = (): CSSProperties | null => {
    if (!drag) return null;
    const xMin = Math.min(drag.sx, drag.cx);
    const yMin = Math.min(drag.sy, drag.cy);
    const xMax = Math.max(drag.sx, drag.cx);
    const yMax = Math.max(drag.sy, drag.cy);
    return {
      left: `${xMin / 10}%`,
      top: `${yMin / 10}%`,
      width: `${(xMax - xMin) / 10}%`,
      height: `${(yMax - yMin) / 10}%`,
    };
  };

  const preview = previewStyle();

  return (
    <div
      ref={overlayRef}
      style={{ touchAction: "none" }}
      className={`absolute inset-0 ${boxTool === "select" ? "cursor-default" : "cursor-crosshair"}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {boxes.map((b) => (
        <BoxItem key={b.id} box={b} selected={selectedBoxIds.includes(b.id)} getRect={getRect} />
      ))}

      {preview && (
        <div
          style={preview}
          className={`pointer-events-none absolute border-2 ${
            drag?.mode === "draw"
              ? "border-dashed border-accent bg-accent-soft/30"
              : "border-accent/60 bg-accent/10"
          }`}
        />
      )}

      {inspectorBoxId && <BoxInspector />}
    </div>
  );
}
