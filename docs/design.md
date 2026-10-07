# CrossUI Bench 设计文档

## 1. 项目概述

CrossUI Bench 是一套用于比较 **Electron、Tauri、Flutter** 在跨平台客户端场景下的 UI 一致性、运行时性能、资源占用与重负载能力的可复现实验套件。

项目不预设“哪套框架更好”的结论，而是通过统一素材、统一 workload、统一采样方法，回答以下问题：

1. Chromium 与 WebKit 在常规 CSS / 动效压力下差距到底有多大？
2. Electron、Tauri、Flutter 在桌面应用中的 CPU、内存、启动时间与帧稳定性差异是多少？
3. 大体积 3D Mesh、骨骼动画、复杂场景对三套技术栈的影响有何不同？
4. Tauri 在 WebView 路径与 Native/Rust 路径下的性能上限分别如何？
5. Flutter 自绘体系在跨平台像素一致性与高负载 UI 下表现如何？
6. OPFS 所代表的“应用私有本地持久化”能力，在 Electron / Tauri / Flutter 中采用各自合理实现后，性能与工程复杂度如何？
7. 当某项 Web API 或浏览器内核存在差异时，是否可以通过 native backend、条件编译或平台抽象绕开，而不是把问题直接归结为“框架不可用”。

---

# 2. 核心原则

## 2.1 不做结论导向 Benchmark

禁止为了证明某个框架更优秀而人为选择有利 workload。

如果结果显示：

- Chromium 在某类动画或 3D workload 下明显领先 WebKit；
- Flutter 在某类桌面交互场景表现较差；
- Tauri native 路径明显优于 WebView；
- Electron 在某类复杂 Web UI 中更稳定；

均应如实记录。

项目目标是得到：

> “什么场景适合什么 Runtime”

而不是：

> “Tauri / Flutter 一定比 Electron 好”。

---

## 2.2 同一问题分两类测试

所有涉及不同框架能力边界的测试都尽量区分：

### A. Runtime Parity Test

尽可能保持业务代码与渲染代码一致，只比较 Runtime。

典型例子：

```text
Electron
  Chromium
      ↑
同一份 HTML/CSS/JS
      ↓
Tauri WebView
  WebView2 / WKWebView
```

用途：

- 测 Chromium vs WebKit
- 测 Electron Chromium vs Tauri WebView2
- 排除业务实现差异

### B. Framework Best Practice Test

允许每个框架使用符合其设计理念的最佳实践。

例如：

```text
Electron
→ Chromium + Three.js/WebGL/WebGPU

Tauri
→ Web UI + Rust native backend + wgpu

Flutter
→ Flutter rendering + native/FFI 3D backend
```

用途：

> 比较“实际做项目时应该怎么写”，而不是强行把所有框架限制在同一实现路径中。

---

# 3. 首期 Benchmark 范围

首期包含 4 个 Benchmark：

```text
01-css-animation-stress
02-storage-benchmark
03-3d-skeletal-animation
04-pixel-consistency
```

优先级：

```text
P0  CSS Animation Stress
P0  3D Mesh + Skeletal Animation

P1  Storage Benchmark
P1  Pixel Consistency
```

---

# 4. 仓库结构

建议 monorepo：

```text
crossui-bench/
├── README.md
├── LICENSE
├── docs/
│   ├── benchmark-methodology.md
│   ├── hardware-profile.md
│   ├── asset-manifest.md
│   └── result-format.md
│
├── shared/
│   ├── protocols/
│   ├── fixtures/
│   └── metrics/
│
├── benchmarks/
│   ├── css-animation/
│   │   ├── shared-web/
│   │   ├── electron/
│   │   ├── tauri/
│   │   └── flutter/
│   │
│   ├── storage/
│   │   ├── electron/
│   │   ├── tauri/
│   │   └── flutter/
│   │
│   ├── skeletal-3d/
│   │   ├── shared-web/
│   │   ├── electron/
│   │   ├── tauri-web/
│   │   ├── tauri-native/
│   │   └── flutter/
│   │
│   └── pixel-consistency/
│       ├── electron/
│       ├── tauri/
│       └── flutter/
│
├── assets/
│   ├── source/
│   ├── generated/
│   ├── ui/
│   ├── 3d/
│   └── licenses/
│
├── tools/
│   ├── asset-generator/
│   ├── screenshot-runner/
│   ├── metrics-collector/
│   └── result-aggregator/
│
└── results/
    ├── raw/
    ├── normalized/
    └── reports/
```

---

# 5. Benchmark 01：CSS Animation Stress

