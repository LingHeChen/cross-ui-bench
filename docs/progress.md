# 第一阶段交付进度

- Sprint 1：目录、三运行壳、共享 Web、schemas、CPU/RSS采集、raw/CSV/Markdown、README 已实现。
- Sprint 2：CSS 全8 cases、Flutter语义实现、100/500/1000/5000节点输入已实现。
- Sprint 3：Electron/Tauri共享 GLB / Three.js / WebGL2，两个 Khronos baseline、原创低多边形剪影、独立 mixer、frame percentiles、load/first-frame代理已实现。
- Sprint 4：生成器接口及小规模 real geometry/texture/bones/duplication 初版已实现，新增三份完整 2.1GB 分类压力 GLB，已全量验证并接入 Electron/Tauri 共享加载器。

未完成完整v0.1定义：Flutter native 3D backend；完整formal matrix采集；CPU/GPU阶段分离；cold startup；120Hz现场验证；所有平台release验证；Kenney多动作及PBR/HDRI。Storage / pixel suite / Tauri native wgpu不在第一阶段交付。

自动验证证据与精确结果见 `docs/verification.md`。本地短时diagnostic报告不构成性能结论。

2.1GB 追加交付：三份完整模型在 Electron/Tauri 各完成一次加载与动画采样，六次均成功；[记录](../results/reports/stress-load.md)属于短时诊断。

2026-10-07 固定 60Hz 正式协议测试：三种 2.1GB 模型 × Electron/Tauri × 5 轮，共 30 轮完成；六组协议与刷新率检查通过。[结论](../results/stress-benchmark/2026-10-07T10-55-31.193Z/reports/conclusion.md)。CPU/RSS 因 Tauri XPC 采集覆盖不足，不作跨壳比较。
