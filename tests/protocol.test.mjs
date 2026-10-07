import test from "node:test";
import assert from "node:assert/strict";
import { summarizeFrames, summarizeRuns } from "../shared/metrics/stats.mjs";
import {
  seededRandom,
  qualification,
  DEFAULT_PROTOCOL,
  validateConfig,
} from "../shared/protocols/config.mjs";
import {
  validateResult,
  normalize,
  aggregate,
} from "../tools/result-aggregator/index.mjs";
import { generateCharacter } from "../tools/asset-generator/generate.mjs";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const result = () => ({
  schemaVersion: "1.0.0",
  id: "test",
  benchmark: "css-animation",
  case: "translate",
  runtime: "electron-chromium",
  implementation: "shared-web/css",
  comparisonClass: "runtime-parity",
  metadata: {
    os: "test",
    os_version: "1",
    cpu: "test",
    cpu_arch: "arm64",
    cpu_cores: 8,
    ram: 1,
    gpu: null,
    gpu_driver: null,
    display_resolution: "100x100",
    display_scale: 1,
    refresh_rate: 60,
    runtime: "electron-chromium",
    runtime_version: "1",
    webview_version: "1",
    framework: "electron",
    framework_version: "1",
    build_mode: "release",
  },
  protocol: { ...DEFAULT_PROTOCOL, runs: 1 },
  qualification: { eligible: false, reasons: ["diagnostic"] },
  parameters: { nodes: 100 },
  runs: [
    {
      index: 1,
      frames: [
        { tMs: 10, dtMs: 10 },
        { tMs: 30, dtMs: 20 },
        { tMs: 60, dtMs: 30 },
      ],
      resources: [],
      metrics: {},
    },
  ],
  summary: {},
  limitations: [],
});
test("percentiles, FPS and variance recompute from raw samples", () => {
  assert.equal(summarizeFrames([10, 20, 30]).frameP50Ms, 20);
  assert.equal(summarizeFrames([10, 20, 30]).fpsAverage, 50);
  assert.equal(summarizeRuns([1, 2, 3]).variance, 2 / 3);
  assert.equal(summarizeFrames([]).fpsAverage, null);
});
test("missing metrics are not reported as zero", () => {
  assert.equal(normalize(result()).summary.peakMemoryMb.median, null);
});
test("qualification rejects debug, shortened protocol and unknown display", () => {
  assert.equal(
    qualification(DEFAULT_PROTOCOL, {
      build_mode: "release",
      refresh_rate: 60,
      runtime: "electron-chromium",
    }).eligible,
    true,
  );
  assert.equal(
    qualification(
      { ...DEFAULT_PROTOCOL, runs: 1 },
      { build_mode: "debug", refresh_rate: null, runtime: "browser" },
    ).reasons.length,
    4,
  );
  assert.throws(() => validateConfig({ ...DEFAULT_PROTOCOL, measureMs: 0 }));
});
test("seed is reproducible across runtimes", () => {
  assert.equal(seededRandom(42)(), 0.2523451747838408);
});
test("schema rejects missing metadata and partial runs", () => {
  const r = result();
  delete r.metadata.cpu;
  assert.throws(() => validateResult(r));
  const p = result();
  p.protocol.runs = 5;
  assert.throws(() => validateResult(p));
});
test("generated GLB is deterministic and has real, effective bones", () => {
  const params = { triangles: 1000, bones: 50, textureSize: 32 },
    a = generateCharacter(params),
    b = generateCharacter(params);
  assert.deepEqual(a.buffer, b.buffer);
  assert.equal(a.buffer.readUInt32LE(8), a.buffer.length);
  assert.equal(a.metadata.effective_skinning_bones, 50);
  const json = JSON.parse(
    a.buffer.subarray(20, 20 + a.buffer.readUInt32LE(12)),
  );
  assert.equal(json.accessors[0].count, 3000);
  assert.equal(json.animations[0].channels.length, 50);
  assert.equal(json.skins[0].joints.length, 50);
  assert.throws(() => generateCharacter({ triangles: 10, bones: 50 }));
});
test("aggregator writes validated normalized JSON, CSV and report", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "crossui-"));
  await mkdir(path.join(tmp, "raw"));
  await writeFile(path.join(tmp, "raw/test.json"), JSON.stringify(result()));
  await aggregate(path.join(tmp, "raw"), tmp);
  const csv = await readFile(path.join(tmp, "reports/summary.csv"), "utf8");
  assert.match(csv, /fpsVariance/);
  assert.match(csv, /"50"/);
  assert.match(
    await readFile(path.join(tmp, "reports/report.md"), "utf8"),
    /diagnostic/,
  );
});

test("aggregator cannot promote a shortened protocol to an official result", () => {
  const r = result();
  r.qualification = { eligible: true, reasons: [] };
  assert.equal(normalize(r).qualification.eligible, false);
});
