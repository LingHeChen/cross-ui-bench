import {
  DEFAULT_PROTOCOL,
  PROTOCOL_VERSION,
  CSS_CASES,
  NODE_COUNTS,
  qualification,
  validateConfig,
} from "../protocols/config.mjs";
import {
  summarizeFrames,
  summarizeResources,
  summarizeRuns,
} from "./stats.mjs";
const abortError = (signal) =>
  signal?.reason instanceof Error
    ? signal.reason
    : new DOMException("Experiment cancelled", "AbortError");
export function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError(signal));
    const cancel = () => {
      clearTimeout(timer);
      reject(abortError(signal));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", cancel);
      resolve();
    }, ms);
    signal?.addEventListener("abort", cancel, { once: true });
  });
}
function recordFrames(duration, signal, assertHealthy) {
  return new Promise((resolve, reject) => {
    let handle, start, last;
    const frames = [];
    const cancel = () => {
      cancelAnimationFrame(handle);
      reject(abortError(signal));
    };
    signal?.addEventListener("abort", cancel, { once: true });
    const tick = (t) => {
      try {
        assertHealthy?.();
      } catch (error) {
        signal?.removeEventListener("abort", cancel);
        reject(error);
        return;
      }
      if (start === undefined) {
        start = t;
        last = t;
      } else {
        frames.push({ tMs: t - start, dtMs: t - last });
        last = t;
      }
      if (t - start >= duration) {
        signal?.removeEventListener("abort", cancel);
        resolve(frames);
      } else handle = requestAnimationFrame(tick);
    };
    if (signal?.aborted) return cancel();
    handle = requestAnimationFrame(tick);
  });
}
export async function runExperiment({
  benchmark,
  caseName,
  parameters,
  workload,
  bridge,
  config = {},
  signal,
  onProgress = () => {},
}) {
  if (
    benchmark === "css-animation" &&
    (!CSS_CASES.includes(parameters.caseName) ||
      ![...NODE_COUNTS, 10000].includes(parameters.nodes))
  )
    throw new Error("Invalid CSS workload configuration");
  if (
    benchmark === "skeletal-3d" &&
    (!/^(RiggedSimple|RiggedFigure|generated\/[a-z0-9-]+|stress\/[a-z0-9_-]+)$/.test(
      parameters.asset,
    ) ||
      ![1, 10, 50, 100, 250, 500].includes(parameters.characterCount))
  )
    throw new Error("Invalid 3D workload configuration");
  const protocol = validateConfig({ ...DEFAULT_PROTOCOL, ...config });
  const metadata = { ...(await bridge.metadata()), ...workload.metadata?.() };
  const result = {
    schemaVersion: PROTOCOL_VERSION,
    id: crypto.randomUUID(),
    benchmark,
    case: caseName,
    runtime: metadata.runtime,
    implementation:
      benchmark === "css-animation"
        ? "shared-web/css"
        : "shared-web/three-webgl2",
    comparisonClass: "runtime-parity",
    parameters,
    asset: parameters.asset ?? null,
    assetSha256: null,
    metadata,
    protocol,
    qualification: qualification(protocol, metadata),
    coldStartupMs: null,
    startedAt: new Date().toISOString(),
    runs: [],
    summary: {},
    limitations: [
      "requestAnimationFrame is a presentation proxy, not a GPU fence.",
      "GPU utilization, GPU memory and private memory unavailable; null is not zero.",
      "Display refresh rate must be recorded from the actual display settings.",
      "Cold startup is not instrumented in this baseline.",
    ],
  };
  if (benchmark === "skeletal-3d")
    result.limitations.push(
      "Mixer timing covers animation sampling and local transform writes. Bone/world matrix updates are included in render submission and not separately timed. Parse includes texture decode; GPU upload is included in first render CPU submission. Skinning runs on GPU and is not separately timed. TTFM/TTFA use render submission plus the next animation callback.",
    );
  try {
    for (let index = 1; index <= protocol.runs; index++) {
      if (signal?.aborted) throw abortError(signal);
      onProgress({ phase: "prepare", index, total: protocol.runs });
      await workload.prepare(parameters, protocol.seed, signal);
      if (signal?.aborted) throw abortError(signal);
      if (workload.assetSha256) {
        if (result.assetSha256 && result.assetSha256 !== workload.assetSha256)
          throw new Error("Asset changed between repetitions");
        result.assetSha256 = workload.assetSha256;
      }
      if (workload.assetMetadata) {
        result.assetMetadata = workload.assetMetadata;
        if (
          !result.limitations.includes(
            "Stress asset transport is shared loopback HTTP; asset-server CPU/RSS is outside application process scope.",
          )
        )
          result.limitations.push(
            "Stress asset transport is shared loopback HTTP; asset-server CPU/RSS is outside application process scope.",
          );
      }
      if (workload.timings) result.loadMetrics = { ...workload.timings };
      workload.start();
      onProgress({ phase: "warmup", index, total: protocol.runs });
      await delay(protocol.warmupMs, signal);
      workload.beginMeasurement?.();
      onProgress({ phase: "measure", index, total: protocol.runs });
      const resources = [],
        resourceOrigin = performance.now();
      let sampling = false;
      const sample = async () => {
        if (sampling) return;
        sampling = true;
        try {
          const s = await bridge.sample();
          if (s)
            resources.push({ ...s, tMs: performance.now() - resourceOrigin });
        } finally {
          sampling = false;
        }
      };
      await sample();
      const timer = setInterval(() => sample().catch(() => {}), 1000);
      let frames;
      try {
        frames = await recordFrames(protocol.measureMs, signal, () =>
          workload.assertHealthy?.(),
        );
      } finally {
        clearInterval(timer);
      }
      await sample();
      workload.stop();
      const metrics = {
        ...summarizeFrames(frames, protocol.refreshRateHz),
        ...summarizeResources(resources),
        ...workload.measurements?.(),
      };
      result.runs.push({
        index,
        frames,
        resources,
        metrics,
        loadMetrics: workload.timings ? { ...workload.timings } : null,
      });
      onProgress({ phase: "cooldown", index, total: protocol.runs });
      await delay(protocol.cooldownMs, signal);
    }
    for (const key of Object.keys(result.runs[0].metrics))
      result.summary[key] = summarizeRuns(
        result.runs.map((r) => r.metrics[key]),
      );
    if (result.runs[0].loadMetrics) {
      result.loadSummary = {};
      for (const key of Object.keys(result.runs[0].loadMetrics))
        result.loadSummary[key] = summarizeRuns(
          result.runs.map((r) => r.loadMetrics?.[key]),
        );
    }
    result.completedAt = new Date().toISOString();
    await bridge.save(result);
    return result;
  } finally {
    workload.dispose();
  }
}
