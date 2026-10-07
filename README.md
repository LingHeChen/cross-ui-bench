# CrossUI Bench

可复现的 Electron / Tauri / Flutter 桌面 UI 实验套件。使用统一 workload、协议和原始数据区分 Runtime 差异与实现差异，不预设性能排名。

当前已实现运行壳、CSS 动效、Web 3D、原生存储和像素一致性测试。全量 macOS / 固定 60Hz 正式矩阵仍在采集，不能把功能实现等同于全部成绩已经完成。原设计保存在 [docs/design.md](docs/design.md)。

## 已实现

| 路径                        | CSS 8 种 workload                             | GLB 骨骼 baseline         | 资源采集                                              | 原始 JSON                     |
| --------------------------- | --------------------------------------------- | ------------------------- | ----------------------------------------------------- | ----------------------------- |
| Electron release / Chromium | 是                                            | Three.js / WebGL2         | 应用进程树 CPU / RSS                                  | 是                            |
| Tauri release / OS WebView  | 与 Electron 同源                              | 与 Electron 同源          | host + 可发现子进程 CPU / RSS；WebView 覆盖可能不完整 | 是                            |
| Flutter release / native    | 语义等价 AnimatedBuilder / Transform / Filter | 待实现 native FFI backend | 应用进程 CPU / RSS                                    | 是                            |
| Browser reference           | 同源                                          | 同源                      | 不可用                                                | 下载 JSON，不进入 native 排名 |

CSS：translate、scale + rotate、opacity、blur、backdrop blur、7 层嵌套 transform、滚动 + 动画、mixed UI。节点数 100 / 500 / 1000 / 5000，10000 为可选。每种 workload 独立运行。Mixed UI 包含 sidebar / tabs / editor placeholder / glass modal / toolbar。

3D：离线 RiggedSimple / RiggedFigure + 自生成低多边形剪影角色；GLB load / parse / first mesh / first animated submission；逐帧时序、帧 p50/p95/p99、动画 + 骨骼更新和 render CPU submission。角色支持独立 mixer 和 `index × 0.037s` 时间偏移。

GPU utilization / GPU memory / private memory / 单独 GPU skinning 与 upload / cold startup 尚无可靠采集，记录为 `null` 或报告限制，绝不伪造数值。TTFM/TTFA 为 CPU 提交 + 下一动画回调代理，不是 GPU fence。

## 环境与启动

需要 Node 22.12+、npm；Tauri 需要 Rust 与对应 OS SDK；Flutter 需要 Flutter SDK 与 desktop toolchain。macOS 需要 Xcode。仓库提供 Windows / Linux shells，但本次实际验证平台为 macOS ARM64，未声称验证其他平台。

```sh
npm ci
npm run assets:fetch
npm run assets:generate -- --triangles=1000 --bones=16
npm run electron
```

如果下载 Electron 时代理未被 Node 使用，按你的实际代理设置 `ELECTRON_GET_USE_PROXY=1`、`GLOBAL_AGENT_HTTP_PROXY` 后重新执行 `node node_modules/electron/install.js`。素材下载器通过 curl 支持标准代理环境变量。

```sh
# Web 开发预览（诊断数据）
npm run dev
# http://127.0.0.1:1420

# Tauri
npm run tauri:dev
npm run tauri:build
npm run bench:tauri

# Flutter release，自动测量并退出，采集 SDK 版本及硬件 profile
npm run bench:flutter

# Flutter 交互式 release 壳（同样注入 SDK/硬件 profile）
npm run flutter
```

Web 控制台可选择实验、workload、节点 / 角色数量、60 / 120Hz，并取消运行。三个桌面壳目标内容区为 1280 × 800，实际视口记录在 metadata。默认每个配置 5 轮，每轮 10s 预热 / 30s 测量 / 5s 冷却，约 225s。窗口被隐藏或应用进入后台时取消，不输出半份正式报告。浏览器参考组下载 JSON，需自行放入 `results/raw/` 后汇总；桌面壳直接保存。

## 自动测试与输出

```sh
npm test
npx playwright install chromium
npm run test:web
node tools/screenshot-runner/smoke.mjs --electron
cd apps/flutter
flutter analyze
flutter test
```

自动 native runner 支持通过 `BENCH_QUERY` 设置 workload 与**显式诊断协议**：

