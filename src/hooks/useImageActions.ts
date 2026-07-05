// Shared image actions for the current node's displayed result: copy the
// Ideogram prompt, copy / download / fullscreen the image, and upload / paste a
// new image as a result. Consumed by both the ImageStage right-click menu and the
// StatusBar toolbar buttons so the two stay in lock-step.
import { useEffect, useRef, useState } from "react";
import type { GenerationResult } from "../types";
import type { MenuEntry } from "../components/common/ContextMenu";
import { useSceneStore } from "../state/sceneStore";
import { useUiStore } from "../state/uiStore";
import { useSettingsStore } from "../state/settingsStore";
import { clonePrompt } from "../state/factory";
import { useObjectUrl } from "./useObjectUrl";
import { promptToV4Json, describeImage, v4JsonToPromptFields } from "../services/ideogram";
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
  // A guide image can exist on any node. It's only DRAWN when the result image is
  // hidden (ImageStage: image wins when both are shown), but its menu actions stay
  // available whenever one exists. `isEmptyNode` still gates pasting a new guide.
  const isEmptyNode = !!node && node.results.length === 0;
  const hasGuide = !!node?.guideImageId;
  const guideUrl = useObjectUrl(node?.guideImageId, "image");
  const openLightbox = useUiStore((s) => s.openLightbox);
  // Ideogram-only: "Describe guide image" is disabled for the Fal.ai provider.
  const provider = useSettingsStore((s) => s.provider);

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

  // Copy the current node's guide image to the clipboard (as PNG), mirroring
  // copyImage but sourced from the guide blob instead of a result.
  const copyGuideImage = async () => {
    const s0 = useSceneStore.getState();
    const nodeId = s0.scene?.currentNodeId;
    const guideId = nodeId ? s0.scene?.nodes[nodeId]?.guideImageId : undefined;
    if (!guideId) return;
    const blob = await getImage(guideId);
    if (!blob) return;
    try {
      const png = await toPngBlob(blob);
      if (!png) return;
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    } catch {
      // Clipboard image write denied / unsupported — no-op.
    }
  };

  // Send the current node's guide image to Ideogram's /describe endpoint and fill
  // the (empty) draft prompt from the returned json_prompt: the descriptive fields
  // (high-level description, background, style) plus one box per detected element.
  // Ideogram-only; no-ops on a node that already has a result (editDraft is
  // lock-gated, so there'd be nothing to fill). Boxes are APPENDED to the draft.
  const describeGuideImage = async () => {
    const s0 = useSceneStore.getState();
    const nodeId = s0.scene?.currentNodeId;
    const target = nodeId ? s0.scene?.nodes[nodeId] : undefined;
    const guideId = target?.guideImageId;
    if (!nodeId || !target || !guideId || target.results.length > 0) return;

    const { provider: activeProvider, apiKey } = useSettingsStore.getState();
    if (activeProvider !== "ideogram") return; // Fal has no describe endpoint

    const blob = await getImage(guideId);
    if (!blob) return;

    const ui = useUiStore.getState();
    ui.setDescribeError(null);
    ui.setDescribing(true);
    try {
      const jp = await describeImage(blob, apiKey);
      const fields = v4JsonToPromptFields(jp);
      s0.editDraft((prompt) => {
        prompt.highLevelDescription = fields.highLevelDescription;
        if (fields.background != null) prompt.background = fields.background;
        if (fields.style) prompt.style = { ...prompt.style, ...fields.style };
        for (const b of fields.boxes) prompt.boxes.push({ ...b, id: newId() });
      });
    } catch (err) {
      ui.setDescribeError(err instanceof Error ? err.message : String(err));
    } finally {
      ui.setDescribing(false);
    }
  };

  // The action list shared by the ImageStage right-click menu and the StatusBar
  // "more actions" button, so the two always offer exactly the same options.
  // Grouped: displayed-result actions, then import actions, then guide-image
  // actions (only on a not-yet-generated node).
  const buildMenuItems = (): MenuEntry[] => {
    const items: MenuEntry[] = [
      {
        label: "View fullscreen",
        tooltip: "Open the image in the fullscreen viewer",
        onSelect: () => openLightbox(),
        disabled: !url,
      },
      {
        label: "Download image",
        tooltip: "Save the image to a file",
        onSelect: () => void downloadImage(),
        disabled: !url,
      },
      {
        label: "Copy prompt",
        tooltip: "Copy the Ideogram prompt JSON to the clipboard",
        onSelect: () => void copyPrompt(),
        disabled: !promptSource,
      },
      {
        label: "Copy image",
        tooltip: "Copy the image to the clipboard",
        onSelect: () => void copyImage(),
        disabled: !url,
      },
      { separator: true },
      {
        label: "Paste image",
        tooltip: "Paste a clipboard image as this node's result",
        onSelect: () => void pasteImage(),
      },
      {
        label: "Upload image…",
        tooltip: "Pick an image file to use as this node's result",
        onSelect: () => uploadImage(),
      },
    ];
    if (isEmptyNode || hasGuide) {
      items.push({ separator: true });
      // Pasting seeds/replaces the guide — only meaningful before a result exists.
      if (isEmptyNode) {
        items.push({
          label: "Paste guide image",
          tooltip: "Paste a clipboard image as a faint reference to help compose the prompt",
          onSelect: () => void pasteGuideImage(),
        });
      }
      if (hasGuide) {
        items.push({
          label: "Generate Prompt from Guide",
          tooltip:
            provider !== "ideogram"
              ? "Available only with the Ideogram provider (Fal.ai has no describe endpoint)"
              : !isEmptyNode
                ? "Describe fills an empty prompt — this node already has a result"
                : "Analyze the guide image with Ideogram and fill in the prompt fields & boxes",
          onSelect: () => void describeGuideImage(),
          disabled: provider !== "ideogram" || !isEmptyNode,
        });
        items.push({
          label: "Copy guide image",
          tooltip: "Copy the guide image to the clipboard",
          onSelect: () => void copyGuideImage(),
        });
        items.push({
          label: "Remove guide image",
          tooltip: "Delete this node's guide image",
          onSelect: () => void removeGuideImage(),
        });
      }
    }
    return items;
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
    copyGuideImage,
    describeGuideImage,
    buildMenuItems,
  };
}
