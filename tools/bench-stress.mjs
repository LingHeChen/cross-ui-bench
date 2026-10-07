import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { createAssetServer } from "./asset-generator/serve-stress.mjs";
import { aggregate, validateResult } from "./result-aggregator/index.mjs";
const mode = process.argv[2];
if (!["--fixed60", "--diagnostic"].includes(mode))
  throw Error(
    "Choose --fixed60 only after confirming fixed 60Hz, adaptive refresh off and AC power; otherwise choose --diagnostic.",
  );
const stamp = new Date().toISOString().replaceAll(":", "-");
const output = process.argv[3]
  ? path.resolve(process.argv[3])
  : path.resolve("results/stress-benchmark", stamp);
await mkdir(path.join(output, "raw"), { recursive: true });
const profiles = ["geometry-heavy", "texture-heavy", "mixed"];
const server = await createAssetServer();
const require = createRequire(import.meta.url);
const electron = require("electron");
let records = [];
try {
  const saved = JSON.parse(
    await readFile(path.join(output, "session.json"), "utf8"),
  );
  if (saved.mode !== mode) throw Error("Resume mode mismatch");
  records = saved.records;
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
async function execute(binary, args, env, log, timeout) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let text = "";
    const collect = (b) => {
      text += b.toString();
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const deadline = setTimeout(() => {
      child.kill("SIGTERM");
    }, timeout);
    child.on("error", (e) => {
      clearTimeout(deadline);
      reject(e);
    });
    child.on("exit", async (code) => {
      clearTimeout(deadline);
      try {
        await writeFile(log, text);
        if (code !== 0) throw Error(`Benchmark failed (${code}); see ${log}`);
        const match = text.match(/RESULT (.+\.json)/);
        if (!match) throw Error(`No result; see ${log}`);
        resolve(match[1].trim());
      } catch (e) {
        reject(e);
      }
    });
  });
}
try {
  for (const profile of profiles) {
    for (const runtime of ["electron", "tauri"]) {
      if (records.some((r) => r.runtime === runtime && r.profile === profile)) {
        console.log(`SKIP completed ${runtime} ${profile}`);
        continue;
      }
      const asset = `stress/mega-2_1gb-${profile}`;
      const query = new URLSearchParams({
        benchmark: "skeletal-3d",
        asset,
        characters: "1",
        warmupMs: "10000",
        measureMs: "30000",
        cooldownMs: "5000",
        runs: "5",
        refresh: "60",
        auto: "1",
      });
      const env = {
        ...process.env,
        BENCH_QUERY: query.toString(),
        BENCH_AUTO: "1",
        BENCH_OUTPUT: path.resolve("results/raw"),
      };
      delete env.BENCH_FIXED_REFRESH_HZ;
      if (mode === "--fixed60") env.BENCH_FIXED_REFRESH_HZ = "60";
      console.log(`START ${runtime} ${profile}; five full rounds`);
      const binary =
        runtime === "electron"
          ? electron
          : path.resolve("apps/tauri/target/release/crossui-bench");
      const raw = await execute(
        binary,
        runtime === "electron" ? ["apps/electron/main.cjs", "--auto"] : [],
        env,
        path.join(output, `${runtime}-${profile}.log`),
        420000,
      );
      const result = JSON.parse(await readFile(raw, "utf8"));
      validateResult(result);
      if (
        result.asset !== asset ||
        result.runs.length !== 5 ||
        result.runs.some((r) => !r.frames.length)
      )
        throw Error("Incomplete or mismatched experiment");
      if (mode === "--diagnostic") {
        result.qualification.eligible = false;
        result.qualification.reasons.push(
          "Fixed refresh and display conditions not operator confirmed",
        );
      }
      await writeFile(
        path.join(output, "raw", path.basename(raw)),
        JSON.stringify(result, null, 2) + "\n",
      );
      records.push({
        runtime,
        profile,
        id: result.id,
        eligible: result.qualification.eligible,
      });
      await writeFile(
        path.join(output, "session.json"),
        JSON.stringify({ mode, records }, null, 2) + "\n",
      );
      console.log(`COMPLETE ${runtime} ${profile}: ${result.id}`);
    }
  }
  await aggregate(path.join(output, "raw"), output);
  console.log(`REPORT ${path.join(output, "reports/report.md")}`);
} finally {
  await new Promise((resolve) => server.close(resolve));
}
