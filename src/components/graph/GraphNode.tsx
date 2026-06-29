// Custom React Flow node for the iteration-history graph (Milestone 6).
// Renders the node's current-result thumbnail + result-count badge + status,
// highlights the current node, and exposes subtle parent/child handles.
import { memo } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { Handle, Position, useStore } from "@xyflow/react";
import type { NodeProps, Node } from "@xyflow/react";
import { useSceneStore } from "../../state/sceneStore";
import { useGenerationStore } from "../../state/generationStore";
import { useObjectUrl } from "../../hooks/useObjectUrl";

export type IdeoNodeData = { nodeId: string };
export type IdeoNode = Node<IdeoNodeData, "ideo">;

// Connection handles kept (edges anchor to them) but visually hidden — no dots.
const HANDLE_CLASS =
  "!h-px !w-px !min-h-0 !min-w-0 !border-0 !bg-transparent opacity-0";

// Stroke-rendered chevron so the arrow's visible height matches the digits beside it.
function Chevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-3.5 w-3"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points={dir === "left" ? "10 3 5 8 10 13" : "6 3 11 8 6 13"} />
    </svg>
  );
}

function GraphNodeImpl({ data }: NodeProps<IdeoNode>) {
  const nodeId = data.nodeId;
  const node = useSceneStore((s) => s.scene?.nodes[nodeId]);
  const isCurrent = useSceneStore((s) => s.scene?.currentNodeId === nodeId);
  const status = useGenerationStore((s) => s.status[nodeId]);
  // Live viewport zoom → counter-scale the index overlay so it stays a constant
  // screen size (and shrinks relative to the image as you zoom in).
  const zoom = useStore((s) => s.transform[2]) || 1;

  const setCurrentResultIndex = useSceneStore((s) => s.setCurrentResultIndex);

  const result = node && node.results.length ? node.results[node.currentResultIndex] : undefined;
  const url = useObjectUrl(result?.thumbnailId, "thumb");

  const resultCount = node?.results.length ?? 0;
  const idx = node?.currentResultIndex ?? 0;
  const note = node?.note?.trim() ?? "";
  // Counter-scale factor: keeps the label's font/padding a constant screen size, so
  // the node-width box reveals more text as you zoom in.
  const s = 1 / zoom;
  const cycle = (delta: number) => (e: ReactMouseEvent) => {
    e.stopPropagation();
    if (resultCount > 1) setCurrentResultIndex(nodeId, (idx + delta + resultCount) % resultCount);
  };

  return (
    <div className="relative h-[140px] w-[140px]">
      <Handle type="target" position={Position.Left} isConnectable={false} className={HANDLE_CLASS} />

      {/* Description label above the node: capped at node width, single line + "…".
          Font/padding counter-scale so it stays readable; the box scales with zoom. */}
      {note && (
        <div
          className="pointer-events-none absolute bottom-full left-1/2 max-w-full -translate-x-1/2 truncate bg-surface-2/90 text-ink"
          title={note}
          style={{
            fontSize: `${11 * s}px`,
            lineHeight: 1.4,
            padding: `${2 * s}px ${5 * s}px`,
            marginBottom: `${4 * s}px`,
            borderRadius: `${3 * s}px`,
          }}
        >
          {note}
        </div>
      )}

      <div className="relative h-full w-full overflow-hidden bg-surface-2">
        {url ? (
          <img
            src={url}
            alt={result?.promptSnapshot.highLevelDescription || "result"}
            className="h-full w-full select-none object-cover"
            draggable={false}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-3xl text-ink-faint">
            ◇
          </div>
        )}

        {resultCount > 1 && (
          <div
            className="absolute right-1 top-1 flex items-stretch overflow-hidden rounded bg-surface-0/15 text-xs font-medium text-ink"
            style={{ transform: `scale(${1 / zoom})`, transformOrigin: "top right" }}
            // Swallow double-clicks so fast cycling never zooms / opens the node.
            onDoubleClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
            }}
          >
            <button
              type="button"
              title="Previous image"
              className="flex items-center px-1 text-ink-dim transition hover:bg-ink/10 hover:text-accent"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={cycle(-1)}
            >
              <Chevron dir="left" />
            </button>
            <span className="flex items-center px-1 tabular-nums leading-none">
              {idx + 1}/{resultCount}
            </span>
            <button
              type="button"
              title="Next image"
              className="flex items-center px-1 text-ink-dim transition hover:bg-ink/10 hover:text-accent"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={cycle(1)}
            >
              <Chevron dir="right" />
            </button>
          </div>
        )}

        {status === "error" && (
          <div
            className="absolute left-1 top-1 h-2.5 w-2.5 rounded-full bg-danger ring-2 ring-surface-0"
            title="Generation failed"
          />
        )}

        {status === "generating" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm">
            <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-ink-faint border-t-accent" />
          </div>
        )}
      </div>

      {/* Selected node: tight outline straddling the image edges (1px out / 1px in).
          Rendered outside the overflow-hidden image so the outer half isn't clipped.
          Orange to match the selected-box outline in the focus view. */}
      {isCurrent && (
        <div
          className="pointer-events-none absolute -inset-px border-2"
          style={{ borderColor: "#f97316" }}
        />
      )}

      <Handle type="source" position={Position.Right} isConnectable={false} className={HANDLE_CLASS} />
    </div>
  );
}

export const GraphNode = memo(GraphNodeImpl);
