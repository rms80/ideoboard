// Transient UI state: view mode, selection, box tool, typed clipboard, viewport,
// modal flags. NOT history-tracked, NOT persisted (except where noted).
import { create } from "zustand";
import type { ID, PromptBox, PromptTag } from "../types";

export type ViewMode = "graph" | "focus";
export type BoxTool = "select" | "text" | "obj";

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
  boxTool: BoxTool;
  selectedBoxIds: ID[];
  inspectorBoxId: ID | null;
  selectedTagIds: ID[];
  clipboard: Clipboard;
  viewport: Viewport;

  setViewMode: (m: ViewMode) => void;
  toggleViewMode: () => void;
  openSettings: () => void;
  closeSettings: () => void;
  setBoxTool: (t: BoxTool) => void;

  setSelectedBoxes: (ids: ID[]) => void;
  toggleBoxSelection: (id: ID, additive: boolean) => void;
  clearBoxSelection: () => void;
  setInspectorBox: (id: ID | null) => void;

  setSelectedTags: (ids: ID[]) => void;
  toggleTagSelection: (id: ID, additive: boolean) => void;
  clearTagSelection: () => void;

  setClipboard: (c: Clipboard) => void;
  setViewport: (v: Viewport) => void;
}

export const useUiStore = create<UiState>((set, get) => ({
  viewMode: "focus",
  settingsOpen: false,
  boxTool: "select",
  selectedBoxIds: [],
  inspectorBoxId: null,
  selectedTagIds: [],
  clipboard: null,
  viewport: { x: 0, y: 0, zoom: 1 },

  setViewMode: (viewMode) => set({ viewMode }),
  toggleViewMode: () => set({ viewMode: get().viewMode === "graph" ? "focus" : "graph" }),
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  setBoxTool: (boxTool) => set({ boxTool }),

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

  setClipboard: (clipboard) => set({ clipboard }),
  setViewport: (viewport) => set({ viewport }),
}));
