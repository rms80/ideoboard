// ───────────────────────────────────────────────────────────────────────────
// services/images.ts — Image acquisition, thumbnailing, and object-URL caching.
//
// Generated image URLs from Ideogram expire, so on success we download the bytes
// immediately (through the `/api/image` proxy — direct browser fetch is blocked
// by CORS; see Plan.md → "Proxy design") and persist the Blob in IndexedDB. A
// downscaled thumbnail (longest edge ≤ 256px) is generated and stored alongside
// it for fast graph rendering. Object URLs for display are created lazily and
// cached by id, then revoked on image delete / scene unload.
// ───────────────────────────────────────────────────────────────────────────

import {
  getImage,
  getThumbnail,
  putImage,
  putThumbnail,
} from "./db";
import { newId } from "../util/id";
import type { ID } from "../types";

export interface StoredImage {
  imageId: ID;
  thumbnailId: ID;
  width: number;
  height: number;
}

/** Longest-edge cap for generated thumbnails, in pixels. */
const MAX_THUMB_EDGE = 256;

// Object-URL cache shared by images and thumbnails. Ids are globally unique
// uuids, so a single map never collides across the two kinds.
const _urlCache = new Map<string, string>();

/**
 * Download generated image bytes via the proxy, store the blob under a new
 * imageId, generate + store a thumbnail under a new thumbnailId, and return the
 * ids plus the source image's natural dimensions.
 */
export async function downloadAndStore(sourceUrl: string): Promise<StoredImage> {
  const res = await fetch("/api/image?url=" + encodeURIComponent(sourceUrl));
  if (!res.ok) {
    throw new Error(
      `Failed to download image: ${res.status} ${res.statusText}`,
    );
  }
  const blob = await res.blob();
  return storeImageBlob(blob);
}

/**
 * Store an already-in-hand Blob (e.g. from zip import) under a new imageId,
 * generate + store a thumbnail, and return the ids + natural dimensions.
 */
export async function storeImageBlob(blob: Blob): Promise<StoredImage> {
  const imageId = newId();
  const thumbnailId = newId();

  await putImage(imageId, blob);

  const { thumbBlob, width, height } = await makeThumbnail(blob);
  await putThumbnail(thumbnailId, thumbBlob);

  return { imageId, thumbnailId, width, height };
}

// ─── Thumbnail generation ────────────────────────────────────────────────────

interface Thumbnailed {
  thumbBlob: Blob;
  width: number;
  height: number;
}

/**
 * Produce a downscaled thumbnail blob plus the source's natural dimensions.
 * Never throws: if anything fails, it degrades by reusing the original blob as
 * the thumbnail (width/height may be 0 if even decoding failed).
 */
async function makeThumbnail(blob: Blob): Promise<Thumbnailed> {
  let width = 0;
  let height = 0;
  try {
    const bitmap = await createImageBitmap(blob);
    width = bitmap.width;
    height = bitmap.height;

    const longest = Math.max(width, height);
    const scale = longest > MAX_THUMB_EDGE ? MAX_THUMB_EDGE / longest : 1;
    const tw = Math.max(1, Math.round(width * scale));
    const th = Math.max(1, Math.round(height * scale));

    let thumbBlob: Blob;
    if (typeof OffscreenCanvas !== "undefined") {
      const canvas = new OffscreenCanvas(tw, th);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d context");
      ctx.drawImage(bitmap, 0, 0, tw, th);
      thumbBlob = await offscreenToBlob(canvas);
    } else {
      const canvas = document.createElement("canvas");
      canvas.width = tw;
      canvas.height = th;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d context");
      ctx.drawImage(bitmap, 0, 0, tw, th);
      thumbBlob = await htmlCanvasToBlob(canvas);
    }

    bitmap.close();
    return { thumbBlob, width, height };
  } catch {
    // Degrade gracefully — store the original blob as the thumbnail too.
    return { thumbBlob: blob, width, height };
  }
}

async function offscreenToBlob(canvas: OffscreenCanvas): Promise<Blob> {
  try {
    return await canvas.convertToBlob({ type: "image/webp", quality: 0.8 });
  } catch {
    return await canvas.convertToBlob({ type: "image/png" });
  }
}

function htmlCanvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    const onPng = (b: Blob | null) =>
      b ? resolve(b) : reject(new Error("canvas.toBlob returned null"));
    canvas.toBlob(
      (b) => {
        if (b) resolve(b);
        else canvas.toBlob(onPng, "image/png");
      },
      "image/webp",
      0.8,
    );
  });
}

// ─── Object-URL cache ────────────────────────────────────────────────────────

/**
 * Lazily resolve a displayable object URL for a stored image. Returns the cached
 * URL if present, otherwise loads the blob from IndexedDB, creates + caches an
 * object URL, and returns it. Returns undefined if the blob is missing.
 */
export async function getImageObjectURL(imageId: ID): Promise<string | undefined> {
  const cached = _urlCache.get(imageId);
  if (cached) return cached;
  const blob = await getImage(imageId);
  if (!blob) return undefined;
  const url = URL.createObjectURL(blob);
  _urlCache.set(imageId, url);
  return url;
}

/** Same as `getImageObjectURL` but for the thumbnails store. */
export async function getThumbnailObjectURL(
  thumbnailId: ID,
): Promise<string | undefined> {
  const cached = _urlCache.get(thumbnailId);
  if (cached) return cached;
  const blob = await getThumbnail(thumbnailId);
  if (!blob) return undefined;
  const url = URL.createObjectURL(blob);
  _urlCache.set(thumbnailId, url);
  return url;
}

/** Revoke and drop a single cached object URL (call when an image is deleted). */
export function revokeObjectURL(id: ID): void {
  const url = _urlCache.get(id);
  if (url) {
    URL.revokeObjectURL(url);
    _urlCache.delete(id);
  }
}

/** Revoke every cached object URL and clear the cache (call on unload/teardown). */
export function revokeAllObjectURLs(): void {
  for (const url of _urlCache.values()) {
    URL.revokeObjectURL(url);
  }
  _urlCache.clear();
}
