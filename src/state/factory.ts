// Factory helpers for creating empty scenes / nodes / prompts.
import { newId } from "../util/id";
import {
  DEFAULT_RESOLUTION,
  DEFAULT_RENDERING_SPEED,
  type ID,
  type Scene,
  type GraphNode,
  type StructuredPrompt,
  type RenderingSpeed,
} from "../types";

export interface PromptDefaults {
  resolution?: string;
  renderingSpeed?: RenderingSpeed;
}

export function createEmptyPrompt(defaults?: PromptDefaults): StructuredPrompt {
  return {
    highLevelDescription: "",
    background: "",
    style: {},
    boxes: [],
    tags: [],
    resolution: defaults?.resolution ?? DEFAULT_RESOLUTION,
    renderingSpeed: defaults?.renderingSpeed ?? DEFAULT_RENDERING_SPEED,
  };
}

export function createNode(
  parentId: ID | null,
  prompt: StructuredPrompt,
  createdAt: number
): GraphNode {
  return {
    id: newId(),
    parentId,
    prompt,
    results: [],
    currentResultIndex: 0,
    createdAt,
  };
}

export function createScene(
  name: string,
  defaults: { resolution: string; renderingSpeed: RenderingSpeed },
  now: number
): Scene {
  const root = createNode(null, createEmptyPrompt(defaults), now);
  root.pos = { x: 0, y: 0 };
  return {
    id: newId(),
    name,
    createdAt: now,
    updatedAt: now,
    nodes: { [root.id]: root },
    rootId: root.id,
    currentNodeId: root.id,
    viewport: { x: 0, y: 0, zoom: 1 },
    defaults: { ...defaults },
  };
}

/** Deep clone a prompt (no shared references with the source). */
export function clonePrompt(p: StructuredPrompt): StructuredPrompt {
  return structuredClone(p);
}
