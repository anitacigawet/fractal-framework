import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    envDir: here,
    plugins: [react(), tailwindcss()],
    root: resolve(here, "client"),
    build: {
      outDir: resolve(here, "dist/client"),
      emptyOutDir: true,
    },
    resolve: {
      alias: {
        "@": resolve(here, "client/src"),
        "@shared": resolve(here, "shared"),
      },
    },
});
