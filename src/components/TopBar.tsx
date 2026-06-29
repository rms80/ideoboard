import { useRef } from "react";
import { useScenesStore } from "../state/scenesStore";
import { useUiStore } from "../state/uiStore";
import { useUndoState } from "../hooks/useUndo";
import { Button, IconButton, selectClass } from "./common/ui";

export function TopBar() {
  const {
    scenes,
    currentSceneId,
    switchScene,
    createScene,
    renameScene,
    deleteScene,
    exportCurrent,
    importZip,
  } = useScenesStore();
  const fileInput = useRef<HTMLInputElement>(null);
  const viewMode = useUiStore((s) => s.viewMode);
  const toggleViewMode = useUiStore((s) => s.toggleViewMode);
  const openSettings = useUiStore((s) => s.openSettings);
  const { canUndo, canRedo, undo, redo } = useUndoState();

  const current = scenes.find((s) => s.id === currentSceneId);

  const onRename = () => {
    if (!currentSceneId) return;
    const name = window.prompt("Rename scene", current?.name ?? "");
    if (name != null) void renameScene(currentSceneId, name);
  };

  const onDelete = () => {
    if (!currentSceneId) return;
    if (window.confirm(`Delete scene "${current?.name}"? This cannot be undone.`))
      void deleteScene(currentSceneId);
  };

  const onImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-importing the same file
    if (!file) return;
    void importZip(file).catch((err) => window.alert(`Import failed: ${err}`));
  };

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-surface-1 px-3">
      <div className="flex items-center gap-1.5 pr-2 font-semibold tracking-tight text-ink">
        <span className="text-accent">◈</span> Ideoboard
      </div>

      {/* Scene management */}
      <select
        className={`${selectClass} w-44`}
        value={currentSceneId ?? ""}
        onChange={(e) => void switchScene(e.target.value)}
      >
        {scenes.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <IconButton title="New scene" onClick={() => void createScene()}>
        ＋
      </IconButton>
      <IconButton title="Rename scene" onClick={onRename}>
        ✎
      </IconButton>
      <IconButton title="Delete scene" onClick={onDelete}>
        🗑
      </IconButton>

      <div className="mx-1 h-6 w-px bg-border" />

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

      <div className="mx-1 h-6 w-px bg-border" />

      <IconButton title="Undo (⌘Z)" disabled={!canUndo} onClick={undo}>
        ↶
      </IconButton>
      <IconButton title="Redo (⇧⌘Z)" disabled={!canRedo} onClick={redo}>
        ↷
      </IconButton>

      <div className="flex-1" />

      <Button onClick={toggleViewMode}>
        {viewMode === "graph" ? "Focus view" : "Graph view"}
      </Button>
      <IconButton title="Settings" onClick={openSettings}>
        ⚙
      </IconButton>
    </header>
  );
}
