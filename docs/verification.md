# 本机验证记录

验证日期：2026-10-07。Apple M4 / ARM64 / 10 logical cores / 32 GiB RAM / macOS Darwin 27.0.0。仅验证本机，不声称 Windows / Linux 已通过。

## 自动检查

- npm ci（通过当前代理）从锁文件重新安装成功。
- npm test：9项通过（统计、资格、schema、raw重新汇总、有效骨骼、确定性GLB）。
- flutter analyze：无问题；flutter test：3项通过。
- npm run format:check：通过；cargo fmt通过。
- Playwright：8种CSS workload、3个GLB（RiggedSimple、RiggedFigure、generated low-poly）、GPU context loss、取消、移动布局、零pageerror。
- Electron实际release壳：IPC、CPU/RSS、raw JSON成功；3D RiggedFigure × 10 independently animated characters成功。
- Tauri实际release壳：CSS及RiggedFigure × 10 independently animated characters成功；native viewport校正后1280 × 800。
- Flutter macOS release：CSS translate和mixed实际运行及数据落盘成功。engine timing批量回传已按测量窗口过滤。

## 最近验证的原始结果

| Runtime           | Version                                  | Case                    | Runs | Frames per run | Raw result                                            |
| ----------------- | ---------------------------------------- | ----------------------- | ---- | -------------- | ----------------------------------------------------- |
| electron-chromium | 38.8.6                                   | css-animation/translate | 2    | 61 / 61        | results/raw/e6530a61-ee29-46ea-8706-c88e87ee9e25.json |
| tauri-wkwebview   | 2.12.1                                   | css-animation/translate | 2    | 30 / 30        | results/raw/12372318-49a6-4750-9edb-f8b0b6b24d55.json |
| flutter-native    | a804b261645ef8c13eb3d5c44a5c2fb0340c5539 | css-animation/mixed     | 2    | 178 / 180      | results/raw/f09f3a81-1470-4088-8f08-f0bb49df7259.json |

三组实际viewport均为1280 × 800、workload区域640 × 360。已程序化断言release、完整轮数、逐帧数据非空、原生RSS非空。
Electron与Tauri共享源码SHA-256均为 d6149a5a818a7846559a3e8dea9702b97e734256fc13810bd54e8cebbd14b395。

3D per-run保存load/parse/TTFM/TTFA代理；CPU submission与GPU完成明确区分。source hash为源码和锁定依赖指纹，不是二进制hash。

结果汇总已处理 15 份本地raw traces，生成normalized JSON、summary.csv和report.md。开发过程中不同布局/源码版本的旧诊断trace也被保留，不能混为正式同参数数据。

## 适用范围

所有本次跑分使用缩短协议（例如100ms warm-up / 500–1500ms measurement / 50ms cooldown / 2 repetitions），qualifier为diagnostic；没有生成正式框架排名。截图为控制台QA，不是pixel-consistency结果。

尚需操作者确认系统固定60/120Hz、电源与后台负载，才能进行完整协议矩阵。Tauri未自动获取真实刷新率；用户明确确认后可通过BENCH_FIXED_REFRESH_HZ记录operator-confirmed设置。

未验证：完整225s/config正式矩阵、Windows/Linux运行、Flutter native 3D、Tauri native wgpu、GPU utilization/driver/private memory、cold startup、Kenney多动作、PBR/HDRI、Storage、Pixel Consistency。

## 2.1GB 资产追加验证

三份完整模型已全量验证；三种缩小配方在 Electron/Tauri 实际 release 壳中加载并完成短时动画采样，六次均成功。新增自动测试覆盖确定性、三配方官方 glTF 校验、损坏文件拒绝、HTTP Range/HEAD/索引；9 项测试全通过。完整大模型加载记录见 [stress-assets.md](stress-assets.md)。

## 固定 60Hz 完整 2.1GB 矩阵

三配方各在 Electron/Tauri 运行 5 轮（10s/30s/5s），共 30 轮；六组资格、模型 SHA-256、源码指纹、视口与完整采样窗口已断言通过。固定 60Hz 由操作者截图确认，起止 AC 供电。自动壳增加置顶，保留隐藏/尺寸变化取消；取消原因会保留在日志。完整证据见 [本次报告](../results/stress-benchmark/2026-10-07T10-55-31.193Z/reports/conclusion.md)，不与旧诊断或取消尝试混合。CPU/RSS 因 Tauri XPC helper 覆盖不全，不支持跨壳比较。
