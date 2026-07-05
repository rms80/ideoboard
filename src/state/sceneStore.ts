// ───────────────────────────────────────────────────────────────────────────
// Working scene graph + undo/redo (zundo) + ergonomic nested edits (immer).
//
// The focus editor edits a `draft` (a working copy of the current node's prompt).
// On Generate, the generation flow compares draft↔committed to decide between
// filling the node, branching a child, or regenerating. `node.prompt` is the
// COMMITTED prompt that produced the node's results.
//
// History grouping: content edits (draft text/box/tag edits, branch creation) are
// undoable; navigation, result appends, result-index, layout, viewport are NOT
// (wrapped in `withoutHistory`). Rapid edits are grouped via a leading-throttle
// on `handleSet` so a burst of typing collapses into one undo entry.
// ───────────────────────────────────────────────────────────────────────────
import { create } from "zustand";
import { temporal } from "zundo";
import { immer } from "zustand/middleware/immer";
import type {
  ID,
  Scene,
  GraphNode,
  StructuredPrompt,
  PromptBox,
  PromptTag,
  GenerationResult,
  RenderingSpeed,
} from "../types";
import { createNode, clonePrompt } from "./factory";
import { computeLayout } from "../services/layout";
import { getImage, putImage } from "../services/db";
import { newId } from "../util/id";
import { useUiStore } from "./uiStore";

interface SceneData {
  scene: Scene | null;
  draft: StructuredPrompt | null;
}

interface SceneActions {
  /** Load a scene into the editor and reset undo history. */
  setScene: (scene: Scene | null) => void;
  /** Navigate to a node; resets the draft to a clone of its committed prompt. */
  selectNode: (nodeId: ID) => void;

  /** Mutate the draft via an immer recipe (undoable). */
  editDraft: (recipe: (p: StructuredPrompt) => void) => void;
  /** Set rendering speed on BOTH the draft and the committed current-node prompt,
   *  even when locked — speed is a generation parameter (used by the next
   *  Regenerate), not frozen prompt content. */
  setRenderingSpeed: (speed: RenderingSpeed) => void;

  // Box edits (operate on draft, undoable)
  addBox: (box: PromptBox) => void;
  addBoxes: (boxes: PromptBox[]) => void;
  updateBox: (id: ID, recipe: (b: PromptBox) => void) => void;
  removeBoxes: (ids: ID[]) => void;
  /** Shift a box in z-order. delta>0 → toward front (end of array / on top). */
  moveBoxZ: (id: ID, delta: number) => void;
  /** Move a box to an absolute z-order slot (index into the boxes array, where the
   *  last element is front-most / on top). Used by the Boxes list's drag-reorder. */
  moveBoxToIndex: (id: ID, toIndex: number) => void;
  /** Cancel a just-drawn box: remove it AND erase its creation from history (no redo). */
  discardDrawnBox: (id: ID) => void;

  // Tag edits (operate on draft, undoable)
  addTag: (tag: PromptTag) => void;
  addTags: (tags: PromptTag[]) => void;
  updateTag: (id: ID, recipe: (t: PromptTag) => void) => void;
  removeTags: (ids: ID[]) => void;
  /** Move a tag to an absolute slot (index into the tags array). Used by the Tags
   *  list's drag-reorder. */
  moveTagToIndex: (id: ID, toIndex: number) => void;

  renameWorkingScene: (name: string) => void;

  // Generation-flow ops (NOT undoable)
  commitDraftToCurrentNode: () => void;
  createChildFromDraft: () => ID | null;
  /** Fired when a node freezes (its first result lands, via generate or upload):
   *  auto-creates its child (same prompt + a copy of any guide image) WITHOUT
   *  moving focus — the frozen node stays in view; the child appears in the graph. */
  advanceAfterFreeze: (frozenNodeId: ID) => void;
  appendResult: (nodeId: ID, result: GenerationResult) => void;
  /** Set (or clear, with undefined) a node's guide image. Not undoable. */
  setGuideImage: (nodeId: ID, imageId: ID | undefined) => void;
  setCurrentResultIndex: (nodeId: ID, index: number) => void;
  /** Set a node's free-text status-bar note (personal label; not undoable). */
  setNodeNote: (nodeId: ID, note: string) => void;
  recomputeLayout: () => void;
}

type SceneStore = SceneData & SceneActions;

