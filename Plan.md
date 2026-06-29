# Ideoboard — Structured-Prompt Image Generation on a Node Graph

## Context

We're building a **frontend-only web app** for *iterative* image generation with Ideogram v4. The
distinguishing idea is a **node-graph view that visualizes the iteration history** — nodes don't pass
data to each other, they record "every prompt change is a step; branching from any step starts a new
line." A second **focus view** zooms into one image where the user edits a **structured prompt**: a
base prompt, **bounding boxes** (two kinds — *text* boxes and *image/object* boxes) drawn over the
image, and a set of reusable **tag fragments** (named text macros) that can be referenced from any
prompt field to keep prompt construction DRY.

Everything (prompts, layout, results) is serializable to JSON+images and auto-saved to IndexedDB.
Multiple scenes are supported. The app is deployed as static assets plus a tiny serverless proxy.

This is a **greenfield project** — the working directory `/Users/ryanschmidt/git/ideoboard` is empty.

### Decisions locked with the user
- **API transport:** always go through a **minimal serverless proxy** (no direct browser→Ideogram calls).
- **Graph engine:** **React Flow** (`@xyflow/react`) for the graph; **custom DOM overlay** for focus/box editing.
- **Undo/redo:** built in **from the start** (store designed around a history middleware).
- **Prompt construction:** a **tag-fragment system** (named text macros, per-node) referenced from any field with `#` autocomplete; expanded only at send-time.
- **Testing:** **no automated tests** — the user verifies manually.
- **Dev server port:** **6868**.

### Key research findings — Ideogram v4 (drives the data model)
- **Endpoint:** `POST https://api.ideogram.ai/v1/ideogram-v4/generate`, **`multipart/form-data`**, auth header **`Api-Key`**.
- **Two prompt modes (mutually exclusive):** `text_prompt` (string, magic-prompt on) **or** `json_prompt` (a `V4JsonPrompt` object, magic-prompt off). We use **`json_prompt`** to get bounding boxes.
- **`V4JsonPrompt` shape** (the schema our model maps to):
  - `high_level_description: string`
  - `style_description: { aesthetics?, lighting?, medium: "photograph"|"graphic_design", art_style?, photo?, color_palette?: string[] }` — hex colors **UPPERCASE**, ≤16 global / ≤5 per element.
  - `compositional_deconstruction: { background?: string, elements: Element[] }`
  - `Element = { type: "text"|"obj", text?: string (text only), desc: string, bbox?: [y_min,x_min,y_max,x_max] }`
  - **bbox coords are 0–1000, origin top-left, `[y_min, x_min, y_max, x_max]`** (note: Y first).
- Other request params: `resolution` (enum, 24 values, all 2K, e.g. up to 3328×1248), `rendering_speed` (`TURBO`|`DEFAULT`|`QUALITY`, FLASH soon), `enable_copyright_detection`.
- **Response:** JSON `{ created, data: [{ url, prompt, resolution, is_image_safe, seed }] }`. **Image URLs expire** → we must download bytes immediately and store them. Example returns **2 images/request**.
- **Pricing/limits:** TURBO ~$0.03, DEFAULT ~$0.06, QUALITY ~$0.10 per image; default **10 in-flight requests** rate limit → generation service uses a small concurrency queue.

> Mapping: our **text box → `type:"text"`** (literal `text` + typographic `desc` + `bbox`); our **image box → `type:"obj"`** (visual `desc` + `bbox`). The node's base prompt → `high_level_description`; scene/node style fields → `style_description`; an optional background field → `background`. All text fields are tag-expanded first.

---

