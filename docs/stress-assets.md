# 2.1GB 分类压力模型

2026-10-07 已实际生成以下三个 GLB，每份目标为十进制 2,100,000,000 字节。文件在 `artifacts/stress/`，不纳入 Git，不复制到 Vite/Tauri 应用包。

| 配方           |      实际字节 |    三角形 | 2048² PNG 数量 | 几何 / 纹理字节             |
| -------------- | ------------: | --------: | -------------: | --------------------------- |
| geometry-heavy | 2,100,000,164 | 8,380,127 |              5 | 1,810,107,432 / 83,903,060  |
| texture-heavy  | 2,100,000,008 |   611,663 |            105 | 132,119,208 / 1,761,964,260 |
| mixed          | 2,100,000,088 | 4,398,149 |             50 | 950,000,184 / 839,030,600   |

每份均包含 100 个有效蒙皮骨骼、20 个 morph targets、骨骼及 morph 动画。体积由实际几何、动画、morph 和已引用贴图构成，无额外填充。生成器流式写入，生成峰值内存不到 500MiB；渲染器完整加载的内存需求更高。

全部大文件均完成全量顶点、骨骼权重、法线/切线、动画、morph、PNG CRC/解码、资源引用与 SHA-256 校验，详见同目录 `.validation.json`。三种 10MB 缩小配方通过 Khronos 官方 glTF Validator，均零错误、零警告。完整清单及哈希保存在 [stress-assets.manifest.json](stress-assets.manifest.json)。官方校验器未对 2.1GB 文件整体载入校验；大文件使用独立的流式校验程序。

## 复现和加载

```sh
npm run assets:stress -- --profile=all
npm run assets:stress:verify
npm run assets:stress:serve
```

已有文件时生成器拒绝覆盖；可用 `--output=artifacts/another-set` 指定新目录。服务仅监听 `127.0.0.1:1490`。启动后 Electron/Tauri 的模型下拉框自动列出三份模型；也可通过 `BENCH_QUERY` 使用 `asset=stress/mega-2_1gb-mixed`（其他配方替换最后一段）。

```sh
BENCH_QUERY='benchmark=skeletal-3d&asset=stress/mega-2_1gb-mixed&characters=1&warmupMs=100&measureMs=500&cooldownMs=50&runs=1' npm run bench:electron
```

此命令只做短时加载诊断，不产生正式跑分结论。正式对比应遵守设计文档固定刷新率、供电和完整采样要求。两种壳共用相同加载器与本地 HTTP 服务；服务进程 CPU/RSS 不计入应用进程树，会在结果中标注。渲染器核验文件长度并记录已全量校验的 SHA-256，避免再复制大文件做浏览器哈希；修改文件后应重新执行校验。

## 使用边界

这些是 CC0 可复现合成压力模型，采用程序生成的蒙皮圆柱与确定性 PBR 贴图。PNG 使用 DEFLATE stored 块，动画采样密度较高；不能代表真实美术资产的压缩率、拓扑、视觉质量及动画采样习惯。纹理配方测试的载入、解码及 GPU 上传压力也受该编码选择影响。GPU 纹理估算含 mip 链，但不含几何、渲染目标和驱动开销。

文件准备与格式验证已完成。三份完整 2.1GB 文件已分别在 Electron 38.8.6 和 Tauri 2.12.1 的 macOS release 壳中完成短时加载与动画采样，六次均成功且源码指纹一致。原始结果链接见 [完整模型加载诊断](../results/reports/stress-load.md)。该验证使用单次 100ms 预热、500ms 测量、50ms 冷却，固定刷新率未确认，不构成正式性能排名，也未测得加载阶段的峰值内存。

## 完整协议矩阵

`npm run bench:stress -- --fixed60` 仅在操作者已确认固定 60Hz、关闭自适应刷新、接通电源后执行。保持当前环境时使用 `npm run bench:stress -- --diagnostic`，结果明确排除正式资格。运行器串行构建共享 bundle，然后按每种配方交替运行 Electron/Tauri，各 5 轮，每轮 10s 预热、30s 测量、5s 冷却；预计约 25 分钟。结果独立保存至 `results/stress-benchmark/<时间>/`，不会混入此前短时诊断。

2026-10-07 已完成固定 60Hz 的上述完整矩阵，见 [五轮正式协议结果](../results/stress-benchmark/2026-10-07T10-55-31.193Z/reports/conclusion.md)。自动测试窗口保持置顶；之前取消、超时的尝试不在该报告中。
