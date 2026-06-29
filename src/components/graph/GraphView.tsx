// Milestone 6 — React Flow graph of the iteration/branching history.
// Auto-laid-out (layout.ts), read-only nodes: click selects, double-click opens
// the node in the focus view. Viewport is persisted to the UI store on move end.
import { useEffect, useMemo, useRef } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  BaseEdge,
  getSmoothStepPath,
  useReactFlow,
} from "@xyflow/react";
import type { Node, Edge, NodeTypes, EdgeTypes, EdgeProps } from "@xyflow/react";
import { useSceneStore } from "../../state/sceneStore";
import { useUiStore } from "../../state/uiStore";
import { GraphNode } from "./GraphNode";
import type { IdeoNodeData } from "./GraphNode";

// Memoized outside the component so React Flow doesn't warn about a fresh object.
const NODE_TYPES: NodeTypes = { ideo: GraphNode };

// Orthogonal (right-angle, straight-line) edge. Routes right → up/down → right,
// with the first turn at 25% of the horizontal span so a branch's initial segment
// overlaps the straight edge to the same-lane (primary) child. borderRadius 0 →
// sharp corners.
function OrthoEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
}: EdgeProps) {
  const centerX = sourceX + (targetX - sourceX) * 0.25;
  const [path] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 0,
    centerX,
  });
  return <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />;
}

const EDGE_TYPES: EdgeTypes = { ortho: OrthoEdge };

function GraphInner() {
  const scene = useSceneStore((s) => s.scene);
  const rf = useReactFlow();
  const wrapperRef = useRef<HTMLDivElement>(null);

  // `f` → frame the selected (or current) node(s): center them and zoom so they
  // fill ~60% of the viewport's constraining dimension.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "f" || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (useUiStore.getState().viewMode !== "graph") return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)
      )
        return;
      const s = useSceneStore.getState().scene;
      if (!s) return;
      const selectedIds = rf.getNodes().filter((n) => n.selected).map((n) => n.id);
      const ids = selectedIds.length ? selectedIds : [s.currentNodeId];
      const targets = ids
        .map((id) => rf.getNode(id))
        .filter((n): n is NonNullable<typeof n> => !!n);
      if (!targets.length) return;
      e.preventDefault();

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const n of targets) {
        const w = n.measured?.width ?? 150;
        const h = n.measured?.height ?? 150;
        minX = Math.min(minX, n.position.x);
        minY = Math.min(minY, n.position.y);
        maxX = Math.max(maxX, n.position.x + w);
        maxY = Math.max(maxY, n.position.y + h);
      }
      const bw = Math.max(1, maxX - minX);
      const bh = Math.max(1, maxY - minY);
      const vpW = wrapperRef.current?.clientWidth ?? 0;
      const vpH = wrapperRef.current?.clientHeight ?? 0;
      if (!vpW || !vpH) return;
      const zoom = Math.min((0.6 * vpW) / bw, (0.6 * vpH) / bh);
      rf.setCenter((minX + maxX) / 2, (minY + maxY) / 2, { zoom, duration: 300 });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rf]);

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

  // Positions are derived (deterministic auto-layout, not user-editable), so
  // recompute on mount + structural changes. Recomputing on entry also lets
  // layout-constant tweaks (e.g. column spacing) apply to existing scenes.
  useEffect(() => {
    if (useSceneStore.getState().scene) useSceneStore.getState().recomputeLayout();
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
        out.push({ id: `${n.parentId}->${n.id}`, source: n.parentId, target: n.id, type: "ortho" });
      }
    }
    return out;
  }, [scene]);

  // Constrain panning to the node bounding box expanded by 25% on each side. This
  // also keeps the minimap framed on the nodes (its viewBox unions the viewport),
  // so nodes don't shrink to invisible specks when you pan away.
  const translateExtent = useMemo<[[number, number], [number, number]] | undefined>(() => {
    if (!scene) return undefined;
    const positions = Object.values(scene.nodes)
      .map((n) => n.pos)
      .filter((p): p is { x: number; y: number } => !!p);
    if (!positions.length) return undefined;
    const NODE = 150;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of positions) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + NODE);
      maxY = Math.max(maxY, p.y + NODE);
    }
    const padX = (maxX - minX) * 0.25;
    const padY = (maxY - minY) * 0.25;
    return [
      [minX - padX, minY - padY],
      [maxX + padX, maxY + padY],
    ];
  }, [scene]);

  return (
    <div ref={wrapperRef} className="min-h-0 w-full flex-1">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        defaultViewport={useUiStore.getState().viewport}
        maxZoom={4}
        translateExtent={translateExtent}
        zoomOnDoubleClick={false}
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
        <Controls showInteractive={false} />
        {/* MiniMap hidden for now — may revisit later. */}
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
