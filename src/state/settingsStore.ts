// User settings (provider + API keys + generation defaults), persisted to localStorage.
import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  DEFAULT_RESOLUTION,
  DEFAULT_RENDERING_SPEED,
  type RenderingSpeed,
} from "../types";

// Which backend services generation. Mirrors the selected tab in the Settings
// dialog. Fal.ai is the default — it's called DIRECTLY from the browser (fal
// supports CORS, no proxy needed), whereas the Ideogram path relays through
// /api/generate. See services/fal.ts and services/ideogram.ts.
export type Provider = "fal" | "ideogram";

interface SettingsState {
  provider: Provider;
  apiKey: string; // Ideogram API key
  falApiKey: string; // Fal.ai API key
  defaultResolution: string;
  defaultRenderingSpeed: RenderingSpeed;
  enableCopyrightDetection: boolean;
  setProvider: (p: Provider) => void;
  setApiKey: (key: string) => void;
  setFalApiKey: (key: string) => void;
  setDefaultResolution: (r: string) => void;
  setDefaultRenderingSpeed: (s: RenderingSpeed) => void;
  setEnableCopyrightDetection: (v: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      provider: "fal",
      apiKey: "",
      falApiKey: "",
      defaultResolution: DEFAULT_RESOLUTION,
      defaultRenderingSpeed: DEFAULT_RENDERING_SPEED,
      enableCopyrightDetection: false,
      setProvider: (provider) => set({ provider }),
      setApiKey: (apiKey) => set({ apiKey }),
      setFalApiKey: (falApiKey) => set({ falApiKey }),
      setDefaultResolution: (defaultResolution) => set({ defaultResolution }),
      setDefaultRenderingSpeed: (defaultRenderingSpeed) => set({ defaultRenderingSpeed }),
      setEnableCopyrightDetection: (enableCopyrightDetection) =>
        set({ enableCopyrightDetection }),
    }),
    { name: "ideoboard-settings" }
  )
);
