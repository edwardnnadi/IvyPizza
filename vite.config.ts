import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    root: "src",
    publicDir: "public",
    define: {
      "import.meta.env.VITE_API_BASE_URL": JSON.stringify(env.VITE_API_BASE_URL ?? ""),
    },
    server: {
      proxy: {
        "/api": "http://127.0.0.1:3001",
      },
    },
    build: {
      outDir: "../dist",
      emptyOutDir: true,
    },
  };
});