## Tech stack
- **Vite + React + TypeScript**.
- **@xyflow/react** (React Flow) — graph view, gives trackpad/multitouch pan+zoom, edges, minimap.
- **Zustand + zundo + immer** — state with undo/redo history; immer for ergonomic nested updates.
- **idb** (Jake Archibald) — thin IndexedDB wrapper.
- **fflate** — zip export/import of scene JSON + images.
- **Tailwind CSS v4** (`@tailwindcss/vite`) — fast, consistent dark theme (swappable for CSS modules).
- **TagField** — small custom tag-aware text input (`#` autocomplete + chips + tooltips). `react-mentions` is a fallback if the custom build proves fiddly.
- **No automated test framework** — per user preference, testing is done manually by the user. Pure logic (`layout.ts`, `promptToV4Json`, `resolveText`) is kept side-effect-free so it's testable later if desired, but no test harness is set up.
- **Dev server runs on port 6868** (set `server.port = 6868` in `vite.config.ts`).
- **Deploy:** static build + serverless functions. **Primary target: Vercel** (`/api/*` functions colocated with the static app, one-command deploy). Cloudflare Pages Functions is a drop-in alternative — proxy code is written framework-agnostic.

---

## Repository layout
```
ideoboard/
  api/                         # serverless proxy
    handlers.ts                #   framework-agnostic (Request→Response) impl — single source of truth
    generate.ts                #   thin Vercel wrapper → handlers.generate (POST, relays to Ideogram)
    image.ts                   #   thin Vercel wrapper → handlers.image (GET ?url=, streams w/ CORS)
  vite-dev-api.ts              # Vite plugin mounting api/handlers.ts at /api/* in the dev server
  src/
    main.tsx, App.tsx
    types/                     # Scene, Node, StructuredPrompt, PromptBox, PromptTag, GenerationResult …
    state/
      sceneStore.ts            # current scene graph (history-tracked via zundo)
      scenesStore.ts           # scene list + currentSceneId (CRUD, not history-tracked)
      settingsStore.ts         # apiKey + defaults (persisted to localStorage)
      uiStore.ts               # viewMode, selection, typed clipboard (boxes|tags), modals (not history-tracked)
      generationStore.ts       # in-flight queue, per-node status
    services/
      ideogram.ts              # buildFormData(prompt), promptToV4Json(), call via /api/generate
      tags.ts                  # resolveText(text, tags) — recursive #tag expansion (PURE)
      images.ts                # download bytes via /api/image, store blob+thumbnail, object URLs
      db.ts                    # idb: scenes / images / thumbnails stores
      persistence.ts           # debounced autosave, load, export/import zip
      layout.ts                # computeLayout(nodes) → positions (PURE)
    components/
      AppShell.tsx, TopBar.tsx (scene dropdown, view toggle, settings, export/import)
      SettingsModal.tsx        # API key (password field) + default resolution/speed
      common/  TagField.tsx, ContextMenu.tsx   # tag input (#-autocomplete/chips/tooltips); right-click menu
      graph/  GraphView.tsx, GraphNode.tsx, GraphEdges (RF)
      focus/  FocusView.tsx, ImageStage.tsx, BoxLayer.tsx, BoxItem.tsx, BoxInspector.tsx,
              TagsPanel.tsx, PromptPanel.tsx, ResultCycler.tsx, Breadcrumb.tsx
    hooks/   useGestures.ts (wheel/pinch/pan), useKeyboardShortcuts.ts
    theme.css / tailwind setup
  vercel.json, package.json, tsconfig.json, vite.config.ts
```

---

## Data model (`src/types`)

**Source-of-truth principle:** scenes store **our own format** (`StructuredPrompt` / `PromptBox` /
`PromptTag`), *not* Ideogram's wire payload. The Ideogram `V4JsonPrompt` is **derived at send-time** by
the pure `promptToV4Json()` (`services/ideogram.ts`), which first tag-expands every text field via
`resolveText()`; the result is never persisted. This keeps our model free to carry fields Ideogram has
no concept of (tag fragments, box labels/names, notes/tags, locked/hidden flags, grouping, etc.) — the
mapper just ignores them — and isolates any future Ideogram schema change to that one function. Only
*result* metadata returned by Ideogram (`seed`, `resolution`, `isImageSafe`, expiring `sourceUrl`) is
stored, on `GenerationResult`.

