import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/latin-500.css";
import "@fontsource/ibm-plex-sans/latin-600.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "./style.css";
import { makeBridge, prepareViewport } from "./bridge.js";
import { cssWorkload } from "./workload.js";
import { skeletalWorkload } from "../../skeletal-3d/shared-web/workload.js";
import { runExperiment } from "../../../shared/metrics/runner.mjs";
import {
  DEFAULT_PROTOCOL,
  CSS_CASES,
} from "../../../shared/protocols/config.mjs";
await prepareViewport();
const bridge = makeBridge(),
  query = new URLSearchParams(location.search);
const icon =
  '<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M4 4h10v10H4zM18 4h10v10H18zM4 18h10v10H4z" stroke="currentColor" stroke-width="2"/><path d="m18 18 10 10m0-10L18 28" stroke="currentColor" stroke-width="2"/></svg>';
document.querySelector("#app").innerHTML = `
<header><a class="wordmark" href="./">${icon}<span>CrossUI<span class="brand-light"> Bench</span></span><span class="version">v0.1 / LAB</span></a><div class="host"><span class="status-dot"></span><span id="runtime">Detecting runtime</span></div><a class="source-link" href="https://github.com/KhronosGroup/glTF-Sample-Assets" target="_blank" rel="noreferrer">Asset sources ↗</a></header>
<div class="layout"><aside class="sidebar"><div class="sidebar-label">EXPERIMENTS <span>02</span></div><nav aria-label="Benchmarks"><button class="nav-item active" data-bench="css-animation"><span>01</span>CSS animation<small>Runtime parity</small></button><button class="nav-item" data-bench="skeletal-3d"><span>02</span>Skeletal 3D<small>Shared WebGL2 path</small></button></nav><div class="sidebar-label future-label">PLANNED</div><div class="future"><span>03</span> Storage</div><div class="future"><span>04</span> Pixel consistency</div><div class="sidebar-bottom"><span class="eyebrow">A FAIR COMPARISON.</span><p>Same workload.<br>Same machine.<br>Let the data speak.</p><div class="mini-grid">${icon}</div></div></aside>
<main><div class="breadcrumb">EXPERIMENT CONSOLE <span>/</span> <span id="experiment-number">01</span></div><div class="heading"><div><h1 id="title">Motion under pressure<span>.</span></h1><p id="description">One shared workload. Different runtimes. Every frame accounted for.</p></div><div class="parity-tag"><span>↔</span> RUNTIME PARITY</div></div>
<div class="workspace"><section class="preview-panel"><div class="panel-top"><div><span class="status-dot"></span> LIVE WORKLOAD <span class="muted" id="preview-label">/ translate · 500 nodes</span></div><span class="mono" id="phase">STANDBY</span></div><div id="stage" class="stage"></div><div id="empty-state"><span class="crosshair">＋</span><strong>Ready for an experiment</strong><p>Configure the workload, then start a measured run.</p><span class="mono">10s WARM-UP → 30s MEASURE → 5s COOL-DOWN</span></div><div class="preview-footer"><span id="progress-label">No experiment running</span><span class="mono" id="run-label">RUN — / 05</span></div><div class="progress"><i id="progress"></i></div></section>
<aside class="controls"><div class="control-heading">Experiment setup <span>⌘</span></div><form id="setup"><label>WORKLOAD<select id="case">${CSS_CASES.map((c) => `<option value="${c}">${c.replaceAll("-", " ")}</option>`).join("")}</select></label><div id="css-options"><label>ELEMENT COUNT<select id="nodes">${[100, 500, 1000, 5000, 10000].map((n) => `<option value="${n}" ${n === 500 ? "selected" : ""}>${n.toLocaleString()} nodes${n === 10000 ? " · optional" : ""}</option>`).join("")}</select></label></div><div id="3d-options" hidden><label>BASELINE ASSET<select id="asset"><option>RiggedSimple</option><option>RiggedFigure</option><option value="generated/character-lowpoly">Generated low-poly</option></select></label><label>CHARACTERS<select id="characters"><option>1</option><option>10</option><option>50</option><option>100</option><option>250</option><option>500</option></select></label></div><label>TARGET REFRESH RATE<select id="refresh"><option value="60">60 Hz</option><option value="120">120 Hz</option></select></label><div class="protocol-box"><span class="eyebrow">MEASUREMENT PROTOCOL</span><div><span>Warm-up</span><b>10 seconds</b></div><div><span>Measure</span><b>30 seconds</b></div><div><span>Cool-down</span><b>5 seconds</b></div><div><span>Repetitions</span><b>5 runs</b></div></div><button class="run-button" id="run" type="submit">Start experiment <span>↗</span></button><button id="cancel" class="cancel-button" type="button" hidden>Cancel experiment</button></form><p class="control-note">Release builds only for official results. Keep the app visible and confirm your display refresh rate.</p></aside></div>
<section class="metrics" aria-label="Last measured result"><div><span>AVERAGE FPS</span><strong id="fps">—</strong><small>Median across runs</small></div><div><span>FRAME P95</span><strong id="p95">—</strong><small>Milliseconds / lower is better</small></div><div><span>FRAME P99</span><strong id="p99">—</strong><small>Tail frame stability</small></div><div><span>PEAK MEMORY</span><strong id="memory">—</strong><small>RSS · scope varies by runtime</small></div></section>
<div class="result-notice" id="notice" role="status" aria-live="polite">Ready. No synthetic scores or preloaded results.</div><section class="methodology"><span class="eyebrow">THE METHOD</span><p>We compare implementations, not promises. Electron and Tauri run the same source; Flutter is a separate, semantic reference. Unavailable metrics stay unavailable.</p><span class="method-index">01 — 02</span></section></main></div><footer><span>CROSSUI BENCH <span class="muted">/ Reproducible runtime experiments</span></span><span>RAW DATA FIRST. CONCLUSIONS SECOND.</span></footer>`;
let benchmark = "css-animation",
  controller = null,
  lastResult = null,
  activeWorkload = null;
