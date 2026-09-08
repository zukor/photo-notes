import { defineConfig } from "vite";
export default defineConfig({
  build: {
    lib: {
      entry: "src/native.ts",
      name: "PhotoNotesBridge",
      formats: ["iife"],
      fileName: () => "native.js",
    },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
