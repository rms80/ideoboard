// Right half of the top bar — sits above the focus view's right panel (and at
// the top-right in graph mode). Graph toggle + undo/redo + export/import +
// settings, right-aligned.
import { useRef } from "react";
import type { ChangeEvent } from "react";
import { useScenesStore } from "../state/scenesStore";
import { useUiStore } from "../state/uiStore";
import { useUndoState } from "../hooks/useUndo";
import { Button, IconButton } from "./common/ui";

export function RightBar() {
  const { exportCurrent, importZip } = useScenesStore();
  const fileInput = useRef<HTMLInputElement>(null);
  const viewMode = useUiStore((s) => s.viewMode);
  const toggleViewMode = useUiStore((s) => s.toggleViewMode);
  const openSettings = useUiStore((s) => s.openSettings);
  const { canUndo, canRedo, undo, redo } = useUndoState();

  const onImportFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-importing the same file
    if (!file) return;
    void importZip(file).catch((err) => window.alert(`Import failed: ${err}`));
  };

  return (
    <header className="flex h-9 shrink-0 items-center justify-end gap-1 border-b border-border bg-surface-3 px-2">
      <Button
        variant="accent"
        onClick={toggleViewMode}
        title={viewMode === "graph" ? "Switch to focus view" : "Switch to graph view (⌘G)"}
      >
        {viewMode === "graph" ? "Focus View" : "Graph View"}
      </Button>

      <div className="mx-0.5 h-6 w-px bg-border" />

      <IconButton title="Undo (⌘Z)" disabled={!canUndo} onClick={undo}>
        ↶
      </IconButton>
      <IconButton title="Redo (⇧⌘Z)" disabled={!canRedo} onClick={redo}>
        ↷
      </IconButton>

      <div className="mx-0.5 h-6 w-px bg-border" />

      <IconButton title="Export scene (.zip)" onClick={() => void exportCurrent()}>
        ⤓
      </IconButton>
      <IconButton title="Import scene (.zip)" onClick={() => fileInput.current?.click()}>
        ⤒
      </IconButton>
      <input
        ref={fileInput}
        type="file"
        accept=".zip,application/zip"
        hidden
        onChange={onImportFile}
      />

      <IconButton title="Settings" onClick={openSettings}>
        ⚙
      </IconButton>
    </header>
  );
}
