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
        // Anchored so the `/api.ts` source module is not proxied along with API calls.
        "^/api/": "http://127.0.0.1:3001",
        // Local testing: the emails the API would have sent (EMAIL_PROVIDER=log).
        "^/__dev/": "http://127.0.0.1:3001",
      },
    },
    build: {
      outDir: "../dist",
      emptyOutDir: true,
    },
  };
});