```ts
type ID = string;

interface StructuredPrompt {
  highLevelDescription: string;
  background?: string;
  style?: { aesthetics?: string; lighting?: string;
            medium?: "photograph" | "graphic_design";
            artStyle?: string; photo?: string; colorPalette?: string[] }; // hex, uppercased on send
  boxes: PromptBox[];                 // bounding boxes drawn over the image (spatial)
  tags: PromptTag[];                  // named reusable text fragments (non-spatial), per-node
  resolution: string;                 // Ideogram enum
  renderingSpeed: "TURBO" | "DEFAULT" | "QUALITY";
}

interface PromptBox {                  // stored normalized 0–1000 per axis (matches Ideogram)
  id: ID;
  kind: "text" | "obj";               // text box vs image/object box
  text?: string;                      // literal string (text kind only) — tag-expanded on send
  desc: string;                       // sub-prompt / typographic spec — tag-expanded on send
  bbox: { xMin: number; yMin: number; xMax: number; yMax: number }; // 0–1000
  color?: string;
}

interface PromptTag {                  // reusable named text fragment ("macro"); per-node, duplicated each step
  id: ID;                             // stable id for list ops / React keys
  name: string;                       // referenced as #name in any text field (stored WITHOUT the '#')
  body: string;                       // fragment text (may itself contain #refs → recursive)
}

interface GenerationResult {
  id: ID;
  imageId: ID;                        // -> images store (blob); thumbnailId likewise
  thumbnailId?: ID;
  seed?: number; resolution: string; isImageSafe?: boolean;
  promptSnapshot: StructuredPrompt;   // exact (unexpanded) prompt that produced this image
  createdAt: number; sourceUrl?: string; // expiring URL kept for reference only
}

interface GraphNode {
  id: ID; parentId: ID | null;
  prompt: StructuredPrompt;           // node's committed prompt (incl. its own tags)
  results: GenerationResult[];
  currentResultIndex: number;         // which result is "current"
  pos?: { x: number; y: number };     // cached layout (recomputed on structural change)
  createdAt: number;
}

interface Scene {
  id: ID; name: string; createdAt: number; updatedAt: number;
  nodes: Record<ID, GraphNode>; rootId: ID; currentNodeId: ID;
  viewport?: { x: number; y: number; zoom: number };
  defaults: { resolution: string; renderingSpeed: StructuredPrompt["renderingSpeed"] };
}
```
**Persistence split:** image **blobs live in IndexedDB** keyed by `imageId`; the Scene JSON only stores `imageId`/`thumbnailId` references. Object URLs are created on load and revoked on unload.

---

## Proxy design (`api/`) — why "always proxy"
Secret-key image APIs typically omit CORS headers, and the returned image URLs live on a host we
don't control (also likely no CORS) — so the browser cannot read the JSON **or** the image bytes
directly. Two tiny stateless functions fix both:
- **`POST /api/generate`** — reads the user's key from a request header (e.g. `X-Api-Key`), forwards the multipart body to Ideogram with `Api-Key`, returns the JSON. **No server secret** — the key stays user-supplied (matches "user enters key in app"), so deploy needs zero env config.
- **`GET /api/image?url=<ideogram-url>`** — server-side fetch of the (expiring) image, streamed back with `Access-Control-Allow-Origin`, so the client can `fetch → blob → IndexedDB`. (URL allow-listed to Ideogram hosts to avoid an open proxy.)
- **Local dev (no Vercel/deploy needed):** the two handlers are framework-agnostic (`Request → Response`) in `api/handlers.ts`. A small Vite plugin (`vite-dev-api.ts`, via `configureServer` + `server.middlewares`) mounts them at `/api/*` **inside the dev server**, so `npm run dev` serves the app **and** the proxy together on `localhost:6868` in one process. `api/generate.ts` / `api/image.ts` are thin wrappers re-exporting the same handlers for Vercel. → Identical dev/prod behavior; deploy is only ever needed for a shared hosted URL.

