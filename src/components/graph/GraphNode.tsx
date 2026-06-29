// Custom React Flow node for the iteration-history graph (Milestone 6).
// Renders the node's current-result thumbnail + result-count badge + status,
// highlights the current node, and exposes subtle parent/child handles.
import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import type { NodeProps, Node } from "@xyflow/react";
import { useSceneStore } from "../../state/sceneStore";
import { useGenerationStore } from "../../state/generationStore";
import { useObjectUrl } from "../../hooks/useObjectUrl";

export type IdeoNodeData = { nodeId: string };
export type IdeoNode = Node<IdeoNodeData, "ideo">;

// Subtle, non-interactive connection handles (left = from parent, right = to children).
const HANDLE_CLASS =
  "!h-1.5 !w-1.5 !min-h-0 !min-w-0 !border-0 !bg-ink-faint opacity-30";

function GraphNodeImpl({ data }: NodeProps<IdeoNode>) {
  const nodeId = data.nodeId;
  const node = useSceneStore((s) => s.scene?.nodes[nodeId]);
  const isCurrent = useSceneStore((s) => s.scene?.currentNodeId === nodeId);
  const status = useGenerationStore((s) => s.status[nodeId]);

  const result = node && node.results.length ? node.results[node.currentResultIndex] : undefined;
  const url = useObjectUrl(result?.thumbnailId, "thumb");

  const resultCount = node?.results.length ?? 0;

  return (
    <div
      className={`relative rounded-lg border bg-surface-1 p-1 transition ${
        isCurrent ? "border-accent ring-2 ring-accent" : "border-border"
      }`}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} className={HANDLE_CLASS} />

      <div className="relative h-[140px] w-[140px] overflow-hidden rounded-md bg-surface-2">
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
          <div className="absolute right-1 top-1 min-w-5 rounded-full bg-surface-0/80 px-1.5 py-0.5 text-center text-xs font-medium text-ink">
            {resultCount}
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

      <Handle type="source" position={Position.Right} isConnectable={false} className={HANDLE_CLASS} />
    </div>
  );
}

export const GraphNode = memo(GraphNodeImpl);
