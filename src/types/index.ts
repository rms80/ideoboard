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

export type Medium = "photograph" | "graphic_design";

export interface PromptStyle {
  aesthetics?: string;
  lighting?: string;
  medium?: Medium;
  artStyle?: string;
  photo?: string;
  colorPalette?: string[]; // hex strings, uppercased on send (≤16)
}

/** A bounding box drawn over the image (spatial). Stored normalized 0–1000 per axis. */
export interface PromptBox {
  id: ID;
  kind: BoxKind; // "text" = typographic element, "obj" = visual object
  text?: string; // literal string (text kind only) — tag-expanded on send
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
  pos?: { x: number; y: number }; // cached layout (recomputed on structural change)
  createdAt: number;
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
}

// ─── Ideogram v4 wire types (derived at send-time, never persisted) ──────────

export interface V4StyleDescription {
  aesthetics?: string;
  lighting?: string;
  medium?: Medium;
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

/** Representative Ideogram v4 resolutions ("WIDTHxHEIGHT"). Verify against API. */
export const RESOLUTIONS: string[] = [
  "1024x1024",
  "1280x1280",
  "1408x1408",
  "1024x1280",
  "1280x1024",
  "1024x1536",
  "1536x1024",
  "1152x1536",
  "1536x1152",
  "1248x2496",
  "2496x1248",
  "1344x768",
  "768x1344",
  "1536x640",
  "640x1536",
  "2048x1152",
  "1152x2048",
  "3328x1248",
  "1248x3328",
];

export const DEFAULT_RESOLUTION = "1024x1024";
export const DEFAULT_RENDERING_SPEED: RenderingSpeed = "DEFAULT";