const $ = (id) => document.getElementById(id),
  notice = (message) => {
    $("notice").textContent = message;
  };
const labels = {
  "css-animation": [
    "Motion under pressure",
    "One shared workload. Different runtimes. Every frame accounted for.",
  ],
  "skeletal-3d": [
    "Every bone. Every frame",
    "Identical assets, animation, and renderer. Trace the cost of a moving mesh.",
  ],
};
function updateLabel() {
  $("preview-label").textContent =
    benchmark === "css-animation"
      ? `/ ${$("case").value} · ${$("nodes").value} nodes`
      : `/ ${$("asset").value} · ${$("characters").value} character(s)`;
}
for (const button of document.querySelectorAll("[data-bench]"))
  button.addEventListener("click", () => {
    if (controller) return;
    benchmark = button.dataset.bench;
    document
      .querySelectorAll("[data-bench]")
      .forEach((b) => b.classList.toggle("active", b === button));
    $("title").replaceChildren(
      document.createTextNode(labels[benchmark][0]),
      Object.assign(document.createElement("span"), { textContent: "." }),
    );
    $("description").textContent = labels[benchmark][1];
    $("experiment-number").textContent =
      benchmark === "css-animation" ? "01" : "02";
    $("css-options").hidden = benchmark !== "css-animation";
    $("3d-options").hidden = benchmark !== "skeletal-3d";
    $("case").disabled = benchmark !== "css-animation";
    updateLabel();
  });
