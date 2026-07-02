// ───────────────────────────────────────────────────────────────────────────
// Ideoboard data model — our own source-of-truth format.
//
// Scenes store THIS format, never Ideogram's wire payload. The Ideogram
// `V4JsonPrompt` is derived at send-time by the pure `promptToV4Json()`
// (services/ideogram.ts) and is never persisted. See Plan.md.
// ───────────────────────────────────────────────────────────────────────────

export type ID = string;

export type RenderingSpeed = "TURBO" | "DEFAULT" | "QUALITY";

export type BoxKind = "text" | "obj";

export interface PromptStyle {
  aesthetics?: string;
  lighting?: string;
  medium?: string;
  artStyle?: string;
  photo?: string;
  colorPalette?: string[]; // hex strings, uppercased on send (≤16)
}

/** A bounding box drawn over the image (spatial). Stored normalized 0–1000 per axis. */
export interface PromptBox {
  id: ID;
  kind: BoxKind; // "text" = typographic element, "obj" = visual object
  text?: string; // literal string (text kind only) — tag-expanded on send + shown in the box
  label?: string; // obj kind only — display-only name shown centered in the box (not sent)
  desc: string; // sub-prompt / typographic spec — tag-expanded on send
  bbox: { xMin: number; yMin: number; xMax: number; yMax: number }; // 0–1000
  color?: string;
}

/** Reusable named text fragment ("macro"); per-node, duplicated each step. */
export interface PromptTag {
  id: ID; // stable id for list ops / React keys
  name: string; // referenced as #name in any text field (stored WITHOUT the '#')
  body: string; // fragment text (may itself contain #refs → recursive)
}

export interface StructuredPrompt {
  highLevelDescription: string;
  background?: string;
  style?: PromptStyle;
  boxes: PromptBox[]; // spatial bounding boxes
  tags: PromptTag[]; // named reusable text fragments, per-node
  resolution: string; // Ideogram enum (see RESOLUTIONS)
  renderingSpeed: RenderingSpeed;
}

export interface GenerationResult {
  id: ID;
  imageId: ID; // -> images store (blob)
  thumbnailId?: ID; // -> thumbnails store (blob)
  seed?: number;
  resolution: string;
  isImageSafe?: boolean;
  promptSnapshot: StructuredPrompt; // exact (unexpanded) prompt that produced this image
  createdAt: number;
  sourceUrl?: string; // expiring Ideogram URL, kept for reference only
}

export interface GraphNode {
  id: ID;
  parentId: ID | null;
  prompt: StructuredPrompt; // node's committed prompt (incl. its own tags)
  results: GenerationResult[];
  currentResultIndex: number; // which result is "current"
  // Optional reference/guide image (-> images store) shown faintly behind the
  // prompt boxes to help compose a not-yet-generated node. Hidden once the node
  // has a generated result. Currently only settable by pasting from the clipboard.
  guideImageId?: ID;
  pos?: { x: number; y: number }; // cached layout (recomputed on structural change)
  createdAt: number;
  // Free-text label the user types to describe this node's result (status bar).
  // Personal annotation only — never expanded as #tags or sent to generation.
  // On spawn, inherited from the parent with a lineage marker appended (#2/#3…
  // for the primary continuation, A/B/C… for branches).
  note?: string;
}

export interface Scene {
  id: ID;
  name: string;
  createdAt: number;
  updatedAt: number;
  nodes: Record<ID, GraphNode>;
  rootId: ID;
  currentNodeId: ID;
  viewport?: { x: number; y: number; zoom: number };
  defaults: { resolution: string; renderingSpeed: RenderingSpeed };
  // Transient editor draft (uncommitted edits — drawn boxes, typed text, tags).
  // Persisted so in-progress work survives reload; not part of the committed graph
  // and overwritten on every save. `draftNodeId` records which node it derives
  // from so setScene only restores it when it still matches `currentNodeId`.
  draft?: StructuredPrompt;
  draftNodeId?: ID;
}

// ─── Ideogram v4 wire types (derived at send-time, never persisted) ──────────

export interface V4StyleDescription {
  aesthetics?: string;
  lighting?: string;
  medium?: string;
  art_style?: string;
  photo?: string;
  color_palette?: string[];
}

export interface V4Element {
  type: BoxKind; // "text" | "obj"
  text?: string; // text elements only
  desc: string;
  bbox?: [number, number, number, number]; // [y_min, x_min, y_max, x_max], 0–1000
}

export interface V4JsonPrompt {
  high_level_description: string;
  style_description?: V4StyleDescription;
  compositional_deconstruction?: {
    background?: string;
    elements: V4Element[];
  };
}

// ─── Enums / option lists ────────────────────────────────────────────────────
// NOTE (Plan.md risk): exact Ideogram v4 resolution/speed enum strings should be
// verified against a live call early in Milestone 3 and adjusted here if needed.

export const RENDERING_SPEEDS: RenderingSpeed[] = ["TURBO", "DEFAULT", "QUALITY"];

/** Supported Ideogram v4 resolutions ("WIDTHxHEIGHT"). */
export const RESOLUTIONS: string[] = [
  "2048x2048",
  "1440x2880",
  "2880x1440",
  "1664x2496",
  "2496x1664",
  "1792x2240",
  "2240x1792",
  "1440x2560",
  "2560x1440",
  "1600x2560",
  "2560x1600",
  "1728x2304",
  "2304x1728",
  "1296x3168",
  "3168x1296",
  "1152x2944",
  "2944x1152",
  "1248x3328",
  "3328x1248",
  "1280x3072",
  "3072x1280",
  "1024x3072",
  "3072x1024",
];

export const DEFAULT_RESOLUTION = "2048x2048";
export const DEFAULT_RENDERING_SPEED: RenderingSpeed = "DEFAULT";
