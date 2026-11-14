import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Logo + flags of the login page are built into the frontend (straight from the desktop assets, no copy), so the
// page looks right even while the backend is not reachable. Same core path as the backend (TRIPPLET_CORE_PATH).
const CORE_IMAGES = path.join(process.env.TRIPPLET_CORE_PATH || "C:/python/tripplet_project", "assets", "images");

// Development: Vite on 127.0.0.1:5173, API calls go to FastAPI on 127.0.0.1:8000.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@core-images": CORE_IMAGES } },
  server: {
    fs: { allow: [".", CORE_IMAGES] },
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:8000",
      "/report": "http://127.0.0.1:8000",
      "/report-assets": "http://127.0.0.1:8000",
      "/kb-assets": "http://127.0.0.1:8000",
    },
  },
});