export const useSceneStore = create<SceneStore>()(
  temporal(
    immer<SceneStore>((set, get) => ({
      scene: null,
      draft: null,

      setScene: (scene) => {
        set((s) => {
          if (!scene) {
            s.scene = null;
            s.draft = null;
            return;
          }
          // The persisted draft (uncommitted edits) is kept out of the in-memory
          // committed scene; it's re-merged at save time and restored here — but
          // only when it still belongs to the current node (else fall back to the
          // committed prompt, so a stale/mismatched draft can't show wrong boxes).
          const { draft: savedDraft, draftNodeId, ...committed } = scene;
          const node = committed.nodes[committed.currentNodeId];
          const useDraft = savedDraft && draftNodeId === committed.currentNodeId;
          s.scene = committed;
          s.draft = clonePrompt(useDraft ? savedDraft : node.prompt);
        });
        useSceneStore.temporal.getState().clear();
      },

      selectNode: (nodeId) =>
        withoutHistory(() => {
          // Clone from the plain committed prompt (get()), never an immer draft proxy
          // — structuredClone() rejects Proxy objects (DataCloneError).
          const scene = get().scene;
          if (!scene || !scene.nodes[nodeId]) return;
          const prompt = clonePrompt(scene.nodes[nodeId].prompt);
          set((s) => {
            if (!s.scene || !s.scene.nodes[nodeId]) return;
            s.scene.currentNodeId = nodeId;
            s.draft = prompt;
          });
        }),

      editDraft: (recipe) => {
        if (isLocked(get())) return;
        set((s) => {
          if (s.draft) recipe(s.draft);
        });
      },

      // Deliberately NOT lock-gated: the user adjusts speed between Regenerates of
      // a frozen node. Regenerate reads the committed node.prompt, so update both
      // it and the draft to keep them in sync.
      setRenderingSpeed: (speed) => {
        set((s) => {
          if (s.draft) s.draft.renderingSpeed = speed;
          const node = s.scene?.nodes[s.scene.currentNodeId];
          if (node) node.prompt.renderingSpeed = speed;
        });
      },

      addBox: (box) => {
        if (isLocked(get())) return;
        set((s) => {
          s.draft?.boxes.push(box);
        });
      },
      addBoxes: (boxes) => {
        if (isLocked(get())) return;
        set((s) => {
          s.draft?.boxes.push(...boxes);
        });
      },
      updateBox: (id, recipe) => {
        if (isLocked(get())) return;
        set((s) => {
          const b = s.draft?.boxes.find((x) => x.id === id);
          if (b) recipe(b);
        });
      },
      removeBoxes: (ids) => {
        if (isLocked(get())) return;
        set((s) => {
          if (s.draft) s.draft.boxes = s.draft.boxes.filter((b) => !ids.includes(b.id));
        });
      },
      moveBoxZ: (id, delta) => {
        if (isLocked(get())) return;
        set((s) => {
          const arr = s.draft?.boxes;
          if (!arr) return;
          const i = arr.findIndex((b) => b.id === id);
          if (i < 0) return;
          const j = i + delta;
          if (j < 0 || j >= arr.length) return;
          const [b] = arr.splice(i, 1);
          arr.splice(j, 0, b);
        });
      },
      moveBoxToIndex: (id, toIndex) => {
        if (isLocked(get())) return;
        set((s) => {
          const arr = s.draft?.boxes;
          if (!arr) return;
          const i = arr.findIndex((b) => b.id === id);
          if (i < 0) return;
          // `toIndex` is the desired FINAL index in the (same-length) array; splice
          // it back in there after removal. Clamp + no-op if it doesn't move.
          const j = Math.max(0, Math.min(toIndex, arr.length - 1));
          if (j === i) return;
          const [b] = arr.splice(i, 1);
          arr.splice(j, 0, b);
        });
      },

      discardDrawnBox: (id) => {
        if (isLocked(get())) return;
        // Remove the box without recording a new history entry, then pop the box's
        // creation snapshot off the undo stack so a cancelled draw leaves no trace.
        let removed = false;
        withoutHistory(() =>
          set((s) => {
            if (!s.draft) return;
            const before = s.draft.boxes.length;
            s.draft.boxes = s.draft.boxes.filter((b) => b.id !== id);
            removed = s.draft.boxes.length !== before;
          })
        );
        if (removed) {
          const t = useSceneStore.temporal.getState();
          if (t.pastStates.length)
            useSceneStore.temporal.setState({ pastStates: t.pastStates.slice(0, -1) });
        }
      },

      addTag: (tag) => {
        if (isLocked(get())) return;
        set((s) => {
          // New tags go to the TOP of the list.
          s.draft?.tags.unshift(tag);
        });
      },
      addTags: (tags) => {
        if (isLocked(get())) return;
        set((s) => {
          s.draft?.tags.push(...tags);
        });
      },
      updateTag: (id, recipe) => {
        if (isLocked(get())) return;
        set((s) => {
          const t = s.draft?.tags.find((x) => x.id === id);
          if (t) recipe(t);
        });
      },
      removeTags: (ids) => {
        if (isLocked(get())) return;
        set((s) => {
          if (s.draft) s.draft.tags = s.draft.tags.filter((t) => !ids.includes(t.id));
        });
      },
      moveTagToIndex: (id, toIndex) => {
        if (isLocked(get())) return;
        set((s) => {
          const arr = s.draft?.tags;
          if (!arr) return;
          const i = arr.findIndex((t) => t.id === id);
          if (i < 0) return;
          // `toIndex` is the desired FINAL index in the (same-length) array; splice
          // it back in there after removal. Clamp + no-op if it doesn't move.
          const j = Math.max(0, Math.min(toIndex, arr.length - 1));
          if (j === i) return;
          const [t] = arr.splice(i, 1);
          arr.splice(j, 0, t);
        });
      },

      renameWorkingScene: (name) =>
        set((s) => {
          if (s.scene) {
            s.scene.name = name;
            s.scene.updatedAt = Date.now();
          }
        }),

      commitDraftToCurrentNode: () => {
        // Snapshot the draft from plain state (get()) before entering the immer
        // recipe — structuredClone() can't clone the immer draft proxy `s.draft`.
        const draft = get().draft;
        if (!draft) return;
        const snapshot = clonePrompt(draft);
        withoutHistory(() =>
          set((s) => {
            if (!s.scene) return;
            s.scene.nodes[s.scene.currentNodeId].prompt = snapshot;
          })
        );
      },

      createChildFromDraft: () => {
        const s0 = get();
        if (!s0.scene || !s0.draft) return null;
        const parent = s0.scene.nodes[s0.scene.currentNodeId];
        const note = computeChildNote(s0.scene, parent);
        const node = createNode(parent.id, clonePrompt(s0.draft), Date.now());
        node.note = note;
        set((s) => {
          if (!s.scene) return;
          s.scene.nodes[node.id] = node;
          s.scene.currentNodeId = node.id;
          s.draft = clonePrompt(node.prompt);
        });
        get().recomputeLayout();
        // A fresh node is for editing → make sure the prompt boxes are visible.
        useUiStore.getState().setShowPrompts(true);
        return node.id;
      },

      advanceAfterFreeze: (frozenNodeId) => {
        const s0 = get();
        const parent = s0.scene?.nodes[frozenNodeId];
        if (!s0.scene || !parent) return;
        const guideId = parent.guideImageId;
        // Clone the committed prompt that produced the image (not the draft/current
        // focus, which may be elsewhere for an async generation).
        const child = createNode(parent.id, clonePrompt(parent.prompt), Date.now());
        child.note = computeChildNote(s0.scene, parent);
        // Add the child but DON'T touch currentNodeId/draft — the frozen node stays
        // in view; the new node only shows up in the graph. Not undoable, matching
        // the (also-unrecorded) result append that triggered it.
        withoutHistory(() =>
          set((s) => {
            if (s.scene) s.scene.nodes[child.id] = child;
          })
        );
        get().recomputeLayout();
        // Carry the guide forward as a reference for the next prompt, under its own
        // blob id so the copy's lifecycle is independent of the parent's.
        if (guideId) void copyGuideBlob(guideId, child.id);
      },

      appendResult: (nodeId, result) => {
        let froze = false;
        withoutHistory(() =>
          set((s) => {
            const n = s.scene?.nodes[nodeId];
            if (n) {
              froze = n.results.length === 0; // 0 → 1: this result freezes the node
              n.results.push(result);
              n.currentResultIndex = n.results.length - 1;
            }
          })
        );
        // A generation just landed → make sure the image is visible.
        useUiStore.getState().setShowImage(true);
        // Freezing a node auto-creates its child in the background (focus stays put).
        if (froze) get().advanceAfterFreeze(nodeId);
      },

      setGuideImage: (nodeId, imageId) =>
        withoutHistory(() =>
          set((s) => {
            const n = s.scene?.nodes[nodeId];
            if (n) n.guideImageId = imageId;
          })
        ),

      setCurrentResultIndex: (nodeId, index) =>
        withoutHistory(() =>
          set((s) => {
            const n = s.scene?.nodes[nodeId];
            if (n && index >= 0 && index < n.results.length) n.currentResultIndex = index;
          })
        ),

      setNodeNote: (nodeId, note) =>
        withoutHistory(() =>
          set((s) => {
            const n = s.scene?.nodes[nodeId];
            if (n) n.note = note;
          })
        ),

      recomputeLayout: () =>
        withoutHistory(() =>
          set((s) => {
            if (!s.scene) return;
            const pos = computeLayout(s.scene.nodes, s.scene.rootId);
            for (const id in pos) {
              const n = s.scene.nodes[id];
              if (n) n.pos = pos[id];
            }
          })
        ),
    })),
    {
      limit: 200,
      partialize: (state) => ({ scene: state.scene, draft: state.draft }),
      // Leading-throttle: record the pre-edit snapshot on the first edit of a burst,
      // suppress until ~350ms of quiet → one undo entry per typing/drag burst.
      handleSet: (handleSet) => {
        let last = 0;
        return ((pastState) => {
          const now = Date.now();
          if (now - last > 350) handleSet(pastState);
          last = now;
        }) as typeof handleSet;
      },
    }
  )
);

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Duplicate an existing guide-image blob under a fresh id and attach it to a
 *  node, so the copy's lifecycle is independent of the source (removing one
 *  won't delete the other's blob). Fire-and-forget; no-op if the blob is gone. */
