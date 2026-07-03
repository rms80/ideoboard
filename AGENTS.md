# AGENTS.md — Ideoboard

Guidance for AI coding agents (and humans) working in this repo. Read this before making changes.

> **Design doc:** `Plan.md` is the authoritative spec (data model, milestones, Ideogram research, risks). This file is the operational quick-reference. If the two disagree, the code wins — then reconcile the docs.

---

## What this is

A **frontend-only** web app for *iterative* image generation with **Ideogram v4**. Two views:

- **Graph view** — a React Flow node graph visualizing the **iteration history**. Nodes don't pass data; every prompt change is a step, and branching from any step starts a new line.
- **Focus view** — zoom into one image and edit a **structured prompt**: a base prompt, **bounding boxes** (text boxes + image/object boxes drawn over the image), and reusable **tag fragments** (named `#macros` referenced from any field).

Everything is serializable to JSON + images, auto-saved to IndexedDB, multi-scene, exportable as a zip. Calls go through a tiny serverless proxy (no direct browser→Ideogram).

---

## Commands

```bash
npm run dev        # Vite dev server + /api proxy, both on http://localhost:6868
npm run build      # tsc -b && vite build  (the real typecheck + bundle)
npm run typecheck  # tsc -b --noEmit
npm run preview    # serve the production build on 6868
```

- **Dev server port is 6868** (hard-pinned, `strictPort`). Run dev servers there.
- **No automated test framework** — the user verifies manually. Do **not** add Jest/Vitest/Playwright/etc. Pure logic (`tags.ts`, `layout.ts`, `ideogram.ts`) is kept side-effect-free so it *could* be tested later.
- After changes, the authoritative check is `npm run build` (esbuild/Vite does **not** type-check; `tsc -b` does).

---

## Tech stack

Vite + React 18 + TypeScript · **@xyflow/react** (React Flow) · **Zustand + zundo + immer** (state + undo/redo) · **idb** (IndexedDB) · **fflate** (zip) · **Tailwind v4** (`@tailwindcss/vite`, CSS-first config in `src/index.css`).

Deploy target: **Vercel** (static build + `api/*` edge functions). Cloudflare Pages Functions is a drop-in since the handlers are framework-agnostic.

---

## Repository layout

```
api/                  serverless proxy
  handlers.ts           framework-agnostic Request→Response (SINGLE SOURCE OF TRUTH)
  generate.ts           Vercel edge wrapper → handlers.generate
  image.ts              Vercel edge wrapper → handlers.image
vite-dev-api.ts       Vite plugin mounting api/handlers at /api/* in the dev server
src/
  types/index.ts        data model + Ideogram wire types + RESOLUTIONS/SPEEDS enums
  util/                 id.ts (newId), misc.ts (clamp, debounce)
  state/                Zustand stores (see "State" below) + factory.ts
  services/             db, images, ideogram, mockImage, tags, layout, persistence, exchange
  hooks/                useObjectUrl, useUndo, useKeyboardShortcuts, useImageActions
  components/
    AppShell, LeftBar, RightBar, SettingsModal
    common/             ui.tsx (primitives), TagField.tsx, ContextMenu.tsx,
                        AppTooltips.tsx (global fast title-tooltip)
    focus/              FocusView, ImageStage, BoxLayer, BoxItem, BoxPanel,
                        PromptPanel, TagsPanel, ResultCycler, StatusBar, Lightbox
    graph/              GraphView, GraphNode
```

---

## Architecture — the load-bearing ideas

### 1. Source-of-truth principle
Scenes store **our own format** (`StructuredPrompt` / `PromptBox` / `PromptTag`), **never** Ideogram's wire payload. The Ideogram `V4JsonPrompt` is **derived at send-time** by the pure `promptToV4Json()` in `services/ideogram.ts` and is **never persisted**. This isolates any Ideogram schema change to that one function. Only *result* metadata (`seed`, `resolution`, `isImageSafe`, expiring `sourceUrl`) is stored on `GenerationResult`.

### 2. The `draft` model (read this before touching the focus editor)
`sceneStore` holds `{ scene, draft }`. The focus editor edits **`draft`** — a working copy of the current node's prompt. `node.prompt` is the **committed** prompt that produced the node's results. Navigating to a node resets `draft` to a clone of that node's `prompt`. `draft` is **not** persisted (it's editor state).

### 3. Generation flow (`generationStore.generate()`)
- current node has **0 results** → commit draft into this node, fill its first result
- has results (prompt **locked**) → **append another result** (regenerate, new seed)

