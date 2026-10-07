import { defineConfig } from "vite";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const sourceFiles = [
  "benchmarks/css-animation/shared-web/main.js",
  "benchmarks/css-animation/shared-web/style.css",
  "benchmarks/css-animation/shared-web/workload.js",
  "benchmarks/css-animation/shared-web/bridge.js",
  "benchmarks/skeletal-3d/shared-web/workload.js",
  "shared/protocols/config.mjs",
  "shared/metrics/runner.mjs",
  "shared/metrics/stats.mjs",
  "package-lock.json",
  "benchmarks/pixel-consistency/web.js",
  "assets/pixel/fixtures.json",
];
const sourceHash = createHash("sha256");
for (const file of sourceFiles)
  sourceHash.update(file).update(readFileSync(new URL(file, import.meta.url)));
export default defineConfig({
  define: { __BENCH_SOURCE_SHA256__: JSON.stringify(sourceHash.digest("hex")) },
  root: "benchmarks/css-animation/shared-web",
  base: "./",
  publicDir: "../../../assets",
  server: { port: 1420, strictPort: true, fs: { allow: ["../../.."] } },
  build: { outDir: "../../../dist", emptyOutDir: true },
});