async function copyGuideBlob(sourceImageId: ID, targetNodeId: ID): Promise<void> {
  const blob = await getImage(sourceImageId);
  if (!blob) return;
  const imageId = newId();
  await putImage(imageId, blob);
  useSceneStore.getState().setGuideImage(targetNodeId, imageId);
}

function withoutHistory(fn: () => void): void {
  const t = useSceneStore.temporal.getState();
  const wasPaused = t.isTracking === false;
  t.pause();
  try {
    fn();
  } finally {
    if (!wasPaused) t.resume();
  }
}

export function currentNode(scene: Scene): GraphNode {
  return scene.nodes[scene.currentNodeId];
}

// A node's prompt is LOCKED once it has produced an image: editing it in place is
// no longer allowed (iterate by spawning a fresh child via createChildFromDraft).
// This is the source-of-truth guard the edit actions consult; the editors mirror
// it visually via `useCurrentNodeLocked`.
function isLocked(s: SceneData): boolean {
  const sc = s.scene;
  if (!sc) return false;
  const n = sc.nodes[sc.currentNodeId];
  return !!n && n.results.length > 0;
}

/** React hook: is the current node's prompt locked (has ≥1 generated image)? */
export function useCurrentNodeLocked(): boolean {
  return useSceneStore((s) => isLocked(s));
}

