import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  server: { port: 5174, strictPort: true },
  // Do not crawl the Live2D SDK's standalone Demo HTML/TypeScript files
  // copied under public/live2d/core. They rely on the SDK's @framework alias,
  // not on this application's dependency graph.
  optimizeDeps: {
    entries: ["index.html"],
  },
});
