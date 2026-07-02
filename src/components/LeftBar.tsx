// Left half of the top bar — sits above the focus view's left panel (and at the
// top-left in graph mode). Logo icon + scene picker + new/rename/delete.
import { useScenesStore } from "../state/scenesStore";
import { IconButton, selectClass } from "./common/ui";

export function LeftBar() {
  const {
    scenes,
    currentSceneId,
    switchScene,
    createScene,
    renameScene,
    deleteScene,
  } = useScenesStore();

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

  return (
    <header className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border bg-surface-3 px-2">
      <span className="shrink-0 text-accent" title="Ideoboard">
        ◈
      </span>

      {/* Scene picker fills the remaining width so the three actions always fit. */}
      <select
        className={`${selectClass} min-w-0 flex-1`}
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
    </header>
  );
}