// ─── status-bar note inheritance ─────────────────────────────────────────────
// A child's note is the parent's note (auto-marker stripped, so markers don't
// accumulate) with a fresh lineage marker appended: " #N" for the primary
// continuation (first child), " A"/" B"/… for each additional branch. Empty
// parent notes propagate nothing. Caveat: stripping a trailing " <SINGLE-CAP>"
// can clip a user-typed base like "Option A" — acceptable for a personal label.
const NOTE_MARKER_RE = /\s+(?:#\d+|[A-Z])$/;

function stripNoteMarker(note: string): string {
  return note.replace(NOTE_MARKER_RE, "").trim();
}

/** Distance (edge count) from a node to the root, with a cycle guard. */
function depthOf(scene: Scene, nodeId: ID): number {
  let depth = 0;
  let cur: ID | null = nodeId;
  const seen = new Set<ID>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const parent: ID | null = scene.nodes[cur]?.parentId ?? null;
    if (!parent) break;
    depth++;
    cur = parent;
  }
  return depth;
}

/** Compute the inherited note for a new child of `parent` (see block comment). */
function computeChildNote(scene: Scene, parent: GraphNode): string {
  const base = stripNoteMarker(parent.note ?? "");
  if (!base) return "";
  const childCount = Object.values(scene.nodes).filter((n) => n.parentId === parent.id).length;
  if (childCount === 0) {
    // Primary continuation: number by the child's depth (root ⇒ #1 implicit).
    return `${base} #${depthOf(scene, parent.id) + 2}`;
  }
  // Additional child ⇒ branch: 2nd child ⇒ A, 3rd ⇒ B, …
  return `${base} ${String.fromCharCode(65 + (childCount - 1))}`;
}

/** Deep-compare the draft against the current node's committed prompt. */
export function isDraftDirty(): boolean {
  const { scene, draft } = useSceneStore.getState();
  if (!scene || !draft) return false;
  return JSON.stringify(draft) !== JSON.stringify(currentNode(scene).prompt);
}

export function undo(): void {
  useSceneStore.temporal.getState().undo();
}
export function redo(): void {
  useSceneStore.temporal.getState().redo();
}
