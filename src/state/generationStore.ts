// ───────────────────────────────────────────────────────────────────────────
// Generation queue + per-node status. Implements the Generate/Regenerate flow:
//   • current node has 0 results            → fill this node
//   • has results AND draft changed         → branch a new child node
//   • has results AND draft unchanged        → regenerate (append a result)
// A small concurrency-limited queue (≤10 in-flight) matches Ideogram's default
// rate limit. Each returned image becomes a GenerationResult (blob stored locally).
// ───────────────────────────────────────────────────────────────────────────
import { create } from "zustand";
import type { ID, GenerationResult } from "../types";
import { useSceneStore, currentNode } from "./sceneStore";
import { clonePrompt } from "./factory";
import { useSettingsStore } from "./settingsStore";
import { generateImage } from "../services/ideogram";
import { generateImageViaFal } from "../services/fal";
import { downloadAndStore, downloadAndStoreDirect, storeImageBlob } from "../services/images";
import { renderMockImage } from "../services/mockImage";
import { newId } from "../util/id";

export type GenStatus = "idle" | "generating" | "error";

const MAX_INFLIGHT = 10;

interface Task {
  nodeId: ID;
}

interface GenerationState {
  status: Record<ID, GenStatus>;
  errors: Record<ID, string>;
  inflight: number;
  generate: () => void;
  regenerate: (nodeId?: ID) => void;
  clearError: (nodeId: ID) => void;
}

const queue: Task[] = [];
let running = 0;

export const useGenerationStore = create<GenerationState>((set, get) => ({
  status: {},
  errors: {},
  inflight: 0,

  generate: () => {
    const sceneState = useSceneStore.getState();
    const scene = sceneState.scene;
    if (!scene || !sceneState.draft) return;
    const node = currentNode(scene);

    if (node.results.length === 0) {
      // First image for this (editable) node: commit the prompt, then generate.
      sceneState.commitDraftToCurrentNode();
      enqueue(node.id, set, get);
    } else {
      // Node already has an image (prompt locked) → append another result. There's
      // no implicit branch-on-edit anymore; branching is explicit (Edit/Branch).
      enqueue(node.id, set, get);
    }
  },

  regenerate: (nodeId) => {
    const scene = useSceneStore.getState().scene;
    if (!scene) return;
    enqueue(nodeId ?? scene.currentNodeId, set, get);
  },

  clearError: (nodeId) =>
    set((s) => {
      const errors = { ...s.errors };
      delete errors[nodeId];
      const status = { ...s.status, [nodeId]: "idle" as GenStatus };
      return { errors, status };
    }),
}));

type SetFn = (
  partial: Partial<GenerationState> | ((s: GenerationState) => Partial<GenerationState>)
) => void;
type GetFn = () => GenerationState;

function enqueue(nodeId: ID, set: SetFn, get: GetFn): void {
  set((s) => ({
    status: { ...s.status, [nodeId]: "generating" },
    errors: stripKey(s.errors, nodeId),
  }));
  queue.push({ nodeId });
  pump(set, get);
}

function pump(set: SetFn, get: GetFn): void {
  while (running < MAX_INFLIGHT && queue.length > 0) {
    const task = queue.shift()!;
    running++;
    set({ inflight: running });
    runTask(task)
      .then(() => {
        set((s) => ({ status: { ...s.status, [task.nodeId]: "idle" } }));
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        set((s) => ({
          status: { ...s.status, [task.nodeId]: "error" },
          errors: { ...s.errors, [task.nodeId]: message },
        }));
      })
      .finally(() => {
        running--;
        set({ inflight: running });
        pump(set, get);
      });
  }
}

async function runTask(task: Task): Promise<void> {
  const scene = useSceneStore.getState().scene;
  const node = scene?.nodes[task.nodeId];
  if (!node) return;

  const settings = useSettingsStore.getState();
  const usingFal = settings.provider === "fal";
  const apiKey = usingFal ? settings.falApiKey : settings.apiKey;
  if (!apiKey) {
    // Testing mode: no API key for the active provider → synthesize a placeholder
    // image locally so the full Generate / Regenerate / branch flow works offline.
    const { blob } = await renderMockImage(node.prompt);
    const stored = await storeImageBlob(blob);
    const result: GenerationResult = {
      id: newId(),
      imageId: stored.imageId,
      thumbnailId: stored.thumbnailId,
      seed: Math.floor(Math.random() * 1_000_000),
      resolution: node.prompt.resolution,
      isImageSafe: true,
      promptSnapshot: clonePrompt(node.prompt),
      createdAt: Date.now(),
    };
    useSceneStore.getState().appendResult(task.nodeId, result);
    return;
  }

  const resp = usingFal
    ? await generateImageViaFal(node.prompt, apiKey)
    : await generateImage(node.prompt, apiKey, settings.enableCopyrightDetection);

  if (resp.data.length === 0) {
    throw new Error(usingFal ? "Fal.ai returned no images." : "Ideogram returned no images.");
  }

  for (const img of resp.data) {
    // Fal serves CORS-enabled (data:) URLs → fetch directly; Ideogram URLs are
    // CORS-blocked + expiring → relay through the /api/image proxy.
    const stored = usingFal
      ? await downloadAndStoreDirect(img.url)
      : await downloadAndStore(img.url);
    const result: GenerationResult = {
      id: newId(),
      imageId: stored.imageId,
      thumbnailId: stored.thumbnailId,
      seed: img.seed,
      resolution: img.resolution ?? node.prompt.resolution,
      isImageSafe: img.is_image_safe,
      promptSnapshot: clonePrompt(node.prompt),
      createdAt: Date.now(),
      // Fal's is a transient data: URI (huge, not a stable ref) → don't persist it.
      sourceUrl: usingFal ? undefined : img.url,
    };
    useSceneStore.getState().appendResult(task.nodeId, result);
  }
}

function stripKey<T>(obj: Record<string, T>, key: string): Record<string, T> {
  if (!(key in obj)) return obj;
  const next = { ...obj };
  delete next[key];
  return next;
}
