import { execFileSync, spawn } from "node:child_process";
import path from "node:path";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { hardware } from "./metrics-collector/hardware.mjs";
const version = JSON.parse(
  execFileSync("flutter", ["--version", "--machine"], { encoding: "utf8" }),
);
const interactive = process.argv.includes("--interactive");
const query = new URLSearchParams(process.env.BENCH_QUERY ?? "");
const sourceHash = createHash("sha256");
for (const file of [
  "apps/flutter/lib/main.dart",
  "apps/flutter/lib/protocol.dart",
  "apps/flutter/pubspec.lock",
])
  sourceHash.update(file).update(readFileSync(file));
const defines = {
  BENCH_SOURCE_SHA256: sourceHash.digest("hex"),
  BENCH_HARDWARE_BASE64: Buffer.from(JSON.stringify(hardware())).toString(
    "base64",
  ),
  BENCH_AUTO: interactive ? "false" : "true",
  BENCH_OUTPUT: path.resolve("results/raw"),
  BENCH_ENGINE_VERSION: version.engineRevision,
  BENCH_FRAMEWORK_VERSION: version.frameworkVersion,
};
for (const [key, name] of [
  ["case", "BENCH_CASE"],
  ["nodes", "BENCH_NODES"],
  ["refresh", "BENCH_REFRESH_HZ"],
  ["warmupMs", "BENCH_WARMUP_MS"],
  ["measureMs", "BENCH_MEASURE_MS"],
  ["cooldownMs", "BENCH_COOLDOWN_MS"],
  ["runs", "BENCH_RUNS"],
])
  if (query.has(key)) defines[name] = query.get(key);
const platform =
  process.platform === "darwin"
    ? "macos"
    : process.platform === "win32"
      ? "windows"
      : "linux";
const args = [
  "build",
  platform,
  "--release",
  ...Object.entries(defines).map(([k, v]) => `--dart-define=${k}=${v}`),
];
execFileSync("flutter", args, { cwd: "apps/flutter", stdio: "inherit" });
const bin =
  platform === "macos"
    ? "apps/flutter/build/macos/Build/Products/Release/crossui_bench.app/Contents/MacOS/crossui_bench"
    : platform === "windows"
      ? "apps/flutter/build/windows/x64/runner/Release/crossui_bench.exe"
      : "apps/flutter/build/linux/x64/release/bundle/crossui_bench";
if (process.argv.includes("--build-only")) {
  console.log(`FLUTTER_BINARY ${path.resolve(bin)}`);
  process.exit(0);
}
const child = spawn(path.resolve(bin), [], {
  stdio: "inherit",
  env: { ...process.env, BENCH_AUTO: interactive ? "0" : "1" },
});
const deadline = interactive
  ? undefined
  : setTimeout(
      () => {
        console.error("Flutter benchmark timed out; no valid result.");
        child.kill();
      },
      (Number(query.get("warmupMs") ?? 10000) +
        Number(query.get("measureMs") ?? 30000) +
        Number(query.get("cooldownMs") ?? 5000) +
        1500) *
        Number(query.get("runs") ?? 5) +
        120000,
    );
child.on("exit", () => clearTimeout(deadline));
child.on("error", (e) => {
  clearTimeout(deadline);
  console.error(e);
  process.exitCode = 1;
});
child.on("exit", (code) => (process.exitCode = code ?? 1));
