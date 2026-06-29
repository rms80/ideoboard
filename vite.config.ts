import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { devApiPlugin } from "./vite-dev-api";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), devApiPlugin()],
  server: {
    port: 6868,
    strictPort: true,
  },
  preview: {
    port: 6868,
    strictPort: true,
  },
});
