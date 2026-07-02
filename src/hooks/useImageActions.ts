// Shared image actions for the current node's displayed result: copy the
// Ideogram prompt, copy / download / fullscreen the image, and upload / paste a
// new image as a result. Consumed by both the ImageStage right-click menu and the
// StatusBar toolbar buttons so the two stay in lock-step.
import { useEffect, useRef, useState } from "react";
import type { GenerationResult } from "../types";
import { useSceneStore } from "../state/sceneStore";
import { useUiStore } from "../state/uiStore";
import { clonePrompt } from "../state/factory";
import { useObjectUrl } from "./useObjectUrl";
import { promptToV4Json } from "../services/ideogram";
import { getImage, putImage, deleteImageBlob } from "../services/db";
import { padToSquare, storeImageBlob, toPngBlob, revokeObjectURL } from "../services/images";
import { newId } from "../util/id";

export function useImageActions() {
  const scene = useSceneStore((s) => s.scene);
  const draft = useSceneStore((s) => s.draft);
  const node = scene ? scene.nodes[scene.currentNodeId] : null;
  const result =
    node && node.results.length ? node.results[node.currentResultIndex] : undefined;
  const url = useObjectUrl(result?.imageId, "image");
  // Guide image is only meaningful before a result exists (hidden once generated).
  const isEmptyNode = !!node && node.results.length === 0;
  const guideUrl = useObjectUrl(isEmptyNode ? node?.guideImageId : undefined, "image");
  const openLightbox = useUiStore((s) => s.openLightbox);

  // "Copied prompt" flash for the copy button (auto-clears).
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number | null>(null);
  useEffect(() => () => void (copiedTimer.current && clearTimeout(copiedTimer.current)), []);

  // The exact prompt we'd POST to Ideogram, as pretty JSON: the displayed image's
  // snapshot if there is one, otherwise the live draft (what Generate would send).
  const promptSource = result?.promptSnapshot ?? draft ?? node?.prompt ?? null;
  const buildPromptText = () =>
    promptSource ? JSON.stringify(promptToV4Json(promptSource), null, 2) : null;

  const copyPrompt = async () => {
    const text = buildPromptText();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard denied (e.g. insecure context) — silently no-op.
    }
  };

  const copyImage = async () => {
    if (!result) return;
    const blob = await getImage(result.imageId);
    if (!blob) return;
    try {
      const png = await toPngBlob(blob);
      if (!png) return;
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    } catch {
      // Clipboard image write denied / unsupported — no-op.
    }
  };

  const downloadImage = async () => {
    if (!result) return;
    const blob = await getImage(result.imageId);
    if (!blob) return;
    const ext = (blob.type.split("/")[1] || "png").replace("jpeg", "jpg");
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = `ideoboard-${result.id}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(href);
  };

  // Store an arbitrary image blob (uploaded / pasted) as a new result on the
  // current node. Non-square images are black-padded to square first, and the
  // first result freezes the prompt just like a real generation does.
  const importImageBlob = async (blob: Blob) => {
    const s0 = useSceneStore.getState();
    const scene0 = s0.scene;
    if (!scene0) return;
    const nodeId = scene0.currentNodeId;
    const target = scene0.nodes[nodeId];
    if (!target) return;

    const square = await padToSquare(blob);
    const stored = await storeImageBlob(square);

    if (target.results.length === 0) s0.commitDraftToCurrentNode();
    const snapPrompt = useSceneStore.getState().scene?.nodes[nodeId]?.prompt ?? target.prompt;
    const newResult: GenerationResult = {
      id: newId(),
      imageId: stored.imageId,
      thumbnailId: stored.thumbnailId,
      resolution: `${stored.width}x${stored.height}`,
      isImageSafe: true,
      promptSnapshot: clonePrompt(snapPrompt),
      createdAt: Date.now(),
    };
    s0.appendResult(nodeId, newResult);
  };

  const uploadImage = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) void importImageBlob(file);
    };
    input.click();
  };

  const pasteImage = async () => {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = item.types.find((t) => t.startsWith("image/"));
        if (type) {
          await importImageBlob(await item.getType(type));
          return;
        }
      }
    } catch {
      // Clipboard read denied or holds no image — no-op.
    }
  };

  // Paste a clipboard image as the current (empty) node's guide image. Stored raw
  // (no square-padding — it's an overlay reference, not a result). Replaces any
  // existing guide, cleaning up the old blob.
  const pasteGuideImage = async () => {
    const s0 = useSceneStore.getState();
    const nodeId = s0.scene?.currentNodeId;
    const target = nodeId ? s0.scene?.nodes[nodeId] : undefined;
    if (!nodeId || !target || target.results.length > 0) return;
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = item.types.find((t) => t.startsWith("image/"));
        if (!type) continue;
        const blob = await item.getType(type);
        const imageId = newId();
        await putImage(imageId, blob);
        const prev = target.guideImageId;
        s0.setGuideImage(nodeId, imageId);
        if (prev) {
          revokeObjectURL(prev);
          await deleteImageBlob(prev);
        }
        return;
      }
    } catch {
      // Clipboard read denied or holds no image — no-op.
    }
  };

  const removeGuideImage = async () => {
    const s0 = useSceneStore.getState();
    const nodeId = s0.scene?.currentNodeId;
    const target = nodeId ? s0.scene?.nodes[nodeId] : undefined;
    const prev = target?.guideImageId;
    if (!nodeId || !prev) return;
    s0.setGuideImage(nodeId, undefined);
    revokeObjectURL(prev);
    await deleteImageBlob(prev);
  };

  return {
    result,
    url,
    guideUrl,
    isEmptyNode,
    promptSource,
    copied,
    openLightbox,
    copyPrompt,
    copyImage,
    downloadImage,
    uploadImage,
    pasteImage,
    pasteGuideImage,
    removeGuideImage,
  };
}
