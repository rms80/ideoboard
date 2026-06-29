// User settings (API key + generation defaults), persisted to localStorage.
import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  DEFAULT_RESOLUTION,
  DEFAULT_RENDERING_SPEED,
  type RenderingSpeed,
} from "../types";

interface SettingsState {
  apiKey: string;
  defaultResolution: string;
  defaultRenderingSpeed: RenderingSpeed;
  enableCopyrightDetection: boolean;
  setApiKey: (key: string) => void;
  setDefaultResolution: (r: string) => void;
  setDefaultRenderingSpeed: (s: RenderingSpeed) => void;
  setEnableCopyrightDetection: (v: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      apiKey: "",
      defaultResolution: DEFAULT_RESOLUTION,
      defaultRenderingSpeed: DEFAULT_RENDERING_SPEED,
      enableCopyrightDetection: false,
      setApiKey: (apiKey) => set({ apiKey }),
      setDefaultResolution: (defaultResolution) => set({ defaultResolution }),
      setDefaultRenderingSpeed: (defaultRenderingSpeed) => set({ defaultRenderingSpeed }),
      setEnableCopyrightDetection: (enableCopyrightDetection) =>
        set({ enableCopyrightDetection }),
    }),
    { name: "ideoboard-settings" }
  )
);
