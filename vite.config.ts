import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    root: "src",
    publicDir: "public",
    define: {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(env.SUPABASE_URL ?? ""),
      "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(env.SUPABASE_PUBLISHABLE_KEY ?? ""),
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
