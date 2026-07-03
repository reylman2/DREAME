import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  publicDir: false,
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
    "process.env": JSON.stringify({ NODE_ENV: "production" }),
  },
  build: {
    outDir: "public/studio-react",
    emptyOutDir: true,
    sourcemap: false,
    cssCodeSplit: false,
    lib: {
      entry: "src/studio-react/main.jsx",
      name: "DreameStudioReact",
      formats: ["iife"],
      fileName: () => "studio-react.js",
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        assetFileNames: "studio-react.[ext]",
      },
    },
  },
});
