import { useSceneStore } from "../../state/sceneStore";
import type { Scene, ID } from "../../types";

function pathToRoot(scene: Scene): ID[] {
  const path: ID[] = [];
  let cur: ID | null = scene.currentNodeId;
  const seen = new Set<ID>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    path.push(cur);
    cur = scene.nodes[cur]?.parentId ?? null;
  }
  return path.reverse();
}

export function Breadcrumb() {
  const scene = useSceneStore((s) => s.scene);
  const selectNode = useSceneStore((s) => s.selectNode);
  if (!scene) return null;
  const path = pathToRoot(scene);

  return (
    <div className="flex flex-wrap items-center gap-1 text-xs text-ink-faint">
      {path.map((id, i) => {
        const isCurrent = id === scene.currentNodeId;
        return (
          <span key={id} className="flex items-center gap-1">
            {i > 0 && <span className="text-ink-faint">/</span>}
            <button
              className={`rounded px-1.5 py-0.5 hover:bg-surface-2 ${
                isCurrent ? "text-accent font-medium" : "hover:text-ink"
              }`}
              onClick={() => selectNode(id)}
              title={id}
            >
              {i === 0 ? "root" : `#${i}`}
            </button>
          </span>
        );
      })}
    </div>
  );
}
