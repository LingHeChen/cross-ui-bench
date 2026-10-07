# 实验方法

每个配置独立运行。协议默认 10s warm-up、30s measure、5s cooldown、5 repetitions，固定 seed 20261007。每轮重新建立节点 / scene 与独立 mixer。准备与加载不进入帧测量窗口，但 3D load timing 单独保留。cooldown 前停止动画；结束释放 DOM / WebGL / 纹理 / geometry / materials。窗口后台导致取消，部分轮不进入正式输出。

Runtime parity：Electron 和 Tauri 使用一个 Vite production bundle、同一 CSS / Three.js、模型 hash、shader settings、camera、device pixel ratio。禁止分 runtime 优化 workload。固定实际窗口内容大小、DPR、locale、字体和刷新率，使用同一机器、同一电源状态、同一发布构建与 workload。不要同时启动其他 benchmark；关闭性能分析器、录屏与影响负载的后台任务。

Framework reference：Flutter 使用同 seed 生成节点位置、相同元素数量 / 动画周期、Transform / Opacity / ImageFiltered / BackdropFilter / scrolling / mixed layout。波形、自绘与 widget 更新机制并不与 CSS byte-equivalent。标签为 `framework-best-practice`，不用于 Web API 兼容性结论。当前 Flutter 为初始语义实现，尚未经过逐像素视觉匹配。

Web：rAF timestamp 差值为呈现代理。FPS = 1000 × frameCount / Σdt；百分位使用 sorted linear interpolation；dropped frame % = estimated missed refresh slots / (observed + missed)。这是刷新槽估计，不是驱动报告的精确 dropped frames。Flutter：FrameTiming 的 vsyncStart 差值，另存 build / raster duration。不同采样方法需标注。

CPU 为一个核心占满 = 100%，多核可超过 100%。Electron 累计 Chromium 应用进程树；Tauri sysinfo host + 可发现 child processes（WKWebView 的 OS helper 可能不在其 parent tree）；Flutter application process。Flutter macOS/Linux 由 ps 的累计 CPU time 差值/墙钟时间，Windows 暂为 null。不得直接对不同进程覆盖范围的 RSS 排名。GPU 指标不可得时为 null。

3D loader 使用完整 GLB bytes；File load 包含读取 Response；parse 包含 texture decode。SHA-256 独立执行但总 TTFM 包含其开销。firstRenderSubmissionMs 是首次 renderer.render 的 CPU 开销，包含可能的首次上传提交；不能标作实际 GPU upload time。TTFM / TTFA 是提交后下一个 rAF 的时间。AnimationMixer.update 只测 animation sampling + local transform writes；bone/world matrix update 包含在 render submission 内，独立指标为 null，skinning 在 GPU，skin time 留 null。记录未采集的 cold startup。

正式 eligible 判定：release、完整协议、非 browser baseline、实际 refresh_rate 等于 target。Tauri refresh_rate 未能可靠获取时为 null，结果 diagnostic。此资格只表示协议完整，不等于与任意结果可直接比较。报告不自动排名、不把诊断数据当结论。

Full default suite 每配置约 225s。首次自动验证只跑短协议来验证 load → measure → persist → normalize → report 链路，不能拿短协议数值回答 Chromium vs WKWebView 的争议。

桌面壳统一目标内容区 1280 × 800，实际尺寸与 DPR 保存在 metadata；改变视口时取消实验。Flutter engine timing 约按1秒批量回传，测量后等1.1秒冲刷，按 engine vsyncStart 筛选正式窗口，冲刷等待不计入 raw frame series。macOS Flutter 本地 runner 关闭 App Sandbox 以允许仓库结果写入与 ps 采样；这不测试商店沙箱发布配置。

固定 workload 渲染区为 640 × 360 logical pixels，Electron/Tauri/Flutter 一致；Web移动预览仅作UI诊断，不作为同面积比较。metadata额外记录workload_width/height；正式比较时检查实际面积与DPR。