---

## State, persistence, autosave
- **`sceneStore`** holds the working Scene and is wrapped with **zundo** so structural + prompt + box +
  tag edits are undoable (Cmd/Ctrl+Z / Shift+Z). **Exclude from history:** selection, viewport,
  in-flight status, image blobs (history stores references only). Undo groups: a box drag = one entry
  (commit on pointer-up), typing = debounced into one entry.
- **Autosave:** subscribe to `sceneStore`, **debounce ~600ms**, write the current Scene JSON to the
  `scenes` store. Image blobs are written **once at generation time**, not on every keystroke.
- **`db.ts`** object stores: `scenes` (keyed by sceneId), `images` (blob by imageId), `thumbnails`.
- **Export/import:** `fflate` zip = `scene.json` + `images/<id>.png`. Import rehydrates blobs into IndexedDB.
- **Settings** (`apiKey`, defaults) in **localStorage**; key shown via a `type="password"` field inside a
  `<form>` so the **browser's own password manager can offer to save it** (closest to "saved as a password";
  the web platform has no app-readable secret store, so localStorage is the storage of record — documented honestly in the Settings modal).

---

## Graph view (React Flow) + layout engine
- **`layout.ts` (pure):** columns by depth from root; **primary (first-child) chain stays
  on lane 0** going left→right; each **additional child = a branch placed on the nearest free lane
  "up"**, using per-lane occupied column-interval packing so subtrees never overlap. Fixed spacing
  (e.g. col ≈ 280px, lane ≈ 200px). Recomputed on structural change; positions cached in `node.pos`.
  Up = smaller Y (React Flow's Y grows downward).
- **`GraphView`:** RF with `nodesDraggable=false` (auto-layout), pan/zoom/minimap on. Custom
  **`GraphNode`** = current-result thumbnail + result count badge + "current node" highlight + status
  spinner/error. Edges = parent→child. Click selects; double-click opens that node in focus view.
- Multitouch pan/zoom comes from React Flow (trackpad pinch + two-finger pan handled).

## Focus view (custom box editor) — `focus/`
**Layout — two columns.** *Right:* **`ImageStage`** (the image, with `BoxLayer` overlay, `ResultCycler`,
Generate/Regenerate, `Breadcrumb`). *Left:* a vertical split — **top `PromptPanel`** (image-level fields)
and **bottom `TagsPanel`** (tag fragments).
- **`ImageStage` / `BoxLayer`:** current result (or empty state); `BoxItem`s mapped from 0–1000 bbox →
  displayed image rect (per-axis scaling for non-square, matching Ideogram).
- **Box interactions:** draw (drag on empty stage; tool toggle text vs obj), move, resize (8 handles),
  **select** (click; shift-click multi; marquee), **delete** (Del/Backspace), **copy/paste** (Cmd/Ctrl
  C/V) within a node and **across nodes** via the typed clipboard. Text vs object boxes visually distinct.
- **`BoxInspector`:** edits the selected box (`kind`, `text` (text kind), `desc`, `color` — all `TagField`),
  shown as a **popover anchored to the selected box** on the image, so the left column stays exactly as
  specified (PromptPanel over TagsPanel).
- **`PromptPanel`:** `highLevelDescription`, `background`, style fields (all `TagField`); plus
  `resolution` / `renderingSpeed`.
- **`TagsPanel`:** the tag-fragment list (see "Tag fragments system").
- **`ResultCycler`:** `◀ n / m ▶` cycles `currentResultIndex`; **Generate** + **Regenerate** buttons.
- **`Breadcrumb`:** path root→current; jump back to a prior node to branch.

### Tag interactions in the focus view
- **Drag a tag** (from `TagsPanel`) **onto** any prompt field **or** any bounding box → **appends
  `#name`** to that target (box drop appends to the box's `desc`). Native HTML5 DnD with a custom mime
  (`application/x-ideoboard-tag`); drop targets highlight on drag-over; default text-insertion is
  prevented so we append cleanly (insert at the drop caret where feasible, else append at end).
- **Right-click selected text** in any prompt field → context menu **"Create tag from selection"**:
  creates a new `TagsPanel` item whose **body = the selected text**, prefilled as `#␣<selected text>`,
  focuses it, and places the caret **right after the `#`** so the user types the name. (Default: copies
  the selection; source field left unchanged. An "extract" variant that also replaces the selection with
  the new reference can be added later.)

## Tag fragments system (prompt macros)
Goal: factor repeated prompt text into named fragments and reference them anywhere, so editing one
fragment updates every place it's used.
- **Model:** `StructuredPrompt.tags: PromptTag[]` = `{ id, name, body }`. Tags are **per-node
  ("per-image")**; since a new node is a deep copy of the draft prompt, tags are **automatically
  duplicated at each step** and then edited independently per node.
- **Authoring (`TagsPanel`):** a list view in the focus view. Each item is an editable text box;
  **the first `#token` is the tag name, the remainder is the body** — e.g.
  `#colors1 bright orange with red highlights` → `{name:"colors1", body:"bright orange with red highlights"}`
  (name stored without the `#`; `id` stays stable across edits). "Add tag" button. Items support
  **multi-select, copy, paste, delete** (keyboard + buttons) via the typed clipboard; paste works
  across nodes too.
- **Referencing (`TagField`):** one reusable tag-aware input used by **all** free-text prompt fields
  (highLevelDescription, background, style.*, box `desc`, box `text`). Features:
  - **Autocomplete:** typing `#` opens a dropdown of the current node's tags filtered by the typed
    prefix; arrow keys navigate, **Tab/Enter completes**, Esc dismisses.
  - **Hover tooltip:** `#name` tokens render as inline chips; hovering shows the resolved body (and
    visibly flags undefined tags).
  - Edits/stores **plain text** containing `#name` tokens — chips are purely a render concern, keeping
    the data model simple. Built as a small contenteditable token-field (fallback: `react-mentions`).
- **Resolution / expansion:** pure `resolveText(text, tags)` (`services/tags.ts`) expands `#name` → body
  at **send-time only**, inside `promptToV4Json()`. **Recursive with cycle detection** (a body may
  reference other tags) up to a small depth cap; **unknown `#tokens` are left literal** (so real
  hashtags survive unless they collide with a tag name). Names expected unique per node; collisions
  show a warning. Stored scenes keep references **unexpanded** — consistent with the source-of-truth principle.

## Generation flow (regenerate vs. new node)
The focus editor edits a **draft** of the current node's prompt. On action:
- **Generate (primary):**
  - current node has **0 results** → fill *this* node (its first result) using the draft.
  - current node has results **and draft changed** → create a **new child node** (deep copy of the draft, incl. tags) and generate its first result; select it (this is how "every update = a new node" and branching happen).
  - current node has results **and draft unchanged** → behaves like Regenerate.
- **Regenerate:** append another result to the **current** node using its **committed** prompt (new seed); user cycles results.
- **`generationStore`** runs a **concurrency-limited queue (≤10 in-flight)**, tracks per-node
  status (idle/generating/error), supports the API returning multiple images (each becomes a result).
  On success: `images.ts` downloads bytes via `/api/image`, stores blob + generated thumbnail, appends
  `GenerationResult`. Errors surface inline with retry.

## Gestures, keyboard, theme
- **`useGestures`:** wheel with `ctrlKey` = zoom (Mac trackpad pinch), wheel deltas = pan; pointer
  events for 2-finger touch — used by focus stage (graph relies on React Flow).
- **`useKeyboardShortcuts`:** Cmd/Ctrl+Z / Shift+Z undo/redo, C/V copy-paste (boxes or tags by context),
  Del delete, toggle Graph/Focus, Enter = Generate, arrows = cycle results / nudge selected box.
- **Dark theme** via Tailwind config + CSS variables (neutral-900 surfaces, accent for current node/selection).

---

## Milestones (incremental, each independently runnable)
1. **Scaffold** — Vite+React+TS, Tailwind dark shell, deps, `api/handlers` + `generate`/`image`, `vite-dev-api` plugin (port 6868), Settings modal (API key + defaults).
2. **Data model + persistence** — types, `db.ts`, `sceneStore` (zundo) + `scenesStore`, debounced autosave, multi-scene dropdown (create/rename/switch/delete).
3. **Generation core** — `ideogram.ts` (`promptToV4Json`, multipart), `generationStore` queue, `images.ts` storage; minimal focus view: base prompt + resolution/speed + Generate/Regenerate + result cycling (linear node chain; plain text fields, no tags/boxes yet).
4. **Tag fragments + focus layout** — two-column focus view (image right; PromptPanel over TagsPanel left); `services/tags.ts` (`resolveText`, recursive + cycle-safe), `TagsPanel` (list CRUD + select/copy/paste/delete), `TagField` (#-autocomplete, Tab-complete, chips, hover tooltips); retrofit all prompt fields to `TagField`; **drag-a-tag-onto-field/box** to append `#name`; right-click **"Create tag from selection"** (`ContextMenu`); wire `resolveText` into `promptToV4Json`.
5. **Structured boxes** — `BoxLayer`/`BoxItem`/`BoxInspector`: draw/select/move/resize/delete/copy-paste, text vs obj, box `desc`/`text` use `TagField`, wired into `promptToV4Json` (`elements[]` + `bbox`).
6. **Graph view + branching** — `layout.ts`, React Flow `GraphView`/`GraphNode`/edges, branch-up layout, view toggle + double-click navigation + breadcrumb, cross-node box/tag paste.
7. **Polish** — multitouch tuning, undo grouping refinement, zip export/import, thumbnails for graph perf, error/rate-limit UX, empty states.

---

## Verification (user-driven — no automated tests)
The user verifies manually. Dev server runs at **http://localhost:6868** (`npm run dev`). Suggested
manual e2e pass after each milestone:
- Enter API key → type base prompt → **Generate** (image appears, stored, **survives reload**).
- **Regenerate** → cycle multiple results `◀ n/m ▶`.
- Define a tag in `TagsPanel` (`#colors1 ...`), reference `#colors1` in the base prompt (autocomplete +
  Tab-complete), hover the chip (tooltip shows body) → Generate (output reflects the expanded text).
- **Drag a tag** onto a prompt field and onto a bounding box (each appends `#name`); select text in a
  field, **right-click → "Create tag from selection"** (new item appears named-ready, caret after `#`).
- Draw a **text box** + an **image box**, edit sub-prompts (with tags) → Generate (new child node; boxes reflected).
- Open **graph view**, branch from an earlier node (new line goes **up**), **trackpad pinch/two-finger pan**.
- **Copy** a box and a tag, switch nodes, **paste** each; **Delete**; **undo/redo** a tag edit, a box edit, a node creation.
- Create a **2nd scene**, switch between them; **export zip**, clear site data, **import zip** (scene + images restored).
- **Deploy smoke test:** `vercel` deploy; confirm `/api/generate` relays and `/api/image` streams bytes
  with CORS in production (the path direct browser calls cannot take).

## Notes / risks to confirm during build
- Exact Ideogram `resolution`/`rendering_speed` enum strings and the precise `multipart` field name for
  `json_prompt` (string vs file part) — verify against a live call early in Milestone 3 and adjust `ideogram.ts`.
- "Image box" = a region *described in words* (Ideogram v4 generate has no per-region reference-image
  upload). If you later want to drop a real reference image into a box, that's a different
  endpoint (remix/inpaint) and a follow-up.
- `TagField` (contenteditable with chips + caret-anchored autocomplete + per-token hover) is the most
  finicky UI piece — `react-mentions` is the fallback if the custom build gets too heavy.
