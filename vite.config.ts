import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      host: true,
      allowedHosts: ["ai.pond.audio"],
      proxy: {
        "/api": {
          target: "http://localhost:6767",
        },
        "/ws": {
          target: "ws://localhost:6767",
          ws: true,
        },
      },
    },
    build: {
      outDir: "dist/client",
    },
  };
});
