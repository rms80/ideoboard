// ───────────────────────────────────────────────────────────────────────────
// BoxItem — presentational render of a single bounding box over the image.
//
// Coordinates are stored NORMALIZED 0–1000 per axis (origin top-left, matching
// Ideogram). The box maps to CSS percentages of the overlay (which exactly
// covers the rendered image rect): left = xMin/10%, width = (xMax-xMin)/10%, …
//
// This component is intentionally NON-interactive (`pointer-events-none`): ALL
// gestures (select / move / draw / resize / marquee / tag-drop) are hit-tested
// and handled centrally by BoxLayer, which needs HANDLE geometry — exported here
// so rendering and hit-testing share one source of truth.
//
// Selection recolors the box's own border orange (no extra ring) and does NOT
// change its z-order. The resize grips are rendered separately (BoxHandles) on a
// top layer by BoxLayer, so they stay visible/grabbable even when the selected
// box sits beneath an overlapping one.
// ───────────────────────────────────────────────────────────────────────────
import type { CSSProperties } from "react";
import type { PromptBox } from "../../types";
import { effectiveBoxColor } from "./swatches";

export type Edges = { left?: boolean; right?: boolean; top?: boolean; bottom?: boolean };

// 8 resize handles: center position (% of box) + the edges each one drives. Used
// for hit-testing in BoxLayer; visual rendering lives in BoxHandles below.
export const HANDLES: { id: string; x: number; y: number; cursor: string; edges: Edges }[] = [
  { id: "nw", x: 0, y: 0, cursor: "nwse-resize", edges: { left: true, top: true } },
  { id: "n", x: 50, y: 0, cursor: "ns-resize", edges: { top: true } },
  { id: "ne", x: 100, y: 0, cursor: "nesw-resize", edges: { right: true, top: true } },
  { id: "e", x: 100, y: 50, cursor: "ew-resize", edges: { right: true } },
  { id: "se", x: 100, y: 100, cursor: "nwse-resize", edges: { right: true, bottom: true } },
  { id: "s", x: 50, y: 100, cursor: "ns-resize", edges: { bottom: true } },
  { id: "sw", x: 0, y: 100, cursor: "nesw-resize", edges: { left: true, bottom: true } },
  { id: "w", x: 0, y: 50, cursor: "ew-resize", edges: { left: true } },
];

/** Orange selection / active-edit color (matches the new-box draw preview). */
const SELECT_COLOR = "#f97316";

export interface BoxItemProps {
  box: PromptBox;
  selected: boolean;
  dropHover: boolean;
  /** True when a generated image shows beneath the boxes → draw only the colored
   *  z-order lines: drop the black halo and the inner text label. */
  imageVisible?: boolean;
}

export function BoxItem({ box, selected, dropHover, imageVisible }: BoxItemProps) {
  const { xMin, yMin, xMax, yMax } = box.bbox;
  const isText = box.kind === "text";
  // Text boxes show their literal text; object boxes show their (optional) label.
  const display = isText ? box.text : box.label;

  // A black halo flanking the colored outline (2px outside + 2px inside) keeps the
  // stacking order of overlapping boxes legible over a plain canvas; a tag-drop
  // target adds a transient accent ring on top of it. Over a visible image we drop
  // the halo entirely and keep only the colored line (and any drop ring).
  const dropRing = "0 0 0 4px var(--color-accent)";
  const boxShadow = imageVisible
    ? dropHover
      ? dropRing
      : undefined
    : "0 0 0 2px rgba(0,0,0,0.85), inset 0 0 0 2px rgba(0,0,0,0.85)" +
      (dropHover ? ", " + dropRing : "");

  // Selected → orange border; else the box's effective color (explicit, or the
  // kind default which is itself a palette swatch).
  const borderColor = selected ? SELECT_COLOR : effectiveBoxColor(box);

  const style: CSSProperties = {
    left: `${xMin / 10}%`,
    top: `${yMin / 10}%`,
    width: `${(xMax - xMin) / 10}%`,
    height: `${(yMax - yMin) / 10}%`,
    borderColor,
    boxShadow,
  };

  const stateBg = dropHover ? "bg-accent-soft/40" : "bg-accent/5";

  return (
    <div
      style={style}
      className={`pointer-events-none absolute box-border select-none ${
        // Selected boxes keep a 2px outline; unselected ones are 1px thinner.
        selected ? "border-2" : "border"
      } ${isText ? "border-dashed" : "border-solid"} ${stateBg}`}
    >
      {/* Centered text/label. For the SELECTED box this is rendered separately on a
          top layer (BoxLabel) so it can't be hidden behind an overlapping box.
          Over a visible image we suppress labels entirely (colored lines only). */}
      {!selected && !imageVisible && <LabelContent display={display} />}
    </div>
  );
}

