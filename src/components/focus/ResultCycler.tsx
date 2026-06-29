import type { ReactNode } from "react";
import { useSceneStore } from "../../state/sceneStore";
import { useGenerationStore } from "../../state/generationStore";
import { useUiStore } from "../../state/uiStore";
import { Button, IconButton } from "../common/ui";

// Controls under the image. Generate/Regenerate stays dead-centered below the
// image; Edit/Branch sits at the right; the Image/Prompts visibility toggles live
// in a small box centered in the gap between them; the result cycler floats left.
//   • Generate / Regenerate — produce this node's image (or append a seed).
//   • Edit / Branch         — spawn a fresh editable child (copies this prompt, no
//                             image); disabled until this node has an image.
function ToggleBtn({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: ReactNode;
}) {
  // Compact segments (no individual rounding — the container clips them into one
  // continuous block); active = solid muted green.
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`px-1.5 py-px text-[10px] font-medium transition ${
        active
          ? "bg-[#3a8a5c] text-white"
          : "bg-surface-1 text-ink-dim hover:bg-surface-2 hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

export function ResultCycler() {
  const scene = useSceneStore((s) => s.scene);
  const setCurrentResultIndex = useSceneStore((s) => s.setCurrentResultIndex);
  const createChildFromDraft = useSceneStore((s) => s.createChildFromDraft);
  const generate = useGenerationStore((s) => s.generate);
  const regenerate = useGenerationStore((s) => s.regenerate);
  const showImage = useUiStore((s) => s.showImage);
  const showPrompts = useUiStore((s) => s.showPrompts);
  const toggleShowImage = useUiStore((s) => s.toggleShowImage);
  const toggleShowPrompts = useUiStore((s) => s.toggleShowPrompts);

  const node = scene ? scene.nodes[scene.currentNodeId] : null;
  const status = useGenerationStore((s) => (node ? s.status[node.id] : undefined));

  if (!node) return null;
  const count = node.results.length;
  const idx = node.currentResultIndex;
  const busy = status === "generating";
  const hasImage = count > 0;

  const hasChildren = !!scene && Object.values(scene.nodes).some((n) => n.parentId === node.id);
  const primaryLabel = busy ? "Generating…" : hasImage ? "Regenerate" : "Generate";
  const iterateLabel = hasChildren ? "Branch" : "Edit";

  return (
    // Generate is the only in-flow child (justify-center) → dead-centered + defines
    // the row height; everything else is absolutely positioned around it.
    <div className="relative flex items-center justify-center">
      {/* Left (floating): result cycler */}
      <div className="absolute left-0 top-1/2 flex -translate-y-1/2 items-center gap-1">
        <IconButton
          title="Previous result"
          disabled={count <= 1}
          onClick={() => setCurrentResultIndex(node.id, idx - 1)}
        >
          ◀
        </IconButton>
        <span className="min-w-12 text-center text-xs tabular-nums text-ink-dim">
          {count === 0 ? "— / —" : `${idx + 1} / ${count}`}
        </span>
        <IconButton
          title="Next result"
          disabled={count <= 1}
          onClick={() => setCurrentResultIndex(node.id, idx + 1)}
        >
          ▶
        </IconButton>
      </div>

      {/* Center: Generate / Regenerate */}
      <Button
        variant="accent"
        disabled={busy}
        onClick={() => (hasImage ? regenerate(node.id) : generate())}
        title={hasImage ? "Append another result (new seed)" : "Generate this node's image"}
      >
        {primaryLabel}
      </Button>

      {/* Centered in the gap between Generate (center) and Edit (right): the two
          toggles clipped into one continuous rounded block (no border, no gap). */}
      <div className="absolute left-3/4 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center overflow-hidden rounded-md">
        <ToggleBtn active={showImage} onClick={toggleShowImage} title="Show/hide the image">
          Image
        </ToggleBtn>
        <ToggleBtn active={showPrompts} onClick={toggleShowPrompts} title="Show/hide the prompt boxes">
          Prompts
        </ToggleBtn>
      </div>

      {/* Right: Edit / Branch */}
      <div className="absolute right-0 top-1/2 -translate-y-1/2">
        <Button
          variant="default"
          disabled={busy || !hasImage}
          onClick={() => createChildFromDraft()}
          title={
            hasImage
              ? hasChildren
                ? "Spawn a new branch (copies this prompt, no image yet)"
                : "Spawn the next node (copies this prompt, no image yet)"
              : "Generate an image first"
          }
        >
          {iterateLabel}
        </Button>
      </div>
    </div>
  );
}
