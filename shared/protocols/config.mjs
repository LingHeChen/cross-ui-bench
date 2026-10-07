export const PROTOCOL_VERSION = "1.0.0";
export const DEFAULT_PROTOCOL = Object.freeze({
  warmupMs: 10000,
  measureMs: 30000,
  cooldownMs: 5000,
  runs: 5,
  refreshRateHz: 60,
  seed: 20261007,
});
export const CSS_CASES = [
  "translate",
  "scale-rotate",
  "opacity",
  "blur",
  "backdrop-blur",
  "nested-transform",
  "scroll-animation",
  "mixed",
];
export const NODE_COUNTS = [100, 500, 1000, 5000];
export function validateConfig(config) {
  for (const key of ["warmupMs", "measureMs", "cooldownMs"])
    if (
      !Number.isFinite(config[key]) ||
      config[key] < 0 ||
      (key === "measureMs" && config[key] === 0)
    )
      throw new Error(`Invalid ${key}`);
  if (!Number.isInteger(config.runs) || config.runs < 1 || config.runs > 100)
    throw new Error("Invalid runs");
  if (![60, 120].includes(config.refreshRateHz))
    throw new Error("Refresh rate must be 60 or 120 Hz");
  return config;
}
export function qualification(config, metadata) {
  const reasons = [];
  if (metadata.build_mode !== "release") reasons.push("Non-release build");
  if (metadata.runtime === "browser")
    reasons.push("Web reference only; excluded from native comparison");
  if (
    config.warmupMs < 10000 ||
    config.measureMs < 30000 ||
    config.cooldownMs < 5000 ||
    config.runs < 5
  )
    reasons.push("Shortened protocol; diagnostic only");
  if (
    !Number.isFinite(metadata.refresh_rate) ||
    Math.abs(metadata.refresh_rate - config.refreshRateHz) > 0.5
  )
    reasons.push("Display refresh rate not verified");
  return { eligible: reasons.length === 0, reasons };
}
export function seededRandom(seed) {
  let n = seed >>> 0;
  return () => {
    n = (Math.imul(n, 1664525) + 1013904223) >>> 0;
    return n / 4294967296;
  };
}
