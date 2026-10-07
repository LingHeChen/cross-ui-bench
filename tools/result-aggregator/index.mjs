import { readFile, mkdir, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import Ajv from "ajv";
import { qualification } from "../../shared/protocols/config.mjs";
import {
  summarizeFrames,
  summarizeResources,
  summarizeRuns,
} from "../../shared/metrics/stats.mjs";
const schema = JSON.parse(
  await readFile(
    new URL("../../shared/protocols/result.schema.json", import.meta.url),
  ),
);
const validate = new Ajv({ strict: false }).compile(schema);
export function validateResult(result) {
  if (!validate(result))
    throw new Error(`Invalid result: ${JSON.stringify(validate.errors)}`);
  if (result.runs.length !== result.protocol.runs)
    throw new Error("Incomplete experiment: run count does not match protocol");
  for (const [i, run] of result.runs.entries()) {
    if (run.index !== i + 1) throw new Error("Run indices must be sequential");
    let last = -1;
    for (const f of run.frames) {
      if (f.tMs <= last) throw new Error("Frame timestamps must increase");
      last = f.tMs;
    }
  }
  return result;
}
export function normalize(result) {
  validateResult(result);
  const copy = structuredClone(result);
  const computed = qualification(copy.protocol, copy.metadata);
  copy.qualification = {
    eligible: computed.eligible && copy.qualification.eligible,
    reasons: [...new Set([...computed.reasons, ...copy.qualification.reasons])],
  };
  for (const run of copy.runs)
    run.metrics = {
      ...run.metrics,
      ...summarizeFrames(run.frames, copy.protocol.refreshRateHz),
      ...summarizeResources(run.resources),
    };
  for (const key of Object.keys(copy.runs[0].metrics))
    copy.summary[key] = summarizeRuns(copy.runs.map((r) => r.metrics[key]));
  if (copy.runs[0].loadMetrics) {
    copy.loadSummary = {};
    for (const key of Object.keys(copy.runs[0].loadMetrics))
      copy.loadSummary[key] = summarizeRuns(
        copy.runs.map((r) => r.loadMetrics?.[key]),
      );
  }
  return copy;
}
const csvCell = (v) => `"${String(v ?? "").replaceAll('"', '""')}"`;
export async function aggregate(input = "results/raw", output = "results") {
  const files = (await readdir(input))
    .filter((f) => f.endsWith(".json"))
    .sort();
  if (!files.length) throw new Error(`No raw results in ${input}`);
  const results = [];
  for (const file of files)
    results.push(
      normalize(JSON.parse(await readFile(path.join(input, file), "utf8"))),
    );
  await mkdir(path.join(output, "normalized"), { recursive: true });
  await mkdir(path.join(output, "reports"), { recursive: true });
  for (const r of results)
    await writeFile(
      path.join(output, "normalized", `${r.id}.json`),
      JSON.stringify(r, null, 2),
    );
  const cols = [
    "id",
    "benchmark",
    "case",
    "runtime",
    "implementation",
    "comparisonClass",
    "eligible",
    "nodes",
    "asset",
    "characterCount",
    "fpsMedian",
    "fpsMin",
    "fpsMax",
    "fpsVariance",
    "p50Ms",
    "p95Ms",
    "p99Ms",
    "worstFrameMs",
    "cpuAverage",
    "peakMemoryMb",
    "ttfmMs",
    "ttfaMs",
  ];
  const rows = results.map((r) => [
    r.id,
    r.benchmark,
    r.case,
    r.runtime,
    r.implementation,
    r.comparisonClass,
    r.qualification.eligible,
    r.parameters?.nodes,
    r.asset,
    r.parameters?.characterCount,
    r.summary.fpsAverage?.median,
    r.summary.fpsAverage?.min,
    r.summary.fpsAverage?.max,
    r.summary.fpsAverage?.variance,
    r.summary.frameP50Ms?.median,
    r.summary.frameP95Ms?.median,
    r.summary.frameP99Ms?.median,
    r.summary.worstFrameMs?.max,
    r.summary.cpuAverage?.median,
    r.summary.peakMemoryMb?.max,
    r.loadSummary?.ttfmMs?.median,
    r.loadSummary?.ttfaMs?.median,
  ]);
  await writeFile(
    path.join(output, "reports", "summary.csv"),
    [cols, ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n",
  );
  const fmt = (v) => (Number.isFinite(v) ? v.toFixed(2) : "unavailable");
  const lines = [
    "# CrossUI Bench report",
    "",
    "No runtime ranking is inferred. Compare only matching hardware, display, build, protocol, assets, workload, and implementation class.",
    "",
    ...(results.some((r) => r.metadata.resource_scope?.includes("incomplete"))
      ? [
          "CPU/RSS collection scopes differ. Tauri OS WebView helpers may be missing; its CPU/RSS values are partial and must not be compared with full application process-tree values.",
          "",
        ]
      : []),
    "| Runtime | Workload | Parameters | Eligible | FPS median (min–max; variance) | p95 ms | p99 ms | Peak RSS MB (scope varies) |",
    "|---|---|---|---|---|---|---|---|",
  ];
  for (const r of results)
    lines.push(
      `| ${r.runtime} | ${r.benchmark}/${r.case} | ${JSON.stringify(r.parameters)} | ${r.qualification.eligible ? "yes" : "diagnostic"} | ${fmt(r.summary.fpsAverage?.median)} (${fmt(r.summary.fpsAverage?.min)}–${fmt(r.summary.fpsAverage?.max)}; ${fmt(r.summary.fpsAverage?.variance)}) | ${fmt(r.summary.frameP95Ms?.median)} | ${fmt(r.summary.frameP99Ms?.median)} | ${fmt(r.summary.peakMemoryMb?.max)} |`,
    );
  for (const r of results)
    lines.push(
      "",
      `## ${r.id}`,
      "",
      `Hardware: ${JSON.stringify(r.metadata)}`,
      `Protocol: ${JSON.stringify(r.protocol)}`,
      `Asset hash: ${r.assetSha256 ?? "none"}`,
      `Qualification: ${r.qualification.reasons.join("; ") || "release protocol satisfied"}`,
      "",
      ...r.limitations.map((s) => `- ${s}`),
    );
  await writeFile(
    path.join(output, "reports", "report.md"),
    lines.join("\n") + "\n",
  );
  return results;
}
export async function persistResult(result, directory) {
  validateResult(result);
  await mkdir(directory, { recursive: true });
  const filename = path.join(directory, `${result.id}.json`);
  await writeFile(filename, JSON.stringify(result, null, 2));
  return filename;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const r = await aggregate(process.argv[2], process.argv[3]);
    console.log(`Wrote ${r.length} results, CSV and Markdown report.`);
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
