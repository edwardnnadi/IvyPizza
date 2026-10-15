import { tsImport } from "tsx/esm/api";

tsImport("./server/host.ts", import.meta.url).catch((error) => {
  console.error("Failed to start Ivy Pizza API", error);
  process.exitCode = 1;
});
