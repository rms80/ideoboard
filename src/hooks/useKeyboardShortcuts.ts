import { useEffect } from "react";
import { undo, redo, useSceneStore } from "../state/sceneStore";
import { useGenerationStore } from "../state/generationStore";
import { useUiStore } from "../state/uiStore";

function isEditable(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  if (!t) return false;
  return (
    t.tagName === "INPUT" ||
    t.tagName === "TEXTAREA" ||
    t.tagName === "SELECT" ||
    t.isContentEditable
  );
}

/** Global shortcuts. Box/tag clipboard + nudge shortcuts are added in later milestones. */
export function useKeyboardShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The lightbox is modal and owns the keyboard while open (Esc + arrows,
      // including Shift+arrows cycling results instead of navigating nodes).
      if (useUiStore.getState().lightboxOpen) return;

      const mod = e.metaKey || e.ctrlKey;
      const editable = isEditable(e.target);

      // Block the browser's select-all outside of text fields (selection is only
      // meaningful inside inputs; app-level selection is disabled via CSS).
      if (mod && e.key.toLowerCase() === "a" && !editable) {
        e.preventDefault();
        return;
      }

      // Undo / redo — defer to native text undo when editing a field.
      if (mod && e.key.toLowerCase() === "z") {
        if (editable) return;
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }

      // Cmd/Ctrl+Enter generates from anywhere.
      if (mod && e.key === "Enter") {
        e.preventDefault();
        useGenerationStore.getState().generate();
        return;
      }

      // Cmd/Ctrl+B toggles graph/focus.
      if (mod && e.key.toLowerCase() === "b") {
        e.preventDefault();
        useUiStore.getState().toggleViewMode();
        return;
      }

      // Cmd/Ctrl+G switches to graph view (works even while editing a prompt field).
      if (mod && e.key.toLowerCase() === "g") {
        e.preventDefault();
        useUiStore.getState().setViewMode("graph");
        return;
      }

      // Cmd/Ctrl+F opens the fullscreen lightbox — only in focus view and when the
      // current node has an image; otherwise fall through to the browser's find.
      if (mod && e.key.toLowerCase() === "f") {
        const ui = useUiStore.getState();
        if (ui.viewMode !== "focus") return;
        const scene = useSceneStore.getState().scene;
        const node = scene ? scene.nodes[scene.currentNodeId] : null;
        if (!node || node.results.length === 0) return;
        e.preventDefault();
        ui.openLightbox();
        return;
      }

      // ←/→ cycle the current node's active image (multi-image nodes, wrapping);
      // Shift+←/→ navigate to the previous (parent) / next (primary child) node.
      // Both are skipped when a text field has focus, or — in focus view — when a
      // box is selected, since arrows then nudge the box.
      if (!mod && !e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        if (editable) return;
        const ui = useUiStore.getState();
        if (ui.viewMode === "focus" && ui.selectedBoxIds.length > 0) return;
        const scene = useSceneStore.getState().scene;
        if (!scene) return;
        const node = scene.nodes[scene.currentNodeId];
        if (!node) return;
        const dir = e.key === "ArrowLeft" ? -1 : 1;

        if (e.shiftKey) {
          // Prev = parent; next = earliest-created child (the primary continuation).
          const targetId =
            dir < 0
              ? node.parentId && scene.nodes[node.parentId]
                ? node.parentId
                : null
              : (Object.values(scene.nodes)
                  .filter((n) => n.parentId === node.id)
                  .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1))[0]?.id ??
                  null);
          if (!targetId) return;
          e.preventDefault();
          useSceneStore.getState().selectNode(targetId);
          return;
        }

        if (node.results.length <= 1) return;
        e.preventDefault();
        const next = (node.currentResultIndex + dir + node.results.length) % node.results.length;
        useSceneStore.getState().setCurrentResultIndex(node.id, next);
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
