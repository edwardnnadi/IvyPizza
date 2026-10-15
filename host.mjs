import { tsImport } from "tsx/esm/api";

await tsImport("./server/host.ts", import.meta.url);
