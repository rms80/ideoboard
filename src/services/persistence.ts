// Debounced autosave + initial load. Scene JSON is written to IndexedDB ~600ms
// after edits; image blobs are written once at generation time (in images.ts),
// not on every keystroke.
import { useSceneStore } from "../state/sceneStore";
import { useScenesStore } from "../state/scenesStore";
import { useUiStore } from "../state/uiStore";
import { saveScene, loadAllScenes } from "./db";
import { debounce } from "../util/misc";

let started = false;

const save = debounce(() => {
  void persistNow();
}, 600);

async function persistNow(): Promise<void> {
  const { scene, draft } = useSceneStore.getState();
  if (!scene) return;
  const viewport = useUiStore.getState().viewport;
  // Persist the working draft too, so uncommitted edits (drawn boxes, typed text)
  // survive reload. Stamp it with the node it derives from so setScene can reject
  // a mismatched draft. setScene restores it on load.
  const toSave = {
    ...scene,
    viewport,
    draft: draft ?? undefined,
    draftNodeId: draft ? scene.currentNodeId : undefined,
    updatedAt: Date.now(),
  };
  await saveScene(toSave);
  await useScenesStore.getState().refresh();
}

export function startAutosave(): void {
  if (started) return;
  started = true;
  // Save on any working-scene change (debounced). Draft-only edits also fire this,
  // but the 600ms debounce + idempotent write keeps it cheap.
  useSceneStore.subscribe(() => save());
}

export function flushAutosave(): void {
  save.flush();
}

/** App bootstrap: load the most recent scene, or create a default one. */
export async function loadInitial(): Promise<void> {
  const all = await loadAllScenes();
  if (all.length === 0) {
    await useScenesStore.getState().createScene("Untitled");
  } else {
    await useScenesStore.getState().refresh();
    // loadAllScenes is sorted by updatedAt desc → [0] is most recent.
    await forceSwitch(all[0].id);
  }
  startAutosave();
}

// switchScene early-returns if id === currentSceneId; on first load currentSceneId
// is null so this is just switchScene, but kept explicit for clarity.
async function forceSwitch(id: string): Promise<void> {
  await useScenesStore.getState().switchScene(id);
}
