// Scene list + current-scene management (CRUD). Not history-tracked. Coordinates
// the working sceneStore, IndexedDB, settings defaults, and object-URL cleanup.
import { create } from "zustand";
import type { ID } from "../types";
import { createScene } from "./factory";
import { useSceneStore } from "./sceneStore";
import { useUiStore } from "./uiStore";
import { useSettingsStore } from "./settingsStore";
import {
  saveScene,
  loadScene,
  loadAllScenes,
  deleteScene as dbDeleteScene,
  deleteImageBlob,
  deleteThumbnailBlob,
} from "../services/db";
import { revokeAllObjectURLs } from "../services/images";
import { downloadSceneZip, importSceneZip } from "../services/exchange";

export interface SceneMeta {
  id: ID;
  name: string;
  updatedAt: number;
}

interface ScenesState {
  scenes: SceneMeta[];
  currentSceneId: ID | null;
  refresh: () => Promise<void>;
  createScene: (name?: string) => Promise<ID>;
  switchScene: (id: ID) => Promise<void>;
  deleteScene: (id: ID) => Promise<void>;
  renameScene: (id: ID, name: string) => Promise<void>;
  exportCurrent: () => Promise<void>;
  importZip: (file: File | Blob) => Promise<void>;
}

/** Delete blobs from a removed scene that no remaining scene still references. */
async function gcOrphanBlobs(removed: import("../types").Scene): Promise<void> {
  const remaining = await loadAllScenes();
  const referenced = new Set<string>();
  for (const sc of remaining) {
    for (const node of Object.values(sc.nodes)) {
      for (const r of node.results) {
        if (r.imageId) referenced.add(r.imageId);
        if (r.thumbnailId) referenced.add(r.thumbnailId);
      }
      if (node.guideImageId) referenced.add(node.guideImageId);
    }
  }
  for (const node of Object.values(removed.nodes)) {
    for (const r of node.results) {
      if (r.imageId && !referenced.has(r.imageId)) await deleteImageBlob(r.imageId);
      if (r.thumbnailId && !referenced.has(r.thumbnailId))
        await deleteThumbnailBlob(r.thumbnailId);
    }
    if (node.guideImageId && !referenced.has(node.guideImageId))
      await deleteImageBlob(node.guideImageId);
  }
}

function defaults() {
  const s = useSettingsStore.getState();
  return { resolution: s.defaultResolution, renderingSpeed: s.defaultRenderingSpeed };
}

function loadIntoEditor(scene: import("../types").Scene) {
  revokeAllObjectURLs();
  useSceneStore.getState().setScene(scene);
  useUiStore.getState().setViewport(scene.viewport ?? { x: 0, y: 0, zoom: 1 });
}

export const useScenesStore = create<ScenesState>((set, get) => ({
  scenes: [],
  currentSceneId: null,

  refresh: async () => {
    const all = await loadAllScenes();
    set({
      scenes: all.map((s) => ({ id: s.id, name: s.name, updatedAt: s.updatedAt })),
    });
  },

  createScene: async (name) => {
    const scene = createScene(name?.trim() || "Untitled", defaults(), Date.now());
    await saveScene(scene);
    loadIntoEditor(scene);
    set({ currentSceneId: scene.id });
    await get().refresh();
    return scene.id;
  },

  switchScene: async (id) => {
    if (id === get().currentSceneId) return;
    const scene = await loadScene(id);
    if (!scene) return;
    loadIntoEditor(scene);
    set({ currentSceneId: id });
  },

  deleteScene: async (id) => {
    const removed = await loadScene(id);
    await dbDeleteScene(id);
    const wasCurrent = get().currentSceneId === id;
    await get().refresh();
    if (removed) await gcOrphanBlobs(removed);
    if (wasCurrent) {
      const next = get().scenes[0];
      if (next) await get().switchScene(next.id);
      else await get().createScene("Untitled");
    }
  },

  renameScene: async (id, name) => {
    const trimmed = name.trim() || "Untitled";
    if (id === get().currentSceneId) {
      useSceneStore.getState().renameWorkingScene(trimmed);
    } else {
      const scene = await loadScene(id);
      if (scene) {
        scene.name = trimmed;
        scene.updatedAt = Date.now();
        await saveScene(scene);
      }
    }
    await get().refresh();
  },

  exportCurrent: async () => {
    const id = get().currentSceneId;
    if (id) await downloadSceneZip(id);
  },

  importZip: async (file) => {
    const id = await importSceneZip(file);
    await get().refresh();
    set({ currentSceneId: null }); // force switchScene to load (it early-returns on same id)
    await get().switchScene(id);
  },
}));
