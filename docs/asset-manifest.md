# 素材与许可

`assets/manifest.json` 包含 RiggedSimple / RiggedFigure 的固定 commit 来源、bytes、SHA-256、triangle/vertex/bone counts、animations。原始模型版权为 Cesium (2017)，CC-BY-4.0；完整归属和许可链接保存在 `assets/licenses/RiggedSimple.md` 与 `RiggedFigure.md`。项目使用原 GLB，不声称独立创作这些模型。

上游：https://github.com/KhronosGroup/glTF-Sample-Assets 。下载脚本先解析 commit SHA 再使用 immutable source URL。提交的本地二进制与 manifest 为一套固定输入；重新运行 fetch 会跟随当时 main，可能改变实验资产，必须重新记录 hash。

`assets/ui-manifest.json`：IBM Plex Sans / Mono（OFL-1.1，npm lock 固定版本，本地 WOFF/WOFF2，不依赖在线字体）、原创 SVG icon（MIT）。字体许可在 assets/licenses。Flutter pixel fixtures 尚未建立，其当前控制台字体不纳入像素一致性测试。

`assets/generated/*.manifest.json`：原创程序生成几何、层级骨骼、权重、PNG纹理、旋转动画（CC0-1.0）。生成器版本、完整参数、SHA-256、有效 skinned bones、raw / GPU texture estimate 在 manifest 中保存。所有体积来自实际 glTF resources，无 padding。生成物默认不入 git，使用参数重建。

计划但未引入：Kenney CC0 多动作角色、其他 Khronos correctness 模型、Poly Haven PBR/HDRI。必须逐项确认模型授权后才添加，不能从网站“免费”标签推断再分发权。
