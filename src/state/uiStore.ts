// Transient UI state: view mode, selection, box tool, typed clipboard, viewport,
// modal flags. NOT history-tracked, NOT persisted (except where noted).
import { create } from "zustand";
import type { ID, PromptBox, PromptTag } from "../types";

export type ViewMode = "graph" | "focus";

// Which BoxPanel field a focus request targets:
//   draw    → freshly-drawn box: Text (text box) / Description (object box)
//   primary → 'e' shortcut: Text (text box) / Label (object box)
//   desc    → 'd' shortcut: Description (either kind)
export type BoxFocusTarget = "draw" | "primary" | "desc";

export type Clipboard =
  | { kind: "boxes"; items: PromptBox[] }
  | { kind: "tags"; items: PromptTag[] }
  | null;

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

interface UiState {
  viewMode: ViewMode;
  settingsOpen: boolean;
  selectedBoxIds: ID[];
  inspectorBoxId: ID | null;
  // Bumped to ask BoxPanel to focus a field; boxFocusTarget says which one.
  focusBoxNonce: number;
  boxFocusTarget: BoxFocusTarget;
  // The just-drawn box still in its "blank" state. While set, backspace/undo in
  // its empty Description discards it (BoxPanel). Cleared on any new gesture/edit.
  pendingBoxId: ID | null;
  selectedTagIds: ID[];
  // Cross-component request (e.g. from a TagField's "Create tag from selection")
  // asking TagsPanel to focus a freshly-created tag's row for editing. seedHash:
  // start the editable line with "# " and drop the caret just after the '#'.
  tagEditRequest: { id: ID; seedHash: boolean } | null;
  clipboard: Clipboard;
  viewport: Viewport;
  // Focus-view overlay visibility toggles (the rendered image / the box overlays).
  showImage: boolean;
  showPrompts: boolean;
  // Fullscreen image lightbox (modal pan/zoom of the current node's active result).
  lightboxOpen: boolean;

  setViewMode: (m: ViewMode) => void;
  toggleViewMode: () => void;
  toggleShowImage: () => void;
  toggleShowPrompts: () => void;
  setShowImage: (v: boolean) => void;
  setShowPrompts: (v: boolean) => void;
  openSettings: () => void;
  closeSettings: () => void;
  openLightbox: () => void;
  closeLightbox: () => void;

  setSelectedBoxes: (ids: ID[]) => void;
  toggleBoxSelection: (id: ID, additive: boolean) => void;
  clearBoxSelection: () => void;
  setInspectorBox: (id: ID | null) => void;
  focusBoxField: (target: BoxFocusTarget) => void;
  setPendingBox: (id: ID | null) => void;

  setSelectedTags: (ids: ID[]) => void;
  toggleTagSelection: (id: ID, additive: boolean) => void;
  clearTagSelection: () => void;
  requestTagEdit: (id: ID, seedHash: boolean) => void;
  clearTagEditRequest: () => void;

  setClipboard: (c: Clipboard) => void;
  setViewport: (v: Viewport) => void;
}

export const useUiStore = create<UiState>((set, get) => ({
  viewMode: "focus",
  settingsOpen: false,
  selectedBoxIds: [],
  inspectorBoxId: null,
  focusBoxNonce: 0,
  boxFocusTarget: "draw",
  pendingBoxId: null,
  selectedTagIds: [],
  tagEditRequest: null,
  clipboard: null,
  viewport: { x: 0, y: 0, zoom: 1 },
  showImage: true,
  showPrompts: true,
  lightboxOpen: false,

  setViewMode: (viewMode) => set({ viewMode }),
  toggleViewMode: () => set({ viewMode: get().viewMode === "graph" ? "focus" : "graph" }),
  // Never both off: turning one off while the other is already off flips the other on.
  toggleShowImage: () =>
    set((s) => {
      const showImage = !s.showImage;
      return showImage || s.showPrompts ? { showImage } : { showImage, showPrompts: true };
    }),
  toggleShowPrompts: () =>
    set((s) => {
      const showPrompts = !s.showPrompts;
      return showPrompts || s.showImage ? { showPrompts } : { showPrompts, showImage: true };
    }),
  setShowImage: (showImage) => set({ showImage }),
  setShowPrompts: (showPrompts) => set({ showPrompts }),
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  openLightbox: () => set({ lightboxOpen: true }),
  closeLightbox: () => set({ lightboxOpen: false }),

  setSelectedBoxes: (selectedBoxIds) =>
    set({ selectedBoxIds, inspectorBoxId: selectedBoxIds.length === 1 ? selectedBoxIds[0] : null }),
  toggleBoxSelection: (id, additive) =>
    set((s) => {
      const has = s.selectedBoxIds.includes(id);
      let next: ID[];
      if (additive) next = has ? s.selectedBoxIds.filter((x) => x !== id) : [...s.selectedBoxIds, id];
      else next = has && s.selectedBoxIds.length === 1 ? [] : [id];
      return { selectedBoxIds: next, inspectorBoxId: next.length === 1 ? next[0] : null };
    }),
  clearBoxSelection: () => set({ selectedBoxIds: [], inspectorBoxId: null }),
  setInspectorBox: (inspectorBoxId) => set({ inspectorBoxId }),
  focusBoxField: (boxFocusTarget) =>
    set((s) => ({ focusBoxNonce: s.focusBoxNonce + 1, boxFocusTarget })),
  setPendingBox: (pendingBoxId) => set({ pendingBoxId }),

  setSelectedTags: (selectedTagIds) => set({ selectedTagIds }),
  toggleTagSelection: (id, additive) =>
    set((s) => {
      const has = s.selectedTagIds.includes(id);
      let next: ID[];
      if (additive) next = has ? s.selectedTagIds.filter((x) => x !== id) : [...s.selectedTagIds, id];
      else next = has && s.selectedTagIds.length === 1 ? [] : [id];
      return { selectedTagIds: next };
    }),
  clearTagSelection: () => set({ selectedTagIds: [] }),
  requestTagEdit: (id, seedHash) => set({ tagEditRequest: { id, seedHash } }),
  clearTagEditRequest: () => set({ tagEditRequest: null }),

  setClipboard: (clipboard) => set({ clipboard }),
  setViewport: (viewport) => set({ viewport }),
}));