## 5.1 目标

验证：

> WebKit 对现代 CSS 与动效是否存在“普遍性的严重性能问题”。

重点比较：

- Chromium / Electron
- WebView2 / Tauri Windows
- WKWebView / Tauri macOS

Flutter 作为非浏览器自绘参考组。

---

## 5.2 测试项目

每组分别测试以下节点数：

```text
100
500
1000
5000
10000（可选）
```

每种 workload 单独运行。

### Case A：Translate

```css
transform: translate3d(...)
```

### Case B：Scale + Rotate

```css
transform: translate3d(...) rotate(...) scale(...)
```

### Case C：Opacity

```css
opacity
```

### Case D：Blur

```css
filter: blur(...)
```

### Case E：Backdrop Blur

```css
backdrop-filter: blur(...)
```

### Case F：Nested Transform

5~10 层 transform hierarchy。

### Case G：Scroll + Animation

同时执行：

- 大列表滚动
- transform animation
- opacity animation

### Case H：Mixed UI

模拟真实客户端：

```text
Sidebar
Tabs
Chat List
Code Editor placeholder
Modal
Glass panel
Floating toolbar
Animated cards
```

---

## 5.3 Flutter 对应实现

Flutter 不使用 Web CSS，而实现语义等价版本：

```text
Transform
AnimatedBuilder / AnimationController
Opacity
ImageFilter.blur
BackdropFilter
CustomScrollView
```

注意：

Flutter 组不用于证明 Chromium/WebKit API 兼容性。

Flutter 组用于比较：

> 自绘 UI Runtime 在同等视觉 workload 下的性能表现。

---

# 6. Benchmark 02：Storage Benchmark

## 6.1 目标

测试 OPFS 所代表的能力：

> App 私有、本地、持久化、可随机读写的数据存储。

不强制所有框架使用 OPFS。

采用各框架合理实现。

---

## 6.2 实现

### Electron

```text
Node fs
SQLite
```

### Tauri

```text
Rust std::fs / tokio::fs
rusqlite 或 sqlx
```

### Flutter

```text
dart:io
sqlite3 / Drift
```

### 可选 Web Baseline

纯浏览器：

```text
OPFS
SQLite WASM
```

这组只作为 Web 环境参考，不纳入 native framework 主排名。

---

## 6.3 数据集

自动生成：

```text
4 KB
64 KB
1 MB
100 MB
500 MB
1 GB
5 GB
10 GB
```

同时准备：

```text
Random bytes
Compressible bytes
```

Small file case：

```text
1,000 files
10,000 files
100,000 files
```

单文件大小：

```text
4 KB
16 KB
64 KB
```

---

## 6.4 测试项

```text
Sequential write
Sequential read
Random read
Random write
File create
File delete
Directory scan
SQLite insert
SQLite batch insert
SQLite indexed query
SQLite random update
SQLite transaction
SQLite VACUUM
```

---

# 7. Benchmark 03：3D Mesh + Skeletal Animation

这是首期最重要的实验之一。

## 7.1 目标

直接验证以下说法：

> “在 WebView 中加载 2.1GB 3D 模型并驱动骨骼动画时，Chromium 与 WebKit 会产生巨大性能差距。”

测试必须区分：

```text
Load / Decode
GPU Upload
Animation Sampling
Bone Matrix Update
Skinning
Rendering
Frame Presentation
```

避免只得到一个 FPS 数字但无法定位瓶颈。

---

# 8. 3D 技术路径

## 8.1 Electron

第一阶段：

```text
Three.js
+
WebGL2
```

第二阶段可选：

```text
WebGPU renderer
```

---

## 8.2 Tauri Web

与 Electron **100% 共用相同前端源码**：

```text
Three.js
same scene
same assets
same shaders
same settings
```

目标是直接测试：

```text
Chromium
vs
WebView2
vs
WKWebView
```

禁止针对某个 Runtime 单独做性能优化。

---

## 8.3 Tauri Native

作为 Best Practice Test：

```text
Tauri UI
    ↓
Rust
    ↓
wgpu
    ↓
Metal / Vulkan / DX12
```

3D heavy path 不经过 WebView。

可以使用 WebView 做：

```text
控制面板
场景参数
结果显示
```

Native canvas / GPU surface 负责渲染。

---

## 8.4 Flutter

需要单独定义 3D backend。

首选目标：

```text
Flutter UI
    ↓
FFI / native renderer
    ↓
wgpu 或等价 native 3D backend
```

如果当前 Flutter 原生 GPU API 能稳定满足需求，也可建立第二实现。