$("setup").addEventListener("change", updateLabel);
$("cancel").addEventListener("click", () => controller?.abort());
window.addEventListener("resize", () => {
  if (controller) {
    notice("Experiment cancelled: viewport resized.");
    controller.abort(
      new DOMException("Experiment cancelled: viewport resized", "AbortError"),
    );
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && controller) {
    notice(
      "Experiment cancelled: window became hidden. Keep it visible for valid timing.",
    );
    controller.abort(
      new DOMException(
        "Experiment cancelled: window became hidden",
        "AbortError",
      ),
    );
  }
});
async function start(overrides = {}) {
  if (controller) return;
  controller = new AbortController();
  $("empty-state").hidden = true;
  $("cancel").hidden = false;
  document
    .querySelectorAll("#setup select, #run, [data-bench]")
    .forEach((e) => (e.disabled = true));
  notice("Running. Raw results are saved after all repetitions finish.");
  const config = {
    ...DEFAULT_PROTOCOL,
    refreshRateHz: Number($("refresh").value),
    ...overrides,
  };
  const parameters =
    benchmark === "css-animation"
      ? { caseName: $("case").value, nodes: Number($("nodes").value) }
      : {
          asset: $("asset").value,
          characterCount: Number($("characters").value),
          sceneProfile: query.get("scene") ?? "baseline",
        };
  const caseName =
    parameters.sceneProfile === "maximum"
      ? "combined-maximum"
      : benchmark === "css-animation"
        ? parameters.caseName
        : parameters.characterCount > 1
          ? "character-scaling"
          : "single-character";
  activeWorkload =
    benchmark === "css-animation"
      ? cssWorkload($("stage"))
      : skeletalWorkload($("stage"));
  try {
    lastResult = await runExperiment({
      benchmark,
      caseName,
      parameters,
      workload: activeWorkload,
      bridge,
      config,
      signal: controller.signal,
      onProgress: ({ phase, index, total }) => {
        $("phase").textContent = phase.toUpperCase();
        $("run-label").textContent =
          `RUN ${String(index).padStart(2, "0")} / ${String(total).padStart(2, "0")}`;
        $("progress-label").textContent =
          `${phase === "prepare" ? "Preparing workload" : phase === "warmup" ? "Warming up the renderer" : phase === "measure" ? "Collecting frame timings" : "Cooling down"} · repetition ${index}`;
        $("progress").style.width =
          `${((index - 1 + (phase === "measure" ? 0.5 : phase === "cooldown" ? 1 : 0)) / total) * 100}%`;
      },
    });
    window.__BENCH_RESULT__ = lastResult;
    const fmt = (v) => (Number.isFinite(v) ? v.toFixed(1) : "—");
    $("fps").textContent = fmt(lastResult.summary.fpsAverage.median);
    $("p95").textContent = fmt(lastResult.summary.frameP95Ms.median);
    $("p99").textContent = fmt(lastResult.summary.frameP99Ms.median);
    $("memory").textContent = fmt(lastResult.summary.peakMemoryMb.median);
    $("phase").textContent = "COMPLETE";
    $("progress").style.width = "100%";
    $("progress-label").textContent = "Raw JSON saved · ready to aggregate";
    notice(
      lastResult.qualification.eligible
        ? "Experiment complete. Raw JSON saved. Run npm run report to generate CSV and Markdown."
        : `Diagnostic result saved: ${lastResult.qualification.reasons.join("; ")}.`,
    );
  } catch (e) {
    window.__BENCH_ERROR__ = e.message;
    $("phase").textContent = e.name === "AbortError" ? "CANCELLED" : "FAILED";
    notice(
      e.name === "AbortError"
        ? "Experiment cancelled. Partial runs are excluded from reports."
        : e.message,
    );
    console.error("BENCH_ERROR", e.message);
    if (query.get("auto") === "1") await bridge.failure?.(e.message);
  } finally {
    controller = null;
    activeWorkload = null;
    $("cancel").hidden = true;
    document
      .querySelectorAll("#setup select, #run, [data-bench]")
      .forEach((e) => (e.disabled = false));
    $("case").disabled = benchmark !== "css-animation";
    $("empty-state").hidden = false;
  }
}
$("setup").addEventListener("submit", (e) => {
  e.preventDefault();
  start();
});
if (query.get("benchmark") === "pixel") {
  const { renderPixelFixture } = await import("../../pixel-consistency/web.js");
  await renderPixelFixture(query.get("fixture"));
} else {
  const metadata = await bridge.metadata();
  $("runtime").textContent = `${metadata.runtime} / ${metadata.build_mode}`;
  if (query.get("benchmark") === "skeletal-3d")
    document.querySelector('[data-bench="skeletal-3d"]').click();
  if (
    query.has("asset") &&
    !Array.from($("asset").options).some(
      (o) => o.value === query.get("asset"),
    ) &&
    /^(generated\/[a-z0-9-]+|stress\/[a-z0-9_-]+)$/.test(query.get("asset"))
  ) {
    $("asset").add(new Option(query.get("asset"), query.get("asset")));
  }
  for (const key of ["case", "nodes", "asset", "characters", "refresh"])
    if (query.has(key)) $(key).value = query.get(key);
  updateLabel();
  window.__BENCH_START__ = start;
  fetch("http://127.0.0.1:1490/index.json")
    .then((r) => (r.ok ? r.json() : []))
    .then((assets) => {
      for (const a of assets)
        if (!Array.from($("asset").options).some((o) => o.value === a.asset))
          $("asset").add(
            new Option(
              `${a.profile} · ${(a.size_bytes / 1e9).toFixed(2)} GB`,
              a.asset,
            ),
          );
    })
    .catch(() => {});
  if (query.get("auto") === "1") {
    const overrides = {};
    for (const key of ["warmupMs", "measureMs", "cooldownMs", "runs"])
      if (query.has(key)) overrides[key] = Number(query.get(key));
    setTimeout(() => start(overrides), 500);
  }
}
