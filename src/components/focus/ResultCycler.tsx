import type { ReactNode } from "react";
import { useSceneStore } from "../../state/sceneStore";
import { useGenerationStore } from "../../state/generationStore";
import { useUiStore } from "../../state/uiStore";
import { DEFAULT_RENDERING_SPEED, type RenderingSpeed } from "../../types";
import { Button } from "../common/ui";

const SPEED_OPTIONS: { label: string; value: RenderingSpeed }[] = [
  { label: "Default", value: "DEFAULT" },
  { label: "Turbo", value: "TURBO" },
  { label: "Quality", value: "QUALITY" },
];

// Compact prev/next arrows for the result cycler (tighter than the shared
// IconButton's 32px square).
const cyclerArrow =
  "flex h-6 items-center justify-center rounded px-0.5 text-xs text-ink-dim transition hover:bg-surface-2 hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent";

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
  disabled = false,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  // Compact segments (no individual rounding — the container clips them into one
  // continuous block); active = solid muted green.
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      aria-pressed={active}
      className={`px-1.5 py-px text-[10px] font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
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
  const selectNode = useSceneStore((s) => s.selectNode);
  const generate = useGenerationStore((s) => s.generate);
  const regenerate = useGenerationStore((s) => s.regenerate);
  const showImage = useUiStore((s) => s.showImage);
  const showPrompts = useUiStore((s) => s.showPrompts);
  const showGuide = useUiStore((s) => s.showGuide);
  const toggleShowImage = useUiStore((s) => s.toggleShowImage);
  const toggleShowPrompts = useUiStore((s) => s.toggleShowPrompts);
  const toggleShowGuide = useUiStore((s) => s.toggleShowGuide);
  const speed = useSceneStore((s) => s.draft?.renderingSpeed ?? DEFAULT_RENDERING_SPEED);
  const setRenderingSpeed = useSceneStore((s) => s.setRenderingSpeed);

  const node = scene ? scene.nodes[scene.currentNodeId] : null;
  const status = useGenerationStore((s) => (node ? s.status[node.id] : undefined));

  if (!node) return null;
  const count = node.results.length;
  const idx = node.currentResultIndex;
  const busy = status === "generating";
  const hasImage = count > 0;
  // A guide image can exist regardless of whether this node has a result; the
  // toggle stays usable either way (the image just takes precedence when shown).
  const hasGuide = !!node.guideImageId;

  const children = scene ? Object.values(scene.nodes).filter((n) => n.parentId === node.id) : [];
  const hasChildren = children.length > 0;
  // Primary continuation child (earliest-created), mirroring the StatusBar's Next
  // arrow. When it exists but has no image yet, the right-hand button becomes a
  // plain "Next" that navigates there rather than branching a brand-new node.
  const nextId =
    children.slice().sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1))[0]?.id ??
    null;
  const nextIsEmpty = !!nextId && (scene?.nodes[nextId]?.results.length ?? 0) === 0;
  const primaryLabel = busy ? "Generating…" : hasImage ? "Regenerate" : "Generate";
  // "Branch" when a divergent child makes sense; otherwise "Next" (create+go to the
  // continuation, or just the disabled placeholder on a not-yet-generated node).
  const iterateLabel = hasChildren ? "Branch" : "Next";

  return (
    // Generate is the only in-flow child (justify-center) → dead-centered + defines
    // the row height; everything else is absolutely positioned around it.
    <div className="relative flex items-center justify-center">
      {/* Left (floating): result cycler. Tight spacing; counter sized for 2 digits
          per side ("99 / 99"). */}
      <div className="absolute left-0 top-1/2 flex -translate-y-1/2 items-center gap-px">
        <button
          type="button"
          title="Previous result"
          disabled={count <= 1}
          onClick={() => setCurrentResultIndex(node.id, (idx - 1 + count) % count)}
          className={cyclerArrow}
        >
          ◀
        </button>
        <span className="min-w-10 text-center text-xs tabular-nums text-ink-dim">
          {count === 0 ? "— / —" : `${idx + 1} / ${count}`}
        </span>
        <button
          type="button"
          title="Next result"
          disabled={count <= 1}
          onClick={() => setCurrentResultIndex(node.id, (idx + 1) % count)}
          className={cyclerArrow}
        >
          ▶
        </button>
      </div>

      {/* Rendering-speed picker, centered in the gap between the result cycler's
          right edge (~68px after tightening) and Generate's left edge (50% − ~36px)
          → 25% + 16px, so it doesn't overlap the ▶ arrow. Editable even when the
          prompt is frozen — speed applies to the next Regenerate. */}
      <div className="absolute left-[calc(25%_+_16px)] top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center overflow-hidden rounded-md">
        {SPEED_OPTIONS.map((o) => (
          <ToggleBtn
            key={o.value}
            active={speed === o.value}
            onClick={() => setRenderingSpeed(o.value)}
            title={`${o.label} rendering speed`}
          >
            {o.label}
          </ToggleBtn>
        ))}
      </div>

      {/* Center: Generate / Regenerate. Slightly larger than the default Button
          (4px wider + taller) with bold text, via inline overrides. */}
      <Button
        variant="accent"
        disabled={busy}
        onClick={() => (hasImage ? regenerate(node.id) : generate())}
        title={hasImage ? "Append another result (new seed)" : "Generate this node's image"}
        style={{ padding: "4px 6px", fontWeight: 700 }}
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
        <ToggleBtn
          active={hasGuide && showGuide}
          disabled={!hasGuide}
          onClick={toggleShowGuide}
          title={hasGuide ? "Show/hide the guide image" : "No guide image on this node"}
        >
          Guide
        </ToggleBtn>
      </div>

      {/* Right: Next (go to the empty continuation) / Branch */}
      <div className="absolute right-0 top-1/2 -translate-y-1/2">
        {nextIsEmpty ? (
          <Button
            variant="default"
            disabled={busy}
            onClick={() => nextId && selectNode(nextId)}
            title="Go to the next node"
          >
            Next
          </Button>
        ) : (
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
        )}
      </div>
    </div>
  );
}
