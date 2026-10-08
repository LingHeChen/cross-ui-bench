# 本机全量对比与 HTML 报告

范围为设计文档四类测试，在当前 macOS / M4 / 32GiB / 固定 60Hz / AC 电源条件下进行。原始结果与状态存放于 `results/full-benchmark/`，入口为 `report.html`。

- CSS：8 workload × 4 节点数量 × Electron/Tauri/Flutter，96 组；每组 5 轮 10s/30s/5s，Flutter 是语义参考。
- 3D：三个基准模型、50–1000 骨骼、100K–10M 三角形、1K–8K 贴图、1–500 角色。重复参数只测一次、关联多个类别。组合极限使用真实 CC0 HDRI、PBR/morph、动态灯和摄像机，按 FPS < 30 终止后续等级。每组五轮完整协议。
- Storage：每种实现 124 参数组，共 372 组；每组预热一次、测量五次。Node fs/SQLite、Rust fs/rusqlite、Dart io/sqlite3。大小使用二进制字节（MiB/GiB），最大单文件 10GiB；小文件最大 100K × 64KiB。验证样本/长度/数量以及 SQLite integrity_check 在测量外。读取未清空 OS 缓存，随机数据是重复的固定种子 1MiB 块。随机 IO 2048 次 4KiB，SQLite 10K 行，WAL/FULL。不同 SQLite 版本单独展示。
- Pixel：六界面 × 三原生壳，18 PNG、12 对比。相同 TTF、本地图片、固定逻辑窗口和 DPR2、英文、浅色、静态状态。比较实际节点位置、文字边界、像素和固定降采样 SSIM；Flutter 为语义参考。

报告按每组结束更新。未完成、失败、达到预定阈值而跳过的等级分别显示，缺失数据不作零值。历史 2.1GB 五轮结果以 prior-2.1GB 阶段单独显示，不混入老诊断数据。

```sh
npm ci
npm run assets:fetch
npm run assets:generate
npm run assets:stress
npm run assets:matrix
npm run tauri:build
node tools/run-flutter.mjs --build-only
mkdir -p artifacts
swiftc tools/window-id.swift -o artifacts/window-id
caffeinate -di node tools/run-pixel.mjs results/full-benchmark
caffeinate -di node tools/full-matrix.mjs results/full-benchmark
node tools/result-aggregator/html.mjs results/full-benchmark
```

必须保持固定刷新率、AC 电源、屏幕可见，不要同时进行编译或其他重负载活动。运行器串行执行各壳，同一 CSS/3D 参数交替测试。存储测试按每种实现的完整批次串行执行；报告生成只发生在批次/动态组之间。

120Hz 需要操作者再次设置固定刷新率后另跑。Windows/Linux、Flutter native 3D 与 Tauri native wgpu 未实现/未验证；不为这些组编造数据。Tauri OS WebKit XPC helpers 采集不完整，CPU/RSS 不支持跨壳比较。冷启动及独立 GPU 时段/utilization 尚未可靠采样。

新 checkout 自动读取 `shared/protocols/storage-plan.json`；可在输出目录提供同名文件覆盖配置。HTML 会复用本机已有的历史 2.1GB 成绩，首次运行没有历史数据时不会生成该阶段的成绩。素材生成及完整矩阵需要大量可用磁盘空间，运行前须根据存储计划和模型大小确认空间。

## 中断后续跑

确认显示器仍为固定 60Hz、AC 电源已接通且没有其他跑分进程后：

```sh
node tools/resume-matrix.mjs results/full-benchmark
launchctl print gui/$(id -u)/com.linghechen.crossui-bench.matrix
```

运行器读取原有状态，跳过已完成存储和动态组，重跑中断组。续跑通过当前 GUI 登录会话的 launchd 任务执行，独立于启动它的终端；不安装自动登录启动项，不会在重启后未经环境确认自动跑分。stdout/stderr 保存到输出目录的 `logs/matrix-launchd.*.log`。保持登录、屏幕可见和电源接通。
