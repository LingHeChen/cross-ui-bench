import { spawn } from "node:child_process";
import path from "node:path";
const query = new URLSearchParams(process.env.BENCH_QUERY ?? "");
query.set("auto", "1");
const bin = path.resolve(
  "apps/tauri/target/release",
  process.platform === "win32" ? "crossui-bench.exe" : "crossui-bench",
);
const child = spawn(bin, [], {
  stdio: "inherit",
  env: {
    ...process.env,
    BENCH_QUERY: query.toString(),
    BENCH_AUTO: "1",
    BENCH_OUTPUT: path.resolve("results/raw"),
  },
});
const deadline = setTimeout(
  () => {
    console.error("Tauri benchmark timed out; no valid result.");
    child.kill();
  },
  (Number(query.get("warmupMs") ?? 10000) +
    Number(query.get("measureMs") ?? 30000) +
    Number(query.get("cooldownMs") ?? 5000)) *
    Number(query.get("runs") ?? 5) +
    120000,
);
child.on("exit", () => clearTimeout(deadline));
child.on("error", (e) => {
  clearTimeout(deadline);
  console.error(`${e.message}. First run npm run tauri:build.`);
  process.exitCode = 1;
});
child.on("exit", (code) => (process.exitCode = code ?? 1));
