const { app, BrowserWindow, ipcMain, screen } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const root = path.resolve(__dirname, "../..");
const dev = process.argv.includes("--dev"),
  auto = process.argv.includes("--auto");
let window, hardware, persistResult;
app.whenReady().then(async () => {
  if (process.env.BENCH_STORAGE_CONFIG) {
    try {
      const { runStorage } = await import(
        pathToFileURL(path.join(root, "benchmarks/storage/node.mjs"))
      );
      const config = JSON.parse(
        require("node:fs").readFileSync(
          process.env.BENCH_STORAGE_CONFIG,
          "utf8",
        ),
      );
      await runStorage(config);
      app.exit(0);
    } catch (e) {
      console.error(e);
      app.exit(1);
    }
    return;
  }
  ({ hardware } = await import(
    pathToFileURL(path.join(root, "tools/metrics-collector/hardware.mjs"))
  ));
  ({ persistResult } = await import(
    pathToFileURL(path.join(root, "tools/result-aggregator/index.mjs"))
  ));
  const host = hardware();
  ipcMain.handle("metadata", () => {
    const display = screen.getDisplayMatching(window.getBounds());
    return {
      ...host,
      runtime: "electron-chromium",
      runtime_version: process.versions.electron,
      webview_version: process.versions.chrome,
      framework: "electron",
      framework_version: process.versions.electron,
      build_mode: dev ? "debug" : "release",
      display_resolution: `${display.size.width}x${display.size.height}`,
      display_scale: display.scaleFactor,
      refresh_rate: display.displayFrequency || null,
      locale: app.getLocale(),
      resource_scope:
        "application process tree; CPU percent is one-core normalized",
    };
  });
  ipcMain.handle("sample", () => {
    const processes = app.getAppMetrics();
    return {
      tMs: Date.now(),
      cpuPercent: processes.reduce(
        (s, p) => s + (p.cpu.percentCPUUsage || 0),
        0,
      ),
      rssMb: processes.reduce(
        (s, p) => s + (p.memory.workingSetSize || 0) / 1024,
        0,
      ),
      processCount: processes.length,
    };
  });
  ipcMain.handle("save", async (_event, result) => {
    const filename = await persistResult(
      result,
      path.join(root, "results/raw"),
    );
    console.log(`RESULT ${filename}`);
    if (auto) setTimeout(() => app.quit(), 200);
    return filename;
  });
  window = new BrowserWindow({
    width: 1280,
    height: 800,
    useContentSize: true,
    minWidth: 1000,
    minHeight: 720,
    backgroundColor: "#101410",
    show: true,
    alwaysOnTop: auto,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  const query = Object.fromEntries(
    new URLSearchParams(process.env.BENCH_QUERY || ""),
  );
  if (auto) query.auto = "1";
  if (dev)
    await window.loadURL(
      `http://127.0.0.1:1420/?${new URLSearchParams(query)}`,
    );
  else await window.loadFile(path.join(root, "dist/index.html"), { query });
  window.webContents.on("console-message", (event) => {
    const message = event.message;
    if (message.startsWith("BENCH_ERROR")) {
      console.error(message);
      if (auto) app.exit(1);
    }
  });
});
app.on("window-all-closed", () => app.quit());
