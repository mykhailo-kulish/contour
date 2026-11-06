import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// The Console is the built-in Web UI (the Meanings form-based Modeler editor)
// over the engine's own Functions, served by the same Node service. In dev, Vite
// proxies /bff to the running engine.
export default defineConfig({
  root: path.resolve(__dirname, "src/ui"),
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, "dist/ui"),
    emptyOutDir: true,
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/bff": { target: process.env.VITE_ENGINE_PROXY || "http://localhost:8000", changeOrigin: true },
    },
  },
});
