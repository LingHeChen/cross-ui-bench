# 发布 HTML 报告

公开地址：https://linghechen.github.io/cross-ui-bench/

GitHub Pages 使用 `gh-pages` 分支根目录。源码保留在 `main`。发布的是报告快照，本机后续成绩不会自动同步到云端；矩阵结束后应重新导出并推送。

```sh
node tools/export-pages.mjs results/full-benchmark artifacts/pages
```

导出器读取 HTML 内嵌的同一份数据快照，仅复制它引用的 PNG 和原始 JSON。历史 2.1GB 链接改为 `prior-2.1GB/raw/`，字体和脚本内嵌；无需上传模型、日志、构建产物或存储临时数据。证据 JSON 中本机用户主目录名称会脱敏，数值与源码指纹保持不变。

首次发布可在导出目录建立独立的 `gh-pages` Git 仓库，设置本仓库的 origin 并推送。之后在相同导出目录更新：

```sh
git -C artifacts/pages add .
git -C artifacts/pages commit -m "Update benchmark report snapshot"
git -C artifacts/pages push origin gh-pages
```

在另一台机器更新时，先 clone `gh-pages` 分支作为导出目录。`publication.json` 记录报告采集时间和导出时的源码 commit。页面正文的成绩覆盖和未完成说明以报告内嵌数据为准。
