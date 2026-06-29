// ───────────────────────────────────────────────────────────────────────────
// Box color palette. The ONLY colors we support for now; the actual hex value is
// stored on the box (not an index) so swapping in custom colors later won't break
// existing scenes. Shared by the BoxPanel swatch picker and the BoxItem render so
// a box's "default" (no explicit color) maps to a real swatch and is always one
// of the selectable options.
// ───────────────────────────────────────────────────────────────────────────
import type { BoxKind } from "../../types";

export const SWATCHES = [
  "#ef4444", // red
  "#f97316", // orange
  "#eab308", // yellow
  "#22c55e", // green
  "#14b8a6", // teal
  "#3b82f6", // blue
  "#6366f1", // indigo
  "#a855f7", // purple
  "#ec4899", // pink
  "#e8e8ea", // light
];

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Nearest palette swatch (Euclidean RGB distance) to an arbitrary hex color. */
export function nearestSwatch(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  let best = SWATCHES[0];
  let bestD = Infinity;
  for (const s of SWATCHES) {
    const [sr, sg, sb] = hexToRgb(s);
    const d = (r - sr) ** 2 + (g - sg) ** 2 + (b - sb) ** 2;
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

// Prior visual defaults (accent for text, ink for object) snapped to their nearest
// swatch, so a box with no explicit color still resolves to a palette color (and
// thus always has one swatch selected in the picker).
export const DEFAULT_BOX_COLOR: Record<BoxKind, string> = {
  text: nearestSwatch("#6d8cff"), // --color-accent
  obj: nearestSwatch("#e8e8ea"), // --color-ink
};

/** The color a box renders / selects with: its explicit color, else the kind default. */
export function effectiveBoxColor(box: { kind: BoxKind; color?: string }): string {
  return box.color ?? DEFAULT_BOX_COLOR[box.kind];
}
