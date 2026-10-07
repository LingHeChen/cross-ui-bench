import { spawn } from "node:child_process";
import { CSS_CASES, NODE_COUNTS } from "../shared/protocols/config.mjs";
const runtime = process.argv[2];
if (!["electron", "tauri", "flutter"].includes(runtime))
  throw new Error(
    "Usage: npm run bench:suite -- electron|tauri|flutter [--smoke] [--3d]",
  );
if (runtime === "flutter" && process.argv.includes("--3d"))
  throw new Error(
    "Flutter native 3D is not implemented; do not substitute a WebView score",
  );
const smoke = process.argv.includes("--smoke");
const matrix = process.argv.includes("--3d")
  ? ["RiggedSimple", "RiggedFigure", "generated/character-lowpoly"].flatMap(
      (asset) =>
        [1, 10, 50].map((characters) => ({
          benchmark: "skeletal-3d",
          asset,
          characters,
        })),
    )
  : CSS_CASES.flatMap((caseName) =>
      NODE_COUNTS.map((nodes) => ({ case: caseName, nodes })),
    );
for (const params of matrix) {
  const query = new URLSearchParams({
    ...params,
    refresh: process.env.BENCH_REFRESH_HZ ?? "60",
    ...(smoke
      ? { warmupMs: "100", measureMs: "1500", cooldownMs: "50", runs: "2" }
      : {}),
  });
  console.log(`Running ${runtime}: ${query}`);
  await new Promise((resolve, reject) => {
    const child = spawn(
      process.platform === "win32" ? "npm.cmd" : "npm",
      ["run", `bench:${runtime}`],
      {
        stdio: "inherit",
        env: { ...process.env, BENCH_QUERY: query.toString() },
      },
    );
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`Experiment failed (${code}); suite stopped`)),
    );
  });
}
console.log("Suite complete. Run npm run report to aggregate raw traces.");
