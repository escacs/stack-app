import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";

// Style comes from web-vendor/style.css (a snapshot of escacs/stack's
// web/style.css; see its header). No alias into the stack checkout: this
// repo builds standalone.

// Adapted from templates/solid-tauri-vite (EscacsCode): single index.html
// entry, no android mode. Port 1430 must match build.devUrl in
// src-tauri/tauri.conf.json.
export default defineConfig({
  plugins: [solidPlugin()],
  clearScreen: false,
  server: {
    port: 1430,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    target: "esnext",
  },
});
