// ───────────────────────────────────────────────────────────────────────────
// services/layout.ts — Pure graph auto-layout for the node-history graph.
//
// The scene is a tree of GraphNodes linked by `parentId` (root.parentId ===
// null). We lay it out left→right by depth, with branches fanning upward.
// See Plan.md → "Graph view (React Flow) + layout engine".
//
// MODEL
//   • column = depth from root (root = column 0). X grows left→right:
//       x = column * COL_SPACING.
//   • lane   = a horizontal track. Lane 0 is the baseline; branches go UP,
//     which in React Flow (Y grows downward) means more-NEGATIVE lanes:
//       y = lane * LANE_SPACING   (lane 0 → 0, lane -1 → -200, …).
//
// ALGORITHM
//   • Children of a node are ordered by `createdAt` ascending (id as a stable
//     tiebreak). The FIRST (earliest) child continues the parent's lane — so
//     the primary first-child chain from the root stays on lane 0. Every
//     ADDITIONAL child starts a NEW branch placed on the nearest free lane up.
//   • "nearest free lane up": from (parentLane − 1) scan to more-negative lanes
//     and take the first lane whose reserved column-intervals don't overlap the
//     new subtree's column span.
//   • OVERLAP PACKING (the reservation choice): when a branch is placed on a
//     lane we reserve that branch's WHOLE subtree column span
//     [col(branchRoot), maxColumn(subtree)] on that lane. This conservative
//     bounding-interval reservation guarantees two subtrees never overlap on a
//     lane, while still letting column-disjoint subtrees share a lane (good
//     packing). First-child (inherited-lane) nodes need no reservation: they
//     live inside their branch-root's reserved span, and lane 0 / a parent's
//     own lane is never offered to other branches (scanning only ever goes
//     strictly UP from the parent), so the primary chain is implicitly safe.
//
// Fully deterministic & side-effect-free: no Math.random, no Date.now, inputs
// are never mutated.
// ───────────────────────────────────────────────────────────────────────────

import type { GraphNode, ID } from "../types";

const COL_SPACING = 200;
const LANE_SPACING = 200;

/** Deterministic child ordering: earliest createdAt first, id as tiebreak. */
function makeComparator(nodes: Record<ID, GraphNode>) {
  return (a: ID, b: ID): number => {
    const da = nodes[a].createdAt;
    const db = nodes[b].createdAt;
    if (da !== db) return da - db;
    return a < b ? -1 : a > b ? 1 : 0;
  };
}

export function computeLayout(
  nodes: Record<ID, GraphNode>,
  rootId: ID,
): Record<ID, { x: number; y: number }> {
  const result: Record<ID, { x: number; y: number }> = {};

  // Degenerate input: no root → nothing to lay out.
  if (!nodes[rootId]) return result;

  const ids = Object.keys(nodes);
  const cmp = makeComparator(nodes);

  // 1. Build children lists. A null/dangling/self-referential parentId is
  //    treated as root-level (attached as a child of the root) defensively.
  const childrenOf: Record<ID, ID[]> = {};
  for (const id of ids) childrenOf[id] = [];
  for (const id of ids) {
    if (id === rootId) continue;
    const p = nodes[id].parentId;
    const eff = p != null && p !== id && nodes[p] ? p : rootId;
    childrenOf[eff].push(id);
  }
  for (const id of ids) childrenOf[id].sort(cmp);

  // 2. Defensive: ensure every node is reachable from the root. parentId
  //    cycles that don't include the root would otherwise leave nodes
  //    unplaced — attach each unreachable component's representative to the
  //    root (deterministic order). A visited guard breaks the cycle.
  const reachable = new Set<ID>();
  const markReach = (start: ID): void => {
    const stack: ID[] = [start];
    while (stack.length) {
      const n = stack.pop()!;
      if (reachable.has(n)) continue;
      reachable.add(n);
      for (const c of childrenOf[n]) stack.push(c);
    }
  };
  markReach(rootId);
  if (reachable.size < ids.length) {
    const stranded = ids.filter((id) => !reachable.has(id)).sort(cmp);
    for (const o of stranded) {
      if (reachable.has(o)) continue;
      childrenOf[rootId].push(o);
      markReach(o);
    }
  }

  // 3. Column (depth) + a clean BFS tree (skips any residual back-edges so the
  //    later recursions can't loop). treeChildren preserves the sorted order.
  const col: Record<ID, number> = { [rootId]: 0 };
  const treeChildren: Record<ID, ID[]> = {};
  for (const id of ids) treeChildren[id] = [];
  const seen = new Set<ID>([rootId]);
  const queue: ID[] = [rootId];
  while (queue.length) {
    const n = queue.shift()!;
    for (const c of childrenOf[n]) {
      if (seen.has(c)) continue;
      seen.add(c);
      col[c] = col[n] + 1;
      treeChildren[n].push(c);
      queue.push(c);
    }
  }

  // 4. Max column reached within each subtree (min column is the node's own).
  const subtreeMaxCol: Record<ID, number> = {};
  const computeMax = (id: ID): number => {
    let m = col[id];
    for (const c of treeChildren[id]) m = Math.max(m, computeMax(c));
    subtreeMaxCol[id] = m;
    return m;
  };
  computeMax(rootId);

  // 5. Per-lane occupied column-interval packing.
  const laneIntervals = new Map<number, Array<[number, number]>>();
  const overlaps = (lane: number, lo: number, hi: number): boolean => {
    const arr = laneIntervals.get(lane);
    if (!arr) return false;
    for (const [a, b] of arr) if (lo <= b && a <= hi) return true;
    return false;
  };
  const reserve = (lane: number, lo: number, hi: number): void => {
    const arr = laneIntervals.get(lane);
    if (arr) arr.push([lo, hi]);
    else laneIntervals.set(lane, [[lo, hi]]);
  };
  // Nearest free lane strictly UP (more negative) from the parent's lane.
  const findFreeLaneUp = (parentLane: number, lo: number, hi: number): number => {
    let lane = parentLane - 1;
    while (overlaps(lane, lo, hi)) lane--;
    return lane;
  };

  // 6. Pre-order placement: first child inherits the lane (primary chain),
  //    each later child branches up onto its nearest free lane.
  const laneOf: Record<ID, number> = {};
  const place = (id: ID, lane: number): void => {
    laneOf[id] = lane;
    const kids = treeChildren[id];
    for (let i = 0; i < kids.length; i++) {
      const c = kids[i];
      let childLane: number;
      if (i === 0) {
        childLane = lane; // inherit — stays within an ancestor's reserved span
      } else {
        const lo = col[c];
        const hi = subtreeMaxCol[c];
        childLane = findFreeLaneUp(lane, lo, hi);
        reserve(childLane, lo, hi);
      }
      place(c, childLane);
    }
  };
  place(rootId, 0);

  // 7. (column, lane) → pixels.
  for (const id of ids) {
    if (laneOf[id] === undefined) continue; // unreachable safety net
    result[id] = { x: col[id] * COL_SPACING, y: laneOf[id] * LANE_SPACING };
  }
  return result;
}
