// Status bar above the focus image (replaces the old breadcrumb).
//   • far-left / far-right arrows navigate to the previous (parent) / next
//     (primary child) node, when one exists;
//   • a centered free-text field labels the current node's result — a personal
//     annotation only (never expanded as #tags or sent to generation);
//   • a trashcan at the field's right edge clears the label;
//   • fullscreen / copy-prompt / download buttons act on the displayed image,
//     sitting between the field and the next-node arrow.
import { useSceneStore } from "../../state/sceneStore";
import { useImageActions } from "../../hooks/useImageActions";
import { useContextMenu } from "../common/ContextMenu";

// Square action button matching the nav arrows (28px, muted → hover ink).
const barBtn =
  "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-dim transition hover:bg-surface-2 hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-ink-dim";

function MagnifyIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M7 10l5 5 5-5" />
      <path d="M12 15V3" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
      <circle cx="12" cy="5" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="12" cy="19" r="2" />
    </svg>
  );
}

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
  const { url, promptSource, copied, openLightbox, copyPrompt, downloadImage, buildMenuItems } =
    useImageActions();
  const { menu: ctxMenu, open: openCtx } = useContextMenu();
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
          className="w-full rounded-md border border-border bg-surface-0 px-7 py-0.5 text-center text-xs text-ink outline-none focus:border-accent placeholder:text-ink-faint"
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

      {/* Image actions for the displayed result: fullscreen / copy prompt /
          download. The copy button flashes "copied prompt" beneath it. */}
      <div className="relative flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          title="View fullscreen"
          disabled={!url}
          onClick={() => openLightbox()}
          className={barBtn}
        >
          <MagnifyIcon />
        </button>
        <button
          type="button"
          title="Copy prompt"
          disabled={!promptSource}
          onClick={() => void copyPrompt()}
          className={barBtn}
        >
          <CopyIcon />
        </button>
        <button
          type="button"
          title="Download image"
          disabled={!url}
          onClick={() => void downloadImage()}
          className={barBtn}
        >
          <DownloadIcon />
        </button>
        <button
          type="button"
          title="More actions"
          onClick={(e) => openCtx(e, buildMenuItems())}
          className={barBtn}
        >
          <MoreIcon />
        </button>
        {copied && (
          <div className="pointer-events-none absolute right-0 top-full z-30 mt-1 whitespace-nowrap rounded border border-border bg-surface-1/95 px-1.5 py-0.5 text-[10px] text-ink-dim shadow">
            copied prompt
          </div>
        )}
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

      {ctxMenu}
    </div>
  );
}
