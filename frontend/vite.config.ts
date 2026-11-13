import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Development: Vite on 127.0.0.1:5173, API calls go to FastAPI on 127.0.0.1:8000.
export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:8000" },
  },
});
