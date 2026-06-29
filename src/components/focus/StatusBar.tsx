// Status bar above the focus image (replaces the old breadcrumb).
//   • far-left / far-right arrows navigate to the previous (parent) / next
//     (primary child) node, when one exists;
//   • a centered free-text field labels the current node's result — a personal
//     annotation only (never expanded as #tags or sent to generation);
//   • a trashcan at the field's right edge clears the label.
import { useSceneStore } from "../../state/sceneStore";

function Chevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points={dir === "left" ? "10 3 5 8 10 13" : "6 3 11 8 6 13"} />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2.5 4h11" />
      <path d="M5.5 4V2.5h5V4" />
      <path d="M4 4l.7 9.5h6.6L12 4" />
      <path d="M6.5 6.5v5M9.5 6.5v5" />
    </svg>
  );
}

export function StatusBar() {
  const scene = useSceneStore((s) => s.scene);
  const selectNode = useSceneStore((s) => s.selectNode);
  const setNodeNote = useSceneStore((s) => s.setNodeNote);
  if (!scene) return null;

  const node = scene.nodes[scene.currentNodeId];
  if (!node) return null;

  const prevId = node.parentId && scene.nodes[node.parentId] ? node.parentId : null;
  // "Next" = the primary continuation child (earliest-created), if any.
  const nextId =
    Object.values(scene.nodes)
      .filter((n) => n.parentId === node.id)
      .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1))[0]?.id ?? null;

  const note = node.note ?? "";

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        title="Previous node"
        disabled={!prevId}
        onClick={() => prevId && selectNode(prevId)}
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-dim transition hover:bg-surface-2 hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-ink-dim"
      >
        <Chevron dir="left" />
      </button>

      <div className="relative min-w-0 flex-1">
        <input
          type="text"
          value={note}
          onChange={(e) => setNodeNote(node.id, e.target.value)}
          placeholder="Describe this result…"
          aria-label="Result description"
          className="w-full rounded-md border border-border bg-surface-0 px-7 py-1 text-center text-xs text-ink outline-none focus:border-accent placeholder:text-ink-faint"
        />
        <button
          type="button"
          title="Clear description"
          onClick={() => setNodeNote(node.id, "")}
          className="absolute right-1.5 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-ink-faint transition hover:bg-surface-2 hover:text-danger"
        >
          <TrashIcon />
        </button>
      </div>

      <button
        type="button"
        title="Next node"
        disabled={!nextId}
        onClick={() => nextId && selectNode(nextId)}
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-dim transition hover:bg-surface-2 hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-ink-dim"
      >
        <Chevron dir="right" />
      </button>
    </div>
  );
}
