// ───────────────────────────────────────────────────────────────────────────
// services/db.ts — Thin IndexedDB wrapper over `idb` (Jake Archibald).
//
// One database "ideoboard" (v1) with three object stores:
//   - "scenes"     keyPath "id"        → Scene JSON objects
//   - "images"     out-of-line keys    → image Blobs, keyed by imageId (string)
//   - "thumbnails" out-of-line keys    → thumbnail Blobs, keyed by thumbnailId
//
// Persistence split (see Plan.md → "State, persistence, autosave"): scene JSON
// stores only imageId/thumbnailId references; the actual blobs live here. Uses a
// lazily-created singleton DB promise so the connection opens at most once.
// ───────────────────────────────────────────────────────────────────────────

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { ID, Scene } from "../types";

interface IdeoboardDB extends DBSchema {
  scenes: { key: ID; value: Scene };
  images: { key: string; value: Blob };
  thumbnails: { key: string; value: Blob };
}

let _dbPromise: Promise<IDBPDatabase<IdeoboardDB>> | null = null;

function getDB(): Promise<IDBPDatabase<IdeoboardDB>> {
  if (!_dbPromise) {
    _dbPromise = openDB<IdeoboardDB>("ideoboard", 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("scenes")) {
          db.createObjectStore("scenes", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("images")) {
          db.createObjectStore("images");
        }
        if (!db.objectStoreNames.contains("thumbnails")) {
          db.createObjectStore("thumbnails");
        }
      },
    });
  }
  return _dbPromise;
}

// ─── Scenes ──────────────────────────────────────────────────────────────────

export async function saveScene(scene: Scene): Promise<void> {
  const db = await getDB();
  await db.put("scenes", scene);
}

export async function loadScene(id: ID): Promise<Scene | undefined> {
  const db = await getDB();
  return db.get("scenes", id);
}

/** All scenes, sorted by `updatedAt` descending (most recently edited first). */
export async function loadAllScenes(): Promise<Scene[]> {
  const db = await getDB();
  const scenes = await db.getAll("scenes");
  return scenes.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteScene(id: ID): Promise<void> {
  const db = await getDB();
  await db.delete("scenes", id);
}

// ─── Image blobs ─────────────────────────────────────────────────────────────

export async function putImage(id: ID, blob: Blob): Promise<void> {
  const db = await getDB();
  await db.put("images", blob, id);
}

export async function getImage(id: ID): Promise<Blob | undefined> {
  const db = await getDB();
  return db.get("images", id);
}

export async function putThumbnail(id: ID, blob: Blob): Promise<void> {
  const db = await getDB();
  await db.put("thumbnails", blob, id);
}

export async function getThumbnail(id: ID): Promise<Blob | undefined> {
  const db = await getDB();
  return db.get("thumbnails", id);
}

export async function deleteImageBlob(id: ID): Promise<void> {
  const db = await getDB();
  await db.delete("images", id);
}

export async function deleteThumbnailBlob(id: ID): Promise<void> {
  const db = await getDB();
  await db.delete("thumbnails", id);
}

/** All keys currently in the "images" store (used for orphan-blob GC). */
export async function getAllImageIds(): Promise<string[]> {
  const db = await getDB();
  return db.getAllKeys("images");
}