但 Benchmark 中必须记录：

```text
backend name
backend version
render path
```

禁止模糊记录成“Flutter”。

---

# 9. 3D 素材体系

## 9.1 格式

统一首选：

```text
glTF 2.0 / GLB
```

因为需要包含：

```text
Mesh
Material
Texture
Skeleton
Skin
Animation
Morph Target
```

---

# 10. 3D Baseline Assets

必须包含以下基础资产。

## 10.1 Khronos glTF Sample Assets

作为 correctness baseline：

```text
RiggedSimple
RiggedFigure
RecursiveSkeletons
BoxAnimated
SimpleMorph
DamagedHelmet
FlightHelmet
```

用途：

- loader correctness
- skinning correctness
- animation correctness
- PBR correctness
- morph correctness

---

## 10.2 Kenney Rigged Character

准备至少一个：

```text
Low-poly humanoid
Rigged
Idle
Walk
Run
Jump
```

用途：

```text
多角色实例压力测试
```

要求：

- license 可再分发
- 优先 CC0

---

## 10.3 PBR / HDRI

使用 license 清晰的 CC0 资产，例如 Poly Haven。

准备：

```text
PBR 2K
PBR 4K
PBR 8K

HDRI 1K
HDRI 4K
HDRI 8K
HDRI 16K
```

---

# 11. Stress Asset Generator

不要依赖网上寻找“恰好 2.1GB 的角色模型”。

必须建立：

```text
tools/asset-generator
```

自动从基础 GLB 生成压力资产。

---

## 11.1 文件大小档位

生成：

```text
100 MB
500 MB
1 GB
2.1 GB
```

注意：

不能简单 padding 文件。

必须通过真实资源增加体积。

允许：

```text
Texture
Geometry
Animation data
Morph data
Multiple meshes
```

---

# 12. Geometry Stress

生成以下 Triangle 档位：

```text
100K
500K
1M
5M
10M
```

记录：

```text
vertex count
index count
triangle count
mesh count
material count
```

---

# 13. Skeleton Stress

生成：

```text
50 bones
100 bones
250 bones
500 bones
1000 bones
```

要求：

- 所有骨骼都参与 hierarchy
- 至少部分 bone 对 mesh 有真实权重影响
- 不允许全部只是无效 dummy node

可以允许少量 helper bones，但 Benchmark metadata 必须记录：

```text
effective skinning bones
total hierarchy bones
```

---

# 14. Character Count Stress

同屏：

```text
1
10
50
100
250
500
```

每个角色独立动画时间偏移，防止所有动画完全同步导致 Runtime 做特殊优化。

例如：

```text
animationTime =
globalTime + instanceIndex * 0.037
```

---

# 15. Animation Assets

至少：

```text
Idle
Walk
Run
Jump
Dance / complex full-body
```

此外准备一个高频运动动画：

```text
Fast Motion
```

用于提高 skeleton update 压力。

---

# 16. Morph Target Stress

生成：

```text
0
10
20
50
100
```

个 morph target。

测试：

```text
Static morph
Animated morph
Skeleton + morph combined
```

---

# 17. Texture Stress

同一场景分别运行：

```text
1K
2K
4K
8K
```

纹理至少包含：

```text
Base Color
Normal
Roughness
Metallic
AO
```

需要单独记录：

```text
raw texture size
compressed asset size
GPU texture size estimate
```

---

# 18. 2.1GB 综合模型

最终构造：

```text
mega-2_1gb.glb
```

但必须知道它为什么是 2.1GB。

建议资产构成报告：

```text
Geometry       420 MB
Textures      1450 MB
Animations      80 MB
Morph Data      90 MB
Other           ...
```

不要把“2.1GB”当成唯一性能指标。

同时建立三个不同 2.1GB workload：

```text
2.1GB-texture-heavy
2.1GB-geometry-heavy
2.1GB-mixed
```

这是非常关键的设计。

否则“加载 2.1GB 模型”本身没有足够技术意义。

---

# 19. 3D Benchmark Case

## Case 1：Static Load

```text
Load GLB
Decode
Upload GPU
Render first frame
```

记录：

```text
File load
Parse
Texture decode
GPU upload
TTFM
```

TTFM：

> Time To First Mesh

---

## Case 2：Single Character

```text
1 Character
100 bones
1M triangles
4K textures
Run animation
```

---

## Case 3：Skeleton Scaling

固定 geometry：

```text
1M triangles
```

改变：

```text
50
100
250
500
1000 bones
```

---

## Case 4：Geometry Scaling

