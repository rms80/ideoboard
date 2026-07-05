// ───────────────────────────────────────────────────────────────────────────
// Ideogram v4 send-time mapping. Our `StructuredPrompt` → Ideogram `V4JsonPrompt`,
// tag-expanding every text field first (pure). Nothing here is persisted.
// ───────────────────────────────────────────────────────────────────────────
import { resolveText } from "./tags";
import type {
  StructuredPrompt,
  PromptStyle,
  PromptBox,
  V4JsonPrompt,
  V4StyleDescription,
  V4Element,
  PromptTag,
} from "../types";

function expand(text: string | undefined, tags: PromptTag[]): string | undefined {
  if (text == null) return undefined;
  const out = resolveText(text, tags);
  return out.trim() === "" ? undefined : out;
}

function styleHasContent(s: PromptStyle | undefined): boolean {
  if (!s) return false;
  return Boolean(
    s.aesthetics ||
      s.lighting ||
      s.medium ||
      s.artStyle ||
      s.photo ||
      (s.colorPalette && s.colorPalette.length)
  );
}

function dropUndefined<T extends Record<string, unknown>>(obj: T): T {
  for (const k of Object.keys(obj)) {
    if (obj[k] === undefined) delete obj[k];
  }
  return obj;
}

/** Pure: build the Ideogram v4 json_prompt object from our structured prompt. */
export function promptToV4Json(prompt: StructuredPrompt): V4JsonPrompt {
  const tags = prompt.tags;

  const elements: V4Element[] = prompt.boxes.map((b) => {
    const el: V4Element = {
      type: b.kind,
      desc: resolveText(b.desc ?? "", tags),
      // Ideogram bbox order is [y_min, x_min, y_max, x_max], 0–1000.
      bbox: [
        Math.round(b.bbox.yMin),
        Math.round(b.bbox.xMin),
        Math.round(b.bbox.yMax),
        Math.round(b.bbox.xMax),
      ],
    };
    if (b.kind === "text" && b.text != null) el.text = resolveText(b.text, tags);
    return el;
  });

  const v4: V4JsonPrompt = {
    high_level_description: resolveText(prompt.highLevelDescription ?? "", tags),
  };

  if (styleHasContent(prompt.style)) {
    const s = prompt.style!;
    const style: V4StyleDescription = dropUndefined({
      aesthetics: expand(s.aesthetics, tags),
      lighting: expand(s.lighting, tags),
      medium: expand(s.medium, tags),
      art_style: expand(s.artStyle, tags),
      photo: expand(s.photo, tags),
      color_palette: s.colorPalette?.length
        ? s.colorPalette.map((c) => c.toUpperCase())
        : undefined,
    });
    v4.style_description = style;
  }

  // `background` is always emitted (Ideogram expects the field present), falling
  // back to an empty string when the prompt has no background text.
  const background = expand(prompt.background, tags);
  v4.compositional_deconstruction = { background: background ?? "", elements };

  return v4;
}

/** Build the multipart body sent to /api/generate (relayed to Ideogram). */
export function buildFormData(prompt: StructuredPrompt, enableCopyrightDetection = false): FormData {
  const fd = new FormData();
  // NOTE (Plan.md risk): json_prompt sent as a string field. If a live call rejects
  // this, try a Blob/file part instead.
  fd.append("json_prompt", JSON.stringify(promptToV4Json(prompt)));
  fd.append("resolution", prompt.resolution);
  fd.append("rendering_speed", prompt.renderingSpeed);
  if (enableCopyrightDetection) fd.append("enable_copyright_detection", "true");
  return fd;
}

export interface IdeogramImage {
  url: string;
  prompt?: string;
  resolution?: string;
  is_image_safe?: boolean;
  seed?: number;
}
export interface IdeogramResponse {
  created?: string;
  data: IdeogramImage[];
}

// ─── Describe (receive-time): guide image → our structured prompt ────────────
// The inverse direction of promptToV4Json. Ideogram's /describe returns a
// `json_prompt` in the same V4 shape we send to /generate; we map it back onto
// our StructuredPrompt fields so the guide image can seed a fresh node.

export interface DescribeResponse {
  json_prompt?: V4JsonPrompt;
}

