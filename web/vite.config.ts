import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// During dev, the SPA runs on :5173 and proxies backend routes to Express on :8080.
const backend = "http://localhost:8080";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": backend,
      "/thumbnail": backend,
      "/image": backend,
      // Match only the device-image path. A bare "/d" prefix also captures "/devices"
      // (the SPA route), proxying it to Express and serving a stale prod build → blank page.
      "^/d/.*": backend,
      "/preview": backend,
    },
  },
  build: {
    outDir: "dist",
  },
});
