import { useStore } from "zustand";
import { useSceneStore, undo, redo } from "../state/sceneStore";

export function useUndoState() {
  const canUndo = useStore(useSceneStore.temporal, (s) => s.pastStates.length > 0);
  const canRedo = useStore(useSceneStore.temporal, (s) => s.futureStates.length > 0);
  return { canUndo, canRedo, undo, redo };
}
