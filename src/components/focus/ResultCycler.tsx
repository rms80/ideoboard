import { useSceneStore, isDraftDirty } from "../../state/sceneStore";
import { useGenerationStore } from "../../state/generationStore";
import { Button, IconButton } from "../common/ui";

export function ResultCycler() {
  const scene = useSceneStore((s) => s.scene);
  const draftBoxesLen = useSceneStore((s) => s.draft?.boxes.length ?? 0);
  const setCurrentResultIndex = useSceneStore((s) => s.setCurrentResultIndex);
  const generate = useGenerationStore((s) => s.generate);
  const regenerate = useGenerationStore((s) => s.regenerate);

  const node = scene ? scene.nodes[scene.currentNodeId] : null;
  const status = useGenerationStore((s) => (node ? s.status[node.id] : undefined));

  if (!node) return null;
  const count = node.results.length;
  const idx = node.currentResultIndex;
  const busy = status === "generating";

  // Recompute on every render is cheap; draftBoxesLen keeps this reactive to edits.
  void draftBoxesLen;
  const dirty = isDraftDirty();
  const generateLabel = count === 0 ? "Generate" : dirty ? "Generate ▸ branch" : "Generate";

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1">
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

      <div className="flex-1" />

      <Button
        variant="default"
        disabled={busy || count === 0}
        onClick={() => regenerate()}
        title="Append another result to this node (new seed)"
      >
        Regenerate
      </Button>
      <Button variant="accent" disabled={busy} onClick={() => generate()} title="Generate">
        {busy ? "Generating…" : generateLabel}
      </Button>
    </div>
  );
}