固定：

```text
100 bones
```

改变：

```text
100K
500K
1M
5M
10M triangles
```

---

## Case 5：Character Scaling

固定单角色：

```text
100 bones
100K triangles
```

数量：

```text
1 / 10 / 50 / 100 / 250 / 500
```

---

## Case 6：Texture Scaling

```text
1K
2K
4K
8K
```

---

## Case 7：2.1GB Asset

分别：

```text
texture-heavy
geometry-heavy
mixed
```

---

## Case 8：Combined Maximum Stress

同时开启：

```text
Large GLB
Skeleton animation
Morph animation
PBR
HDRI
Multiple characters
Camera motion
Dynamic lights
```

逐渐提高 workload，直到：

```text
FPS < 30
或
OOM
或
程序失去响应
```

记录 failure point。

---

# 20. Benchmark 指标

所有 Runtime 尽量记录：

```text
Cold startup time

Asset load time
Parse time
Texture decode time
GPU upload time

TTFM
TTFA
```

TTFA：

> Time To First Animated Frame

Frame：

```text
FPS average
Frame p50
Frame p95
Frame p99
Worst frame
Dropped frame %
```

Resource：

```text
CPU average
CPU peak

GPU utilization
GPU memory（能取得时）

RSS
Private memory
Peak RSS
```

Animation：

```text
Animation sampling time
Bone matrix update
Skinning time
Render time
```

---

# 21. Benchmark 04：Pixel Consistency

## 21.1 目标

验证 Electron / Tauri / Flutter 在不同系统下：

```text
布局
尺寸
颜色
字体
阴影
Blur
动画最终状态
```

的视觉一致性。

---

## 21.2 Fixture

统一设计 6 个界面：

```text
01 Dashboard
02 Chat
03 Code Editor
04 Settings
05 Media Player
06 Complex Modal
```

必须包含：

```text
Text
SVG icon
Image
Gradient
Shadow
Blur
Border
Input
Button
List
Scroll
Nested layout
```

---

## 21.3 截图环境

固定：

```text
Window size
Device pixel ratio
Font
Locale
Theme
Scale
```

截图后进行：

```text
Pixel diff
SSIM
Geometry diff
Text bounding-box diff
```

不要要求不同 OS GPU 输出 bit-identical。

重点判断：

```text
Layout parity
Visual parity
```

---

# 22. UI 素材

使用固定字体资产，禁止依赖系统默认字体进行 Pixel Consistency 主测试。

例如：

```text
Inter
Noto Sans
```

但最终字体必须确认 license 可分发。

Icon：

```text
Lucide
或
Material Symbols
```

图片：

自动生成或使用明确开放许可素材。

---

# 23. Asset Manifest

所有资产必须记录：

```yaml
id:
name:
source:
license:
license_url:
redistributable:
format:
size_bytes:
triangles:
vertices:
bones:
effective_skinning_bones:
animations:
morph_targets:
texture_resolution:
notes:
```

生成资产额外记录：

```yaml
generated_from:
generator_version:
generation_parameters:
sha256:
```

---

# 24. Benchmark Hardware Metadata

每次 Benchmark 必须保存：

```yaml
os:
os_version:

cpu:
cpu_arch:
cpu_cores:

ram:

gpu:
gpu_driver:

display_resolution:
display_scale:
refresh_rate:

runtime:
runtime_version:
webview_version:

framework:
framework_version:

build_mode:
```

禁止把不同机器上的原始 FPS 直接作为框架优劣结论。

---

# 25. 测试运行要求

## 25.1 Release Only

正式数据：

```text
Electron production build
Tauri release
Flutter release
```

Debug 数据不得进入正式结果。

---

## 25.2 Warm-up

每项动态 benchmark：

```text
Warm-up 10 sec
Measure 30 sec
Cool down 5 sec
```

至少：

```text
5 runs
```

最终报告：

```text
median
min
max
variance
```

---

## 25.3 固定刷新率

优先：

```text
60 Hz
120 Hz
```

分别测试。

如果硬件不支持 120Hz，只运行 60Hz 并记录。

---

# 26. 原始数据格式

每次测试生成：

```json
{
  "benchmark": "skeletal-3d",
  "case": "character-scaling",
  "runtime": "tauri-wkwebview",
  "asset": "character-100k-100bones",
  "characterCount": 100,
  "fpsAverage": 0,
  "frameP50Ms": 0,
  "frameP95Ms": 0,
  "frameP99Ms": 0,
  "peakMemoryMb": 0,
  "cpuAverage": 0,
  "gpuAverage": 0,
  "ttfmMs": 0,
  "ttfaMs": 0
}
```