/** Centered literal text (text box) / label (object box), clipped on overflow. */
function LabelContent({ display }: { display?: string }) {
  if (!display) return null;
  return (
    <div className="absolute inset-0 flex items-center justify-center overflow-hidden p-1">
      <span className="text-center text-[11px] font-medium leading-tight text-ink [overflow-wrap:anywhere] [text-shadow:0_1px_3px_rgba(0,0,0,0.9)]">
        {display}
      </span>
    </div>
  );
}

// The selected box's label, drawn on the top layer (above all boxes) so an
// overlapping box can't clip it. Positioned at the box rect like BoxHandles.
export function BoxLabel({ box }: { box: PromptBox }) {
  const { xMin, yMin, xMax, yMax } = box.bbox;
  const display = box.kind === "text" ? box.text : box.label;
  if (!display) return null;
  return (
    <div
      className="pointer-events-none absolute"
      style={{
        left: `${xMin / 10}%`,
        top: `${yMin / 10}%`,
        width: `${(xMax - xMin) / 10}%`,
        height: `${(yMax - yMin) / 10}%`,
      }}
    >
      <LabelContent display={display} />
    </div>
  );
}

// ── Resize grips ─────────────────────────────────────────────────────────────
// Rendered as thick orange line segments rather than dots: corners are L-brackets
// (two perpendicular arms), edge mid-points are a single straddling segment. Drawn
// on a top layer (see BoxLayer) so they sit above every box.
//
// Each L-bracket is necessarily two rectangles, so a per-rectangle outline would
// leave a seam where they meet. Instead we paint ALL the arms once in black,
// slightly grown on every side, then ALL of them again in orange at true size on
// top — the overlapping black rects merge into one outline and the overlapping
// orange rects merge into one fill, with no internal seams.
const HANDLE_COLOR = "#ffffff"; // grips are always white, independent of box color
const HANDLE_OUTLINE = "rgba(0,0,0,0.7)"; // dark border → legible on any image
const ARM = 12; // corner-bracket arm length (px)
const SEG = 16; // edge-segment length (px)
const THICK = 3; // line thickness (px)
const OFF = THICK / 2; // straddle the box outline so the grip is centered on it
const OUTLINE = 1; // border thickness (px) the black layer extends past the orange

// Base geometry of every arm/segment (the orange fill); the black border layer is
// this grown by OUTLINE on each side (see `grow`).
const HANDLE_BARS: CSSProperties[] = [
  // corner L-brackets (each corner = a horizontal arm + a vertical arm)
  { top: -OFF, left: -OFF, width: ARM, height: THICK },
  { top: -OFF, left: -OFF, width: THICK, height: ARM },
  { top: -OFF, right: -OFF, width: ARM, height: THICK },
  { top: -OFF, right: -OFF, width: THICK, height: ARM },
  { bottom: -OFF, right: -OFF, width: ARM, height: THICK },
  { bottom: -OFF, right: -OFF, width: THICK, height: ARM },
  { bottom: -OFF, left: -OFF, width: ARM, height: THICK },
  { bottom: -OFF, left: -OFF, width: THICK, height: ARM },
  // edge mid-point segments
  { top: -OFF, left: "50%", width: SEG, height: THICK, transform: "translateX(-50%)" },
  { bottom: -OFF, left: "50%", width: SEG, height: THICK, transform: "translateX(-50%)" },
  { left: -OFF, top: "50%", width: THICK, height: SEG, transform: "translateY(-50%)" },
  { right: -OFF, top: "50%", width: THICK, height: SEG, transform: "translateY(-50%)" },
];

/** Grow a bar by OUTLINE on every side (numeric offsets shift out; "50%" stays centered). */
function grow(s: CSSProperties): CSSProperties {
  const out: CSSProperties = { ...s };
  if (typeof s.top === "number") out.top = s.top - OUTLINE;
  if (typeof s.bottom === "number") out.bottom = s.bottom - OUTLINE;
  if (typeof s.left === "number") out.left = s.left - OUTLINE;
  if (typeof s.right === "number") out.right = s.right - OUTLINE;
  if (typeof s.width === "number") out.width = s.width + 2 * OUTLINE;
  if (typeof s.height === "number") out.height = s.height + 2 * OUTLINE;
  return out;
}

export function BoxHandles({ box }: { box: PromptBox }) {
  const { xMin, yMin, xMax, yMax } = box.bbox;
  return (
    <div
      className="pointer-events-none absolute"
      style={{
        left: `${xMin / 10}%`,
        top: `${yMin / 10}%`,
        width: `${(xMax - xMin) / 10}%`,
        height: `${(yMax - yMin) / 10}%`,
      }}
    >
      {/* black outline layer (grown), then orange fill layer on top (true size) */}
      {HANDLE_BARS.map((b, i) => (
        <span key={`o${i}`} style={{ position: "absolute", background: HANDLE_OUTLINE, ...grow(b) }} />
      ))}
      {HANDLE_BARS.map((b, i) => (
        <span key={`f${i}`} style={{ position: "absolute", background: HANDLE_COLOR, ...b }} />
      ))}
    </div>
  );
}
