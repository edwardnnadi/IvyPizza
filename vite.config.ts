import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const supabaseUrl = (env.SUPABASE_URL ?? "").replace(/\/+$/, "").replace(/\/rest\/v1$/i, "");

  return {
    root: "src",
    publicDir: "public",
    define: {
      "import.meta.env.VITE_API_BASE_URL": JSON.stringify(env.VITE_API_BASE_URL ?? ""),
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(supabaseUrl),
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