```sh
# 完整默认协议：不传缩短时间参数
BENCH_QUERY='case=translate&nodes=100&refresh=60' npm run bench:electron
BENCH_QUERY='benchmark=skeletal-3d&asset=RiggedFigure&characters=10' npm run bench:tauri
BENCH_QUERY='case=opacity&nodes=1000' npm run bench:flutter

# 快速检查；报告强制标记 diagnostic，不是正式跑分
BENCH_QUERY='nodes=100&warmupMs=100&measureMs=500&cooldownMs=50&runs=2' npm run bench:electron

# 单 Runtime 的全 CSS matrix（32 个配置，约 2 小时；逐配置串行）
BENCH_REFRESH_HZ=60 npm run bench:suite -- electron
# 全 GLB baseline matrix：3 assets × 1/10/50 characters
npm run bench:suite -- tauri --3d
# Smoke matrix：显式 diagnostic
npm run bench:suite -- electron --smoke

# 汇总所有 raw JSON
npm run report
```

输出：`results/raw/<uuid>.json` → `results/normalized/<uuid>.json`、`results/reports/summary.csv`、`results/reports/report.md`。逐帧数据始终保存。汇总器校验 schema / 完整轮数并从 raw frame series 重新计算统计。报告包含 median / min / max / population variance、硬件、协议和不可比因素。

正式数据必须使用 release + 完整协议 + **确认真实显示刷新率**。UI 的 target 选项不会设置显示器刷新率。Tauri 的 display refresh 与 WebView 精确版本目前为 unknown，默认不进入正式资格；不得根据浏览器 UA 猜测版本。只有在操作者实际确认系统固定刷新率后，才可用 `BENCH_FIXED_REFRESH_HZ=60`（或120）为 Tauri 注入实际设置；报告会标为 operator-confirmed，不能从 target 自动推断 actual。Flutter 直接构建而未注入 SDK 版本/硬件时也应视为不完整元数据。

## 生成器接口

```sh
npm run assets:generate -- --id=character-100k-50bones --triangles=100000 --bones=50 --textureSize=1024
npm run assets:generate -- --id=character-1m-250bones --triangles=1000000 --bones=250 --textureSize=2048
npm run assets:generate -- --id=character-duplicates --triangles=100000 --bones=100 --characters=10
BENCH_QUERY='benchmark=skeletal-3d&asset=generated/character-100k-50bones&characters=50' npm run bench:electron
```

生成器输出有效 GLB 和独立 manifest，包含几何、PNG 纹理、层级骨骼、真实权重、旋转动画。固定输入得到相同 SHA-256，无 padding。骨骼全部参与 hierarchy，metadata 记录实际有效权重骨骼数。CLI baked duplication 共享 skeleton；独立动画实例压力必须用控制台 / runner 的 `characters`，不得混为同一实验。

生成器支持最高 10M triangles / 1000 bones / 8K texture。2.1GB 压力资产通过单独生成器构建，默认不纳入 Git。PBR/HDRI、原生存储和六种界面的像素一致性测试已实现；Flutter native 3D 与 Tauri native wgpu 尚未实现。

## 结构

- `apps/`：Electron / Tauri / Flutter 运行壳。
- `benchmarks/css-animation/shared-web/`：共享 Web 控制台和 CSS workload。
- `benchmarks/skeletal-3d/shared-web/`：共享 Three.js / GLTFLoader / WebGL2 workload。
- `shared/protocols/`：协议、metadata / result / asset JSON schemas。
- `shared/metrics/`：runner 与统计函数。
- `assets/`：可追溯模型、字体 / 图标 manifest、许可文本。
- `tools/`：素材下载 / 生成、硬件采集、自动 runner、截图测试、结果汇总。
- `docs/`：方法、格式、素材来源、硬件说明和阶段进度。

源代码 MIT；资产遵循独立许可。Khronos RiggedSimple / RiggedFigure 为 Cesium CC-BY-4.0，保留归属与原许可；IBM Plex 为 OFL-1.1。生成的原创剪影素材采用 CC0-1.0。

## 2.1GB 压力资产

三份完整 geometry-heavy / texture-heavy / mixed GLB 已生成并通过全量校验。详见 [生成清单与使用说明](docs/stress-assets.md)。运行 `npm run assets:stress:serve` 后，Electron/Tauri 模型列表自动显示本地压力资产。

## 全量矩阵与 HTML

四类测试及本机运行约束见 [全量 benchmark](docs/full-benchmark.md)。HTML 入口为 `results/full-benchmark/report.html`，报告按完整组结束更新并提供原始数据链接、参数筛选和截图叠加。`npm run bench:all` 执行完整 60Hz 本机矩阵；`npm run report:html` 重建报告。全量正式动态矩阵本身约十小时，另加存储 IO 及载入。失败和未支持项在报告中单独列出。

源码仓库：https://github.com/LingHeChen/cross-ui-bench 。本地运行结果、HTML 报告、构建产物和多 GB 生成模型不纳入源码仓库；公开报告会单独发布。
