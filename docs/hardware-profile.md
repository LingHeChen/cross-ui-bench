# 硬件元数据

`npm run hardware` 输出本机 OS、版本、CPU、架构、逻辑核数、RAM bytes；macOS 额外查询 system_profiler 的 GPU / display。Runtime shell 补充版本、build mode、DPR、viewport、locale。无法可靠读取的值为 null。

Electron screen.displayFrequency 尝试读取实际刷新率；Flutter 使用 display.refreshRate。Tauri 初版暂未可靠取得刷新率及 WebView 精确版本；不能用 target 参数替代 actual。

正式测试前，需要操作者在系统显示设置中确认固定刷新率 60Hz 或120Hz，关闭可变刷新率模式；记录 GPU driver、显示分辨率与缩放、电源状态、设备型号、系统版本和外接显示器。Windows / Linux 上是否取得 GPU 信息需现场核实。

同一机器上对比同配置；不同机器结果只能分别展示。Flutter 通过 `npm run bench:flutter` 注入 host profile 与 SDK/engine版本；手工 flutter run 缺少这些 metadata，需补充后才可用于严谨报告。

确认系统已固定60/120Hz后，可在Tauri运行时显式设置 `BENCH_FIXED_REFRESH_HZ=60`（或120）。这不是自动测量，metadata会记录 operator-confirmed 来源；未设置时为null且diagnostic。
