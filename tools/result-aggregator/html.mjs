import fs from "node:fs";
import path from "node:path";
import { normalize } from "./index.mjs";
export function buildHtml(directory = "results/full-benchmark") {
  const root = path.resolve(directory);
  fs.mkdirSync(root, { recursive: true });
  const read = (f) => {
    try {
      return JSON.parse(fs.readFileSync(f, "utf8"));
    } catch {
      return null;
    }
  };
  const state = read(root + "/run-state.json") ?? { jobs: [] };
  const results = [];
  const append = (dir, phase) => {
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      const raw = read(dir + "/" + f);
      if (!raw?.qualification?.eligible) continue;
      const r = normalize(raw);
      results.push({
        id: r.id,
        benchmark: r.benchmark,
        case: r.case,
        runtime: r.runtime,
        comparisonClass: r.comparisonClass,
        parameters: r.parameters,
        asset: r.asset,
        assetSha256: r.assetSha256,
        metadata: r.metadata,
        protocol: r.protocol,
        summary: r.summary,
        loadSummary: r.loadSummary,
        phase,
        raw: path
          .relative(root, dir + "/" + f)
          .split(path.sep)
          .join("/"),
      });
    }
  };
  append(root + "/raw", "current-matrix");
  append(
    path.resolve("results/stress-benchmark/2026-10-07T10-55-31.193Z/raw"),
    "prior-2.1GB",
  );
  const storage = [];
  for (const runtime of ["electron", "tauri", "flutter"]) {
    const file = root + `/storage/${runtime}.json`,
      s = read(file);
    if (!s) continue;
    for (const r of s.results ?? [])
      if (
        r.runs?.length === 5 &&
        r.runs.every(
          (v) => v.verified && Number.isFinite(v.elapsedMs) && v.elapsedMs > 0,
        )
      )
        storage.push({ ...r, raw: `storage/${runtime}.json` });
  }
  const pixel = read(root + "/pixel/results.json")?.comparisons ?? [];
  const notes = [
    "CSS：32 种参数 × 3 壳；Flutter 为语义等价组，不用于浏览器 CSS API 排名。",
    "3D：骨骼 50/100/250/500/1000、三角形 100K/500K/1M/5M/10M、贴图 1K/2K/4K/8K、角色 1/10/50/100/250/500。",
    "2.1GB：复用此前六组完整 60Hz 数据，单独标识 prior-2.1GB 阶段及源码指纹，不混合旧诊断。",
    "Storage：8 种大小 × 2 种块数据 × 4 操作；小文件 3 数量 × 3 大小 × 2 类型 × 3 操作；SQLite 6 操作，各壳共 124 组。",
    "Pixel：6 fixtures × Electron/Tauri/Flutter，共 18 截图、12 对比；SSIM 在固定降采样图计算。",
    "本机 60Hz：操作者已确认设置；120Hz 及其他操作系统尚未运行。",
    "未支持：完整 Flutter native 3D、Tauri native wgpu；不会补造这些组的成绩。",
    "CPU/RSS：Tauri OS WebView helper 覆盖不全，跨壳资源比较不成立。",
  ];
  const data = {
    updated: new Date().toISOString(),
    jobs: state.jobs ?? [],
    results,
    storage,
    pixel,
    expected3d: state.expected3d ?? 58,
    coverageNotes: notes,
  };
  const font = fs
    .readFileSync(
      "node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2",
    )
    .toString("base64");
  const template = fs.readFileSync("shared/reports/template.html", "utf8");
  const html = template
    .replace("__FONT__", font)
    .replace("__DATA__", JSON.stringify(data).replaceAll("<", "\u003c"));
  fs.writeFileSync(root + "/report.html.partial", html);
  fs.renameSync(root + "/report.html.partial", root + "/report.html");
  fs.writeFileSync(root + "/report-data.json", JSON.stringify(data, null, 2));
  console.log(`HTML_REPORT ${root}/report.html`);
  return data;
}
if (
  process.argv[1]?.endsWith("/html.mjs") ||
  process.argv[1] === "tools/result-aggregator/html.mjs"
)
  buildHtml(process.argv[2]);
