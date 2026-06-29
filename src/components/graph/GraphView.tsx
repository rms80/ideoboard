// Milestone 6 — React Flow graph of the iteration/branching history.
// Auto-laid-out (layout.ts), read-only nodes: click selects, double-click opens
// the node in the focus view. Viewport is persisted to the UI store on move end.
import { useEffect, useMemo } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
} from "@xyflow/react";
import type { Node, Edge, NodeTypes } from "@xyflow/react";
import { useSceneStore } from "../../state/sceneStore";
import { useUiStore } from "../../state/uiStore";
import { GraphNode } from "./GraphNode";
import type { IdeoNodeData } from "./GraphNode";

// Memoized outside the component so React Flow doesn't warn about a fresh object.
const NODE_TYPES: NodeTypes = { ideo: GraphNode };

function GraphInner() {
  const scene = useSceneStore((s) => s.scene);

  // A key that changes whenever the tree's node set / parent links change.
  const structureKey = useMemo(
    () =>
      scene
        ? Object.values(scene.nodes)
            .map((n) => `${n.id}:${n.parentId ?? ""}`)
            .sort()
            .join("|")
        : "",
    [scene],
  );

  // Ensure every node has a cached position (on mount + structural changes).
  useEffect(() => {
    const s = useSceneStore.getState().scene;
    if (!s) return;
    if (Object.values(s.nodes).some((n) => !n.pos)) {
      useSceneStore.getState().recomputeLayout();
    }
  }, [structureKey]);

  const nodes: Node<IdeoNodeData>[] = useMemo(() => {
    if (!scene) return [];
    return Object.values(scene.nodes).map((n) => ({
      id: n.id,
      type: "ideo",
      position: n.pos ?? { x: 0, y: 0 },
      data: { nodeId: n.id },
    }));
  }, [scene]);

  const edges: Edge[] = useMemo(() => {
    if (!scene) return [];
    const out: Edge[] = [];
    for (const n of Object.values(scene.nodes)) {
      if (n.parentId && scene.nodes[n.parentId]) {
        out.push({ id: `${n.parentId}->${n.id}`, source: n.parentId, target: n.id });
      }
    }
    return out;
  }, [scene]);

  return (
    <div className="min-h-0 w-full flex-1">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        defaultViewport={useUiStore.getState().viewport}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_, node) => useSceneStore.getState().selectNode(node.id)}
        onNodeDoubleClick={(_, node) => {
          useSceneStore.getState().selectNode(node.id);
          useUiStore.getState().setViewMode("focus");
        }}
        onMoveEnd={(_, viewport) => useUiStore.getState().setViewport(viewport)}
        style={{ width: "100%", height: "100%" }}
      >
        <Background />
        <Controls />
        <MiniMap pannable zoomable />
      </ReactFlow>
    </div>
  );
}

export function GraphView() {
  return (
    <ReactFlowProvider>
      <GraphInner />
    </ReactFlowProvider>
  );
}
