export function percentile(values, p) {
  if (!values.length) return null;
  const a = [...values].sort((x, y) => x - y),
    index = (a.length - 1) * p,
    low = Math.floor(index);
  return a[low] + (a[Math.ceil(index)] - a[low]) * (index - low);
}
export function summarizeFrames(frames, refreshRateHz = 60) {
  const a = frames
    .map((f) => (typeof f === "number" ? f : f.dtMs))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (!a.length)
    return {
      frameCount: 0,
      fpsAverage: null,
      frameP50Ms: null,
      frameP95Ms: null,
      frameP99Ms: null,
      worstFrameMs: null,
      droppedFramePercent: null,
    };
  const budget = 1000 / refreshRateHz;
  const dropped = a.reduce(
    (sum, n) => sum + Math.max(0, Math.round(n / budget) - 1),
    0,
  );
  return {
    frameCount: a.length,
    fpsAverage: (1000 * a.length) / a.reduce((s, n) => s + n, 0),
    frameP50Ms: percentile(a, 0.5),
    frameP95Ms: percentile(a, 0.95),
    frameP99Ms: percentile(a, 0.99),
    worstFrameMs: Math.max(...a),
    droppedFramePercent: (100 * dropped) / (a.length + dropped),
  };
}
export function summarizeRuns(values) {
  const a = values.filter(Number.isFinite);
  if (!a.length) return { median: null, min: null, max: null, variance: null };
  const mean = a.reduce((s, n) => s + n, 0) / a.length;
  return {
    median: percentile(a, 0.5),
    min: Math.min(...a),
    max: Math.max(...a),
    variance: a.reduce((s, n) => s + (n - mean) ** 2, 0) / a.length,
  };
}
export function summarizeResources(samples) {
  const cpu = samples.map((s) => s.cpuPercent).filter(Number.isFinite),
    rss = samples.map((s) => s.rssMb).filter(Number.isFinite);
  return {
    cpuAverage: cpu.length ? cpu.reduce((s, n) => s + n, 0) / cpu.length : null,
    cpuPeak: cpu.length ? Math.max(...cpu) : null,
    peakMemoryMb: rss.length ? Math.max(...rss) : null,
    gpuAverage: null,
    gpuMemoryMb: null,
    privateMemoryMb: null,
  };
}
