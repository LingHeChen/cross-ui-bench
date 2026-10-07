import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { createAssetServer } from "./asset-generator/serve-stress.mjs";
import { CSS_CASES, NODE_COUNTS } from "../shared/protocols/config.mjs";
import { validateResult, aggregate } from "./result-aggregator/index.mjs";
import { buildHtml } from "./result-aggregator/html.mjs";
const root = path.resolve(process.argv[2] ?? "results/full-benchmark");
fs.mkdirSync(root + "/raw", { recursive: true });
fs.mkdirSync(root + "/logs", { recursive: true });
fs.mkdirSync(root + "/storage", { recursive: true });
fs.mkdirSync("artifacts/storage-full", { recursive: true });
const require = createRequire(import.meta.url),
  electron = require("electron"),
  tauri = path.resolve("apps/tauri/target/release/crossui-bench"),
  flutter = path.resolve(
    "apps/flutter/build/macos/Build/Products/Release/crossui_bench.app/Contents/MacOS/crossui_bench",
  );
const file = root + "/run-state.json";
let state;
try {
  state = JSON.parse(fs.readFileSync(file));
} catch {
  const jobs = [];
  const add = (runtime, parameters, categories) => {
    const key = runtime + "-" + new URLSearchParams(parameters);
    let old = jobs.find((j) => j.key === key);
    if (old) {
      old.categories = [...new Set([...old.categories, ...categories])];
      return;
    }
    jobs.push({ key, runtime, parameters, categories, status: "pending" });
  };
  for (const c of CSS_CASES)
    for (const nodes of NODE_COUNTS)
      for (const runtime of ["electron", "tauri", "flutter"])
        add(runtime, { benchmark: "css-animation", case: c, nodes }, ["css"]);
  const scale = (t, b, x = 4096) => `stress/scale-t${t}-b${b}-x${x}`;
  const three = (asset, characters, categories, extra = {}) => {
    for (const runtime of ["electron", "tauri"])
      add(
        runtime,
        { benchmark: "skeletal-3d", asset, characters, ...extra },
        categories,
      );
  };
  for (const asset of [
    "RiggedSimple",
    "RiggedFigure",
    "generated/character-lowpoly",
  ])
    for (const count of [1, 10, 50])
      three(asset, count, ["baseline", "static-load"]);
  for (const bones of [50, 100, 250, 500, 1000])
    three(scale(1000000, bones), 1, ["bone-scaling", "static-load"]);
  for (const tris of [100000, 500000, 1000000, 5000000, 10000000])
    three(scale(tris, 100), 1, ["geometry-scaling", "static-load"]);
  for (const tex of [1024, 2048, 4096, 8192])
    three(scale(1000000, 100, tex), 1, ["texture-scaling", "static-load"]);
  for (const count of [1, 10, 50, 100, 250, 500])
    three(scale(100000, 100), count, ["character-scaling", "static-load"]);
  for (const count of [1, 10, 50])
    three("stress/mega-2_1gb-mixed", count, ["combined-maximum"], {
      scene: "maximum",
    });
  // Visit workloads in order; each identical config interleaves runtimes.
  state = {
    createdAt: new Date().toISOString(),
    mode: "fixed60",
    jobs,
    expected3d:
      jobs.filter((j) => j.parameters.benchmark === "skeletal-3d").length + 6,
    storage: {},
    pixel: "complete",
    sourceNote:
      "Prior 2.1GB data is shown separately; current matrix uses one shared Web build.",
  };
}
function save() {
  fs.writeFileSync(file + ".partial", JSON.stringify(state, null, 2));
  fs.renameSync(file + ".partial", file);
  buildHtml(root);
}
function exec(binary, args, env, log, timeout, onLine) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(log);
    let text = "",
      partial = "";
    const child = spawn(binary, args, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const t = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
      }, 5000).unref();
    }, timeout);
    const collect = (b) => {
      output.write(b);
      const s = b.toString();
      text += s;
      partial += s;
      const lines = partial.split("\n");
      partial = lines.pop();
      for (const line of lines) onLine?.(line);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", (e) => {
      clearTimeout(t);
      output.end();
      reject(e);
    });
    child.on("exit", (code, signal) => {
      clearTimeout(t);
      output.end();
      code === 0
        ? resolve(text)
        : reject(Error(`exit=${code} signal=${signal}; ${log}`));
    });
  });
}
save();
const server = await createAssetServer();
try {
  // Storage runs first. Each native process finishes its own serial matrix.
  const plan = JSON.parse(
    fs.readFileSync(
      fs.existsSync(root + "/storage-plan.json")
        ? root + "/storage-plan.json"
        : "shared/protocols/storage-plan.json",
    ),
  );
  for (const runtime of ["electron", "tauri", "flutter"]) {
    if (state.storage[runtime]?.status === "complete") continue;
    state.storage[runtime] = { status: "running" };
    save();
    const output = root + `/storage/${runtime}.json`,
      config = {
        ...plan,
        temporaryRoot: path.resolve("artifacts/storage-full"),
        output,
      };
    const configPath = root + `/storage/${runtime}.config.json`;
    fs.writeFileSync(configPath, JSON.stringify(config));
    console.log("START_STORAGE " + runtime);
    try {
      await exec(
        runtime === "electron"
          ? electron
          : runtime === "tauri"
            ? tauri
            : flutter,
        runtime === "electron" ? ["apps/electron/main.cjs"] : [],
        { ...process.env, BENCH_STORAGE_CONFIG: configPath, BENCH_AUTO: "1" },
        root + `/logs/storage-${runtime}.log`,
        7200000,
        (line) => {
          if (line.startsWith("STORAGE_PROGRESS ")) {
            const progress = JSON.parse(line.slice(17));
            state.storage[runtime] = { status: "running", ...progress };
            console.log(line);
          }
        },
      );
      const result = JSON.parse(fs.readFileSync(output));
      if (
        result.results.length !== plan.jobs.length ||
        result.results.some(
          (r) => r.runs.length !== 5 || r.runs.some((v) => !v.verified),
        )
      )
        throw Error("Storage matrix incomplete");
      state.storage[runtime] = {
        status: "complete",
        groups: result.results.length,
      };
    } catch (e) {
      state.storage[runtime] = { status: "failed", error: e.message };
    }
    save();
  }
  for (const job of state.jobs) {
    if (["complete", "skipped"].includes(job.status)) continue;
    if (job.categories.includes("combined-maximum")) {
      const previous = state.jobs.filter(
        (j) =>
          j.runtime === job.runtime &&
          j.categories.includes("combined-maximum") &&
          j.status === "complete" &&
          Number(j.parameters.characters) < Number(job.parameters.characters),
      );
      if (previous.some((j) => j.fpsMedian < 30)) {
        job.status = "skipped";
        job.reason =
          "Earlier combined stress reached the design stop threshold FPS < 30";
        save();
        continue;
      }
    }
    const protocol = {
      warmupMs: 10000,
      measureMs: 30000,
      cooldownMs: 5000,
      runs: 5,
      refresh: 60,
      auto: 1,
    };
    const query = new URLSearchParams({ ...job.parameters, ...protocol });
    const env = {
      ...process.env,
      BENCH_QUERY: query.toString(),
      BENCH_AUTO: "1",
      BENCH_OUTPUT: root + "/raw",
      BENCH_FIXED_REFRESH_HZ: "60",
    };
    job.status = "running";
    job.startedAt = new Date().toISOString();
    save();
    console.log("START " + job.key);
    try {
      const text = await exec(
        job.runtime === "electron"
          ? electron
          : job.runtime === "tauri"
            ? tauri
            : flutter,
        job.runtime === "electron" ? ["apps/electron/main.cjs", "--auto"] : [],
        env,
        root + "/logs/" + encodeURIComponent(job.key) + ".log",
        600000,
      );
      const match = text.match(/RESULT (.+\.json)/);
      if (!match) throw Error("No saved result");
      const raw = match[1].trim(),
        r = JSON.parse(fs.readFileSync(raw));
      validateResult(r);
      if (
        r.runs.length !== 5 ||
        !r.qualification.eligible ||
        r.runs.some((v) => !v.frames.length) ||
        r.protocol.measureMs !== 30000
      )
        throw Error("Protocol or refresh qualification failed");
      const target = root + "/raw/" + path.basename(raw);
      if (path.resolve(raw) !== target) fs.copyFileSync(raw, target);
      job.status = "complete";
      job.id = r.id;
      job.fpsMedian = r.summary.fpsAverage.median;
      job.source = r.metadata.benchmark_source_sha256;
      console.log(
        "COMPLETE " + job.key + " " + job.fpsMedian.toFixed(2) + " FPS",
      );
    } catch (e) {
      job.status = "failed";
      job.error = e.message;
      console.log("FAILED " + job.key + " " + e.message);
    }
    job.completedAt = new Date().toISOString();
    save();
  }
  if (fs.readdirSync(root + "/raw").some((f) => f.endsWith(".json")))
    await aggregate(root + "/raw", root);
  state.completedAt = new Date().toISOString();
  save();
  console.log("FULL_MATRIX_COMPLETE " + root + "/report.html");
} finally {
  await new Promise((resolve) => server.close(resolve));
}
