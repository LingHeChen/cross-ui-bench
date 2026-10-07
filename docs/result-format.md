# 结果格式

版本 1.0.0，schema 位于 `shared/protocols/`。原始结果按 UUID 保存。每个文件是一组同参数实验（多 repetitions），`runs` 必须匹配 `protocol.runs`。含 case / runtime / implementation / comparisonClass / metadata / protocol / qualification / limitations。

每轮 `frames: [{tMs, dtMs}]`，Flutter 另有 buildMs / rasterMs。tMs 为该轮采集时序相对时间。`resources: [{tMs,cpuPercent,rssMb,processCount?}]`。资源未知值为 null，CPU单位为 one-core percent，RSS 单位 MiB（1024²）。RAM metadata 单位 bytes。字段名 `Mb` 兼容设计文档，但实际单位为 MiB。

`metrics` 为每轮统计；`summary` 每个指标含 median / min / max / population variance。FPS与percentile只由raw series重新计算。负载准备 / 3D load 与渲染首次提交时序在每轮 loadMetrics 保存，top-level loadMetrics 只是最后一轮的便利副本，不能当多轮汇总。`loadSummary` 从各轮 loadMetrics 计算 median/min/max/variance，CSV 的 TTFM/TTFA 使用其中位数。

缺失数据不可填 0。报告保留 protocol、机器、asset hash、资源作用域和采样限制。`eligible` 只是完整协议门槛，不是比较充分条件。

CSV 每行对应一个配置；Markdown 表与结果详情对应相同 UUID；normalized JSON 可追溯 raw JSON。不要删除 raw，仅保留平均 FPS。

`metadata.benchmark_source_sha256` 标识 workload/采集源码与锁定依赖。Web两组必须使用相同hash；Flutter是独立源码hash。它不是最终二进制的hash，硬件、assets与协议仍必须分别核对。
