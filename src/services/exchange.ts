// ───────────────────────────────────────────────────────────────────────────
// Zip export/import of a scene = scene.json + manifest.json + image/thumbnail
// blobs. Uses fflate. Import rehydrates blobs into IndexedDB and gives the scene
// a fresh id so importing never clobbers an open scene.
// ───────────────────────────────────────────────────────────────────────────
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import type { ID, Scene } from "../types";
import { newId } from "../util/id";
import {
  loadScene,
  saveScene,
  getImage,
  getThumbnail,
  putImage,
  putThumbnail,
} from "./db";

interface Manifest {
  images: Record<string, string>; // id -> mime
  thumbnails: Record<string, string>;
}

function collectBlobIds(scene: Scene): { images: Set<string>; thumbs: Set<string> } {
  const images = new Set<string>();
  const thumbs = new Set<string>();
  for (const node of Object.values(scene.nodes)) {
    for (const r of node.results) {
      if (r.imageId) images.add(r.imageId);
      if (r.thumbnailId) thumbs.add(r.thumbnailId);
    }
    if (node.guideImageId) images.add(node.guideImageId);
  }
  return { images, thumbs };
}

export async function exportSceneZip(sceneId: ID): Promise<{ blob: Blob; name: string }> {
  const scene = await loadScene(sceneId);
  if (!scene) throw new Error("Scene not found.");

  const { images, thumbs } = collectBlobIds(scene);
  const files: Record<string, Uint8Array> = {};
  const manifest: Manifest = { images: {}, thumbnails: {} };

  for (const id of images) {
    const b = await getImage(id);
    if (b) {
      files[`images/${id}`] = new Uint8Array(await b.arrayBuffer());
      manifest.images[id] = b.type || "image/png";
    }
  }
  for (const id of thumbs) {
    const b = await getThumbnail(id);
    if (b) {
      files[`thumbnails/${id}`] = new Uint8Array(await b.arrayBuffer());
      manifest.thumbnails[id] = b.type || "image/webp";
    }
  }
  files["scene.json"] = strToU8(JSON.stringify(scene));
  files["manifest.json"] = strToU8(JSON.stringify(manifest));

  // level 0: image bytes are already compressed; keep export fast.
  const zipped = zipSync(files, { level: 0 });
  const safeName = (scene.name || "scene").replace(/[^\w.-]+/g, "_");
  return {
    blob: new Blob([zipped], { type: "application/zip" }),
    name: `${safeName}.ideoboard.zip`,
  };
}

/** Trigger a browser download of the scene zip. */
export async function downloadSceneZip(sceneId: ID): Promise<void> {
  const { blob, name } = await exportSceneZip(sceneId);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Rehydrate a scene zip into IndexedDB. Returns the new scene id. */
export async function importSceneZip(file: File | Blob): Promise<ID> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const entries = unzipSync(buf);

  const sceneEntry = entries["scene.json"];
  if (!sceneEntry) throw new Error("Not an Ideoboard zip (missing scene.json).");
  const scene = JSON.parse(strFromU8(sceneEntry)) as Scene;

  const manifest: Manifest = entries["manifest.json"]
    ? (JSON.parse(strFromU8(entries["manifest.json"])) as Manifest)
    : { images: {}, thumbnails: {} };

  for (const path of Object.keys(entries)) {
    if (path.startsWith("images/")) {
      const id = path.slice("images/".length);
      const type = manifest.images[id] || "image/png";
      await putImage(id, new Blob([entries[path]], { type }));
    } else if (path.startsWith("thumbnails/")) {
      const id = path.slice("thumbnails/".length);
      const type = manifest.thumbnails[id] || "image/webp";
      await putThumbnail(id, new Blob([entries[path]], { type }));
    }
  }

  // Fresh scene id so re-importing never overwrites an open scene. Image/thumbnail
  // ids are globally-unique uuids and are intentionally preserved (idempotent blobs).
  scene.id = newId();
  scene.updatedAt = Date.now();
  if (!/\(imported\)\s*$/.test(scene.name)) scene.name = `${scene.name} (imported)`;
  await saveScene(scene);
  return scene.id;
}