There is **no implicit branch-on-edit** — branching is explicit via the Edit/Branch button (`createChildFromDraft`). `Regenerate` always appends to the current node using its committed prompt. A concurrency-limited queue (**≤10 in-flight**, matches Ideogram's default rate limit) runs tasks; each returned image → `downloadAndStore()` → `GenerationResult`.

**Freeze → auto-advance.** A node **freezes** the moment its first result lands (the 0→1 transition, from generate *or* upload/paste). `appendResult` detects this and calls `advanceAfterFreeze(nodeId)`, which **auto-creates its editable continuation child in the background** (same committed prompt, inherited note) **without moving focus** — you keep looking at the image you just made; the child appears in the graph. Any **guide image is copied to the child** (fresh blob id → independent lifecycle) as a reference for the next prompt. In the focus view the right-hand button becomes **"Next"** (navigate to that empty child) instead of Branch until the child itself has an image.

**Testing mode:** when no `apiKey` is set, `runTask` does **not** error — it synthesizes a placeholder image locally via `services/mockImage.ts` (`renderMockImage`): random background, each obj box filled (its color or random) with its label drawn on top, each text box's literal text drawn centered, at the prompt's resolution. Lets the whole Generate/Regenerate/branch flow be exercised offline.

### 4. Undo/redo (zundo) — what is and isn't tracked
History tracks **content edits**: `draft` text/box/tag edits and **branch creation**. It does **not** track navigation, result appends, result-index, layout positions, or viewport — those go through the `withoutHistory()` helper (pauses the zundo temporal store). Rapid edits are grouped into one undo entry via a leading-throttle on `handleSet` (~350ms). When adding new mutations, decide deliberately: undoable → plain action; transient → wrap in `withoutHistory`.

### 5. Persistence
`sceneStore` blobs are **references only** (`imageId`/`thumbnailId`). Image **bytes live in IndexedDB** (`db.ts`: `scenes` / `images` / `thumbnails` stores). Autosave: `persistence.ts` subscribes to `sceneStore`, debounces ~600ms, writes scene JSON (image blobs written once at generation time). `viewport` lives in `uiStore` (not the tracked scene) and is merged into the scene only at save time. Settings persist to localStorage (zustand `persist`).

### 6. The proxy (why "always proxy")
Secret-key image APIs omit CORS and serve images from hosts we don't control. `POST /api/generate` relays the multipart body to Ideogram with the user's key (`X-Api-Key` request header → `Api-Key` upstream; **no server secret**). `GET /api/image?url=` server-fetches the expiring image and streams it back with CORS so the client can `fetch → blob → IndexedDB`. Dev and prod run the *same* `api/handlers.ts`.

### 7. Focus-view overlays, guide images & shared UI
- **Overlay toggles** (`uiStore`): `showImage` / `showPrompts` / `showGuide` (the pill-row under the image in `ResultCycler`). Image/Prompts are coupled ("never both off"); **`showGuide` is independent**. Render precedence in `ImageStage`: shown image wins → `url && showImage`, else `guideUrl && showGuide`, else placeholder.
- **Guide image** = a faint reference behind the prompt boxes (`node.guideImageId`, stored raw — no square-pad/thumbnail). It can exist on **any** node; it's only *drawn* when the result image is hidden, but its menu actions (copy/remove; paste only pre-generation) stay available whenever one exists. Copying a guide always **duplicates the blob under a new id** so lifecycles don't entangle.
- **`useImageActions`** hook is the single source for image-context actions (fullscreen/download/copy prompt/copy image/paste·upload image/guide ops) via `buildMenuItems()` — shared by the `ImageStage` right-click menu and the `StatusBar` ⋮ button so they never drift.
- **`ContextMenu`** supports `MenuSeparator` entries and per-item `tooltip`.
- **`AppTooltips`** (mounted once in `AppShell`): a global renderer that hijacks every `title` attribute to show a custom tooltip ~2× faster than the browser's fixed native delay. No per-component change needed — just set `title`.

---

## Store & service contracts (public surface)

**`sceneStore`** (`state/sceneStore.ts`) — `{ scene, draft }` + actions: `setScene`, `selectNode`, `editDraft(recipe)`, `setRenderingSpeed`, `addBox/addBoxes/updateBox/removeBoxes`, `moveBoxZ`, `discardDrawnBox`, `addTag/addTags/updateTag/removeTags`, `renameWorkingScene`, `commitDraftToCurrentNode`, `createChildFromDraft`, `advanceAfterFreeze` (see §3), `appendResult`, `setGuideImage`, `setCurrentResultIndex`, `setNodeNote`, `recomputeLayout`. Module fns: `currentNode(scene)`, `isDraftDirty()`, `undo()`, `redo()`. `useCurrentNodeLocked()` hook: a node's prompt is **locked** once it has ≥1 result. Undo state via `useUndoState()` hook.

**`scenesStore`** — `scenes[]`, `currentSceneId`, `refresh/createScene/switchScene/deleteScene/renameScene/exportCurrent/importZip`. Deleting a scene GCs orphan blobs (only those no other scene references).

**`generationStore`** — `status`/`errors`/`inflight` + `generate()`, `regenerate(nodeId?)`, `clearError(nodeId)`.

**`settingsStore`** (localStorage) — `apiKey`, `defaultResolution`, `defaultRenderingSpeed`, `enableCopyrightDetection`.

**`uiStore`** (transient) — `viewMode`, `settingsOpen`, overlay toggles `showImage/showPrompts/showGuide` (see §7), `lightboxOpen`, box/tag selection, `inspectorBoxId`, `focusBoxNonce`, `pendingBoxId` (just-drawn blank box → backspace/undo in its empty Description cancels it), typed `clipboard` (`{kind:"boxes"|"tags", items}`), `viewport`. Box interaction is modeless (no tool palette) — see `BoxLayer`. Its pointer surface spans the **whole middle viewport** (the letterbox around the image is canvas too); coordinates map to the image rect (passed in as `imageBox`) and are *not* clamped (letterbox → values <0 / >1000). Hover a border (or a selected box's interior) → grab cursor; drag **from a border, or inside a selected box,** moves; drag a handle resizes; drag inside the image (incl. an *unselected* box) draws (obj by default, press `t` mid-draw to toggle text/obj); **drag in the letterbox, or shift+drag, marquees** (may start/end outside the image); click selects (border→containment), click in empty/letterbox clears.

**Services** — `tags.ts`: `resolveText/extractTagRefs/parseTagLine/formatTagLine/isValidTagName/findUndefinedRefs` (all pure). `layout.ts`: `computeLayout(nodes, rootId)` (pure). `ideogram.ts`: `promptToV4Json/buildFormData/generateImage`. `images.ts`: `downloadAndStore/storeImageBlob/get*ObjectURL/revoke*`. `db.ts`: scene + blob CRUD. `exchange.ts`: `exportSceneZip/downloadSceneZip/importSceneZip`.

**`TagField`** (frozen prop contract — used by all free-text prompt fields and box fields; new props are **additive only**):
```ts
{ value, onChange, tags, multiline?, placeholder?, className?, ariaLabel?, disabled?,
  onDropTag?, expandable?, expandAnchor? /* "left" | "right" */ }
```
Stores **plain text** with `#name` tokens; chips/preview are render-only. Tag drag mime: `application/x-ideoboard-tag` (payload = bare name).

`expandable` makes focusing the field pop up a larger floating editor (portaled to `<body>`) that becomes the live editor while open — 2× wide, ≥8 lines, ≥ the source's height, grows 4 lines at a time on overflow, pinned to the source's top-left (or top-**right** for `expandAnchor="right"`, used by the right-hand panel). It shows the placeholder as a docked label tab and an "escape/tab to close" hint. All tag behaviour works inside it. Panels tag their fields (`data-fieldnav`) and wrap them in a `data-field-group`; **Tab / Shift-Tab cycles between a group's fields** instead of leaking into browser chrome.

---

## Conventions

- **TypeScript strict.** `isolatedModules` is on → use `import type` for type-only imports.
- **Coordinates:** boxes are stored normalized **0–1000 per axis**, `{xMin,yMin,xMax,yMax}`. Ideogram's `bbox` is `[y_min, x_min, y_max, x_max]` (**Y first**) — the conversion lives only in `promptToV4Json`.
- **Styling:** Tailwind v4 utilities + theme tokens defined in `src/index.css`: surfaces `bg-surface-0..3`, text `text-ink/ink-dim/ink-faint`, `border-border`, `text-accent/bg-accent/bg-accent-soft`, `text-danger/text-ok`. Reuse `components/common/ui.tsx` (`Button`, `IconButton`, `Field`, `inputClass`, `selectClass`).
- `newId()` for all ids. `Date.now()` is fine in app code.
- Keep `tags.ts`, `layout.ts`, `ideogram.ts` (the mapper) **pure**.

---

## Gotchas / unverified assumptions

These are **best-guess and may need adjusting on the first real Ideogram call** (each isolated to one place):

1. **`RESOLUTIONS` and `rendering_speed` enums** (`src/types/index.ts`) are guesses — fix the array if the API rejects a value.
2. **`json_prompt` is sent as a string multipart field** (`buildFormData` in `ideogram.ts`). If rejected, try a Blob/file part.
3. **`/api/image` host allow-list** (`api/handlers.ts` → `isAllowedImageHost`) covers `*.ideogram.ai`, `*.ideogramusercontent.com`, and common CDNs (amazonaws/cloudfront/googleapis). If image downloads 403, widen it.
4. "Image box" = a region *described in words* — Ideogram v4 `generate` has no per-region reference-image upload (that's a different endpoint, future work).

---

## Do / Don't

- ✅ Run dev on **6868**; verify with `npm run build`; keep the source-of-truth + draft invariants.
- ✅ When adding store mutations, classify them as undoable vs `withoutHistory`.
- ❌ Don't add a test framework. ❌ Don't make the browser call Ideogram directly (always via `/api`). ❌ Don't persist `draft` or the derived `V4JsonPrompt`. ❌ Don't store image bytes in scene JSON (references only).