不要只保存汇总结果。

同时保存：

```text
raw frame timing series
```

方便后续重新分析。

---

# 27. 第一阶段 Codex 开发任务

Codex 不应一次实现全部项目。

第一阶段只完成基础设施和两个 P0 Benchmark。

## Sprint 1

目标：

```text
仓库初始化
benchmark protocol
metadata schema
metrics collector
asset manifest
```

完成：

- monorepo
- Electron shell
- Tauri shell
- Flutter shell
- 统一结果 JSON schema
- 系统信息采集
- README

---

## Sprint 2

完成：

```text
CSS Animation Stress
```

Electron 与 Tauri 必须共用：

```text
shared-web
```

Flutter 实现语义等价场景。

---

## Sprint 3

完成：

```text
3D Mesh baseline
```

先只支持：

```text
RiggedSimple
RiggedFigure
1 low-poly character
```

实现：

```text
load
render
single skeleton animation
FPS/frame timing
```

暂时不做 2.1GB。

---

## Sprint 4

实现：

```text
asset-generator
```

至少支持：

```text
triangle scaling
bone scaling
character duplication
texture scaling
```

之后再产生：

```text
100MB
500MB
1GB
2.1GB
```

---

# 28. 第一版完成定义

v0.1 必须能够在同一台机器上运行：

```text
Electron
Tauri
Flutter
```

并输出：

### CSS

```text
100 / 500 / 1000 / 5000 nodes
transform
opacity
blur
mixed
```

### 3D

```text
single rigged character
100K triangles
1M triangles
50 / 100 / 250 bones
1 / 10 / 50 characters
```

并生成统一：

```text
JSON report
CSV summary
Markdown report
```

---

# 29. 暂缓内容

v0.1 暂时不要：

```text
移动端 benchmark
WebGPU 全覆盖
10GB asset
复杂视频剪辑
音频 DSP
AI inference
完整 Flutter 3D engine
完整 benchmark dashboard
云端跑分
```

避免 scope 爆炸。

---

# 30. 成功标准

这个项目的成功不是“Tauri 赢了”。

成功标准是：

1. 所有 Benchmark 可复现。
2. 所有输入素材可追溯。
3. Runtime 差异和 framework implementation 差异能分开。
4. 可以定位性能瓶颈属于：
   - CPU
   - GPU
   - WebView
   - IO
   - parser
   - renderer
   - animation
5. 对争议观点可以用数据回答，而不是凭经验判断。

最终项目应该能够回答类似：

```text
“在 macOS 上，
对于 5000 个 transform animated elements，
WKWebView 的 p99 frame time
比 Chromium 高多少？”
```

以及：

```text
“对于 2.1GB geometry-heavy GLB，
Electron / Tauri Web / Tauri Native / Flutter
的 TTFA、Peak RSS 和 p99 frame time
分别是多少？”
```

这才是 CrossUI Bench 的最终价值。

---

# 31. Codex 开工 Prompt

可以直接把下面内容交给 Codex：

> 阅读仓库中的 CrossUI Bench 设计文档。不要一次实现全部 Benchmark。
>
> 第一阶段目标是建立一个可复现的 Electron / Tauri / Flutter 跨平台 Benchmark 基础设施。
>
> 先完成：
>
> 1. monorepo 目录结构；
> 2. Electron、Tauri、Flutter 三个最小运行壳；
> 3. Electron 与 Tauri 共用 shared-web；
> 4. benchmark metadata 与结果 JSON schema；
> 5. 系统与 Runtime 信息采集；
> 6. CSS Animation Stress Benchmark；
> 7. 输出 raw JSON、summary CSV、Markdown report。
>
> 然后实现 3D baseline：
>
> - glTF/GLB loader；
> - RiggedSimple / RiggedFigure；
> - 单角色骨骼动画；
> - FPS / frame p50 / p95 / p99；
> - CPU / RSS；
> - TTFM / TTFA。
>
> 暂时不要实现 2.1GB stress asset。先建立 tools/asset-generator 的接口和 manifest schema。
>
> 所有 Benchmark 必须遵守：
>
> - release build；
> - warm-up；
> - 多轮运行；
> - 统一输出 schema；
> - Electron/Tauri Web 尽可能共享实现；
> - 不根据预期结论调整 workload；
> - 所有不可直接比较的数据必须在报告中标注。
>
> 每完成一个阶段，先确保测试可以自动运行并生成结果文件，再进入下一阶段。
