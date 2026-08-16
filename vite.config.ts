import { fileURLToPath, URL } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Tauri uses the same Vite assets during native development and production builds.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      // Browser development stays same-origin while the Rust process owns every capture endpoint.
      "/api": { target: "http://127.0.0.1:53662", changeOrigin: false },
      "/ws": { target: "ws://127.0.0.1:53662", ws: true, changeOrigin: false },
    },
    watch: {
      ignored: ["**/src-tauri/**", "**/target/**"],
    },
  },
});
