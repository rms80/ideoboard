import type { CSSProperties } from "react";
import { useSceneStore } from "../../state/sceneStore";
import { useGenerationStore } from "../../state/generationStore";
import { useUiStore } from "../../state/uiStore";
import type { BoxTool } from "../../state/uiStore";
import { useObjectUrl } from "../../hooks/useObjectUrl";
import { Button } from "../common/ui";
import { BoxLayer } from "./BoxLayer";

const BOX_TOOLS: { tool: BoxTool; label: string }[] = [
  { tool: "select", label: "Select" },
  { tool: "text", label: "+Text" },
  { tool: "obj", label: "+Object" },
];

/** Derive a CSS aspect-ratio style from a "WxH" resolution for the empty draw surface. */
function emptyAspectStyle(resolution: string | undefined): CSSProperties {
  const [w, h] = (resolution ?? "").split("x").map(Number);
  const ratio = Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? w / h : 1;
  const primary = ratio >= 1 ? { width: "min(100%, 70vh)" } : { height: "min(100%, 70vh)" };
  return { aspectRatio: String(ratio), ...primary };
}

export function ImageStage() {
  const scene = useSceneStore((s) => s.scene);
  const resolution = useSceneStore((s) => s.draft?.resolution);
  const node = scene ? scene.nodes[scene.currentNodeId] : null;
  const result =
    node && node.results.length ? node.results[node.currentResultIndex] : undefined;
  const url = useObjectUrl(result?.imageId, "image");

  const status = useGenerationStore((s) => (node ? s.status[node.id] : undefined));
  const error = useGenerationStore((s) => (node ? s.errors[node.id] : undefined));
  const clearError = useGenerationStore((s) => s.clearError);
  const regenerate = useGenerationStore((s) => s.regenerate);

  const boxTool = useUiStore((s) => s.boxTool);
  const setBoxTool = useUiStore((s) => s.setBoxTool);

  return (
    <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg border border-border bg-surface-0">
      {/* Box tool toolbar */}
      <div className="absolute left-2 top-2 z-20 flex gap-1 rounded-md border border-border bg-surface-2/90 p-1 backdrop-blur">
        {BOX_TOOLS.map(({ tool, label }) => (
          <button
            key={tool}
            type="button"
            onClick={() => setBoxTool(tool)}
            className={`rounded px-2 py-1 text-xs font-medium transition ${
              boxTool === tool
                ? "bg-accent text-white"
                : "text-ink-dim hover:bg-surface-3 hover:text-ink"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {url ? (
        <div className="relative max-h-full max-w-full">
          <img
            src={url}
            alt={result?.promptSnapshot.highLevelDescription || "result"}
            className="block max-h-full max-w-full select-none object-contain"
            draggable={false}
          />
          <BoxLayer />
        </div>
      ) : (
        <div
          className="relative max-h-full max-w-full rounded border border-dashed border-border/60 bg-surface-0"
          style={emptyAspectStyle(resolution)}
        >
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 text-ink-faint">
            <div className="text-4xl">◇</div>
            <div className="text-sm">No image yet — write a prompt and Generate.</div>
          </div>
          <BoxLayer />
        </div>
      )}

      {status === "generating" && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="flex items-center gap-2 text-ink">
            <Spinner /> Generating…
          </div>
        </div>
      )}

      {status === "error" && node && (
        <div className="absolute inset-x-3 bottom-3 z-30 flex items-start gap-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-ink">
          <div className="flex-1">
            <div className="font-medium text-danger">Generation failed</div>
            <div className="text-ink-dim">{error}</div>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => clearError(node.id)}>
              Dismiss
            </Button>
            <Button
              variant="default"
              onClick={() => {
                clearError(node.id);
                regenerate(node.id);
              }}
            >
              Retry
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-ink-faint border-t-accent" />
  );
}