/** Draft-ready fields parsed from a describe response. Boxes come WITHOUT ids
 *  (the caller assigns `newId()`), keeping this mapper pure. */
export interface DescribedPromptFields {
  highLevelDescription: string;
  background?: string;
  style?: PromptStyle;
  boxes: Omit<PromptBox, "id">[];
}

/** Clamp/round a bbox coordinate into Ideogram's 0–1000 normalized range. */
function clampCoord(n: number): number {
  return Math.max(0, Math.min(1000, Math.round(Number(n) || 0)));
}

/** Pure: map an Ideogram v4 json_prompt back onto our prompt fields + boxes. */
export function v4JsonToPromptFields(jp: V4JsonPrompt): DescribedPromptFields {
  const sd = jp.style_description;
  const style: PromptStyle | undefined = sd
    ? dropUndefined({
        aesthetics: sd.aesthetics,
        lighting: sd.lighting,
        medium: sd.medium,
        artStyle: sd.art_style,
        photo: sd.photo,
        colorPalette: sd.color_palette?.length ? sd.color_palette : undefined,
      })
    : undefined;

  const cd = jp.compositional_deconstruction;
  const boxes: Omit<PromptBox, "id">[] = (cd?.elements ?? []).map((el) => {
    // Ideogram bbox order is [y_min, x_min, y_max, x_max], 0–1000.
    const [y0, x0, y1, x1] = el.bbox ?? [0, 0, 0, 0];
    const xa = clampCoord(x0);
    const xb = clampCoord(x1);
    const ya = clampCoord(y0);
    const yb = clampCoord(y1);
    const box: Omit<PromptBox, "id"> = {
      kind: el.type === "text" ? "text" : "obj",
      desc: el.desc ?? "",
      bbox: {
        xMin: Math.min(xa, xb),
        yMin: Math.min(ya, yb),
        xMax: Math.max(xa, xb),
        yMax: Math.max(ya, yb),
      },
    };
    if (el.type === "text") box.text = el.text ?? "";
    return box;
  });

  return {
    highLevelDescription: jp.high_level_description ?? "",
    background: cd?.background,
    style: style && Object.keys(style).length ? style : undefined,
    boxes,
  };
}

/** POST the guide image to /api/describe (relayed to Ideogram); returns its
 *  json_prompt. Throws on error. Ideogram-only — Fal has no describe endpoint. */
export async function describeImage(imageFile: Blob, apiKey: string): Promise<V4JsonPrompt> {
  const fd = new FormData();
  const ext =
    imageFile.type === "image/jpeg" ? "jpg" : imageFile.type === "image/webp" ? "webp" : "png";
  fd.append("image_file", imageFile, `guide.${ext}`);
  fd.append("include_bbox", "true"); // keep bounding boxes so we can rebuild the boxes

  const res = await fetch("/api/describe", {
    method: "POST",
    headers: { "X-Api-Key": apiKey }, // do NOT set Content-Type — browser adds the boundary
    body: fd,
  });

  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Unexpected response from Ideogram: ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    const err = json as { error?: string; message?: string };
    throw new Error(err?.error || err?.message || `Describe failed (HTTP ${res.status})`);
  }
  const jp = (json as DescribeResponse).json_prompt;
  if (!jp) throw new Error("Ideogram describe response missing json_prompt.");
  return jp;
}

/** POST the prompt to the proxy; returns parsed Ideogram response. Throws on error. */
export async function generateImage(
  prompt: StructuredPrompt,
  apiKey: string,
  enableCopyrightDetection = false
): Promise<IdeogramResponse> {
  const res = await fetch("/api/generate", {
    method: "POST",
    headers: { "X-Api-Key": apiKey }, // do NOT set Content-Type — browser adds the boundary
    body: buildFormData(prompt, enableCopyrightDetection),
  });

  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Unexpected response from Ideogram: ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    const err = json as { error?: string; message?: string };
    throw new Error(err?.error || err?.message || `Generate failed (HTTP ${res.status})`);
  }
  const resp = json as IdeogramResponse;
  if (!resp || !Array.isArray(resp.data)) {
    throw new Error("Ideogram response missing data[].");
  }
  return resp;
}
