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
} from "../types";
import { createNode, clonePrompt } from "./factory";
import { computeLayout } from "../services/layout";

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

  // Box edits (operate on draft, undoable)
  addBox: (box: PromptBox) => void;
  addBoxes: (boxes: PromptBox[]) => void;
  updateBox: (id: ID, recipe: (b: PromptBox) => void) => void;
  removeBoxes: (ids: ID[]) => void;

  // Tag edits (operate on draft, undoable)
  addTag: (tag: PromptTag) => void;
  addTags: (tags: PromptTag[]) => void;
  updateTag: (id: ID, recipe: (t: PromptTag) => void) => void;
  removeTags: (ids: ID[]) => void;

  renameWorkingScene: (name: string) => void;

  // Generation-flow ops (NOT undoable)
  commitDraftToCurrentNode: () => void;
  createChildFromDraft: () => ID | null;
  appendResult: (nodeId: ID, result: GenerationResult) => void;
  setCurrentResultIndex: (nodeId: ID, index: number) => void;
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
          s.scene = scene;
          s.draft = scene ? clonePrompt(scene.nodes[scene.currentNodeId].prompt) : null;
        });
        useSceneStore.temporal.getState().clear();
      },

      selectNode: (nodeId) =>
        withoutHistory(() =>
          set((s) => {
            if (!s.scene || !s.scene.nodes[nodeId]) return;
            s.scene.currentNodeId = nodeId;
            s.draft = clonePrompt(s.scene.nodes[nodeId].prompt);
          })
        ),

      editDraft: (recipe) =>
        set((s) => {
          if (s.draft) recipe(s.draft);
        }),

      addBox: (box) =>
        set((s) => {
          s.draft?.boxes.push(box);
        }),
      addBoxes: (boxes) =>
        set((s) => {
          s.draft?.boxes.push(...boxes);
        }),
      updateBox: (id, recipe) =>
        set((s) => {
          const b = s.draft?.boxes.find((x) => x.id === id);
          if (b) recipe(b);
        }),
      removeBoxes: (ids) =>
        set((s) => {
          if (s.draft) s.draft.boxes = s.draft.boxes.filter((b) => !ids.includes(b.id));
        }),

      addTag: (tag) =>
        set((s) => {
          s.draft?.tags.push(tag);
        }),
      addTags: (tags) =>
        set((s) => {
          s.draft?.tags.push(...tags);
        }),
      updateTag: (id, recipe) =>
        set((s) => {
          const t = s.draft?.tags.find((x) => x.id === id);
          if (t) recipe(t);
        }),
      removeTags: (ids) =>
        set((s) => {
          if (s.draft) s.draft.tags = s.draft.tags.filter((t) => !ids.includes(t.id));
        }),

      renameWorkingScene: (name) =>
        set((s) => {
          if (s.scene) {
            s.scene.name = name;
            s.scene.updatedAt = Date.now();
          }
        }),

      commitDraftToCurrentNode: () =>
        withoutHistory(() =>
          set((s) => {
            if (!s.scene || !s.draft) return;
            s.scene.nodes[s.scene.currentNodeId].prompt = clonePrompt(s.draft);
          })
        ),

      createChildFromDraft: () => {
        const s0 = get();
        if (!s0.scene || !s0.draft) return null;
        const node = createNode(s0.scene.currentNodeId, clonePrompt(s0.draft), Date.now());
        set((s) => {
          if (!s.scene) return;
          s.scene.nodes[node.id] = node;
          s.scene.currentNodeId = node.id;
          s.draft = clonePrompt(node.prompt);
        });
        get().recomputeLayout();
        return node.id;
      },

      appendResult: (nodeId, result) =>
        withoutHistory(() =>
          set((s) => {
            const n = s.scene?.nodes[nodeId];
            if (n) {
              n.results.push(result);
              n.currentResultIndex = n.results.length - 1;
            }
          })
        ),

      setCurrentResultIndex: (nodeId, index) =>
        withoutHistory(() =>
          set((s) => {
            const n = s.scene?.nodes[nodeId];
            if (n && index >= 0 && index < n.results.length) n.currentResultIndex = index;
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
