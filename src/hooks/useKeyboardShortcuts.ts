import { useEffect } from "react";
import { undo, redo } from "../state/sceneStore";
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
      const mod = e.metaKey || e.ctrlKey;
      const editable = isEditable(e.target);

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
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
