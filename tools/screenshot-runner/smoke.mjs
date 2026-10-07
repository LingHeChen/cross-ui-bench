import { chromium, _electron as electron } from "playwright";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { validateResult } from "../result-aggregator/index.mjs";
const server = spawn(
  process.execPath,
  ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1"],
  { stdio: "pipe" },
);
let browser;
try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch("http://127.0.0.1:1420")).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:1420");
  await page.waitForFunction(() => window.__BENCH_START__);
  await mkdir("results/reports", { recursive: true });
  await page.screenshot({
    path: "results/reports/console.png",
    fullPage: true,
  });
  for (const caseName of [
    "translate",
    "scale-rotate",
    "opacity",
    "blur",
    "backdrop-blur",
    "nested-transform",
    "scroll-animation",
    "mixed",
  ]) {
    await page.selectOption("#case", caseName);
    await page.evaluate(() =>
      window.__BENCH_START__({
        warmupMs: 50,
        measureMs: 200,
        cooldownMs: 20,
        runs: 2,
      }),
    );
    const result = await page.evaluate(() => window.__BENCH_RESULT__);
    assert.equal(result.case, caseName);
    assert.equal(result.runs.length, 2);
    assert.equal(result.qualification.eligible, false);
    validateResult(result);
    console.log(`PASS web CSS ${caseName}`);
  }
  await page.click('[data-bench="skeletal-3d"]');
  for (const asset of [
    "RiggedSimple",
    "RiggedFigure",
    "generated/character-lowpoly",
  ]) {
    await page.selectOption("#asset", asset);
    await page.evaluate(() => {
      window.__BENCH_RESULT__ = null;
      return window.__BENCH_START__({
        warmupMs: 50,
        measureMs: 200,
        cooldownMs: 20,
        runs: 1,
      });
    });
    const result = await page.evaluate(() => window.__BENCH_RESULT__);
    assert.ok(result, await page.evaluate(() => window.__BENCH_ERROR__));
    assert.equal(result.asset, asset);
    assert.ok(result.loadMetrics.ttfaMs > 0);
    assert.match(result.assetSha256, /^[a-f0-9]{64}$/);
    validateResult(result);
    console.log(`PASS WebGL2 ${asset}`);
  }
  await page.evaluate(() => {
    window.__BENCH_RESULT__ = null;
    window.__BENCH_START__({
      warmupMs: 100,
      measureMs: 5000,
      cooldownMs: 0,
      runs: 1,
    });
  });
  await page.waitForFunction(
    () => document.getElementById("phase").textContent === "MEASURE",
  );
  await page.evaluate(() =>
    document
      .querySelector("#stage canvas")
      .getContext("webgl2")
      .getExtension("WEBGL_lose_context")
      .loseContext(),
  );
  await page.waitForFunction(
    () => document.getElementById("phase").textContent === "FAILED",
  );
  assert.equal(await page.evaluate(() => window.__BENCH_RESULT__), null);
  console.log("PASS lost GPU context invalidates experiment");
  await page.click('[data-bench="css-animation"]');
  // Start and cancel using UI to verify the interaction contract.
  await page.click("#run");
  await page.waitForSelector("#cancel:not([hidden])");
  await page.click("#cancel");
  await page.waitForFunction(
    () => document.getElementById("phase").textContent === "CANCELLED",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "results/reports/console-mobile.png",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  assert.deepEqual(errors, []);
  console.log("PASS cancellation, mobile layout, zero page errors");
} finally {
  await browser?.close();
  server.kill();
}
if (process.argv.includes("--electron")) {
  const app = await electron.launch({
    args: ["apps/electron/main.cjs"],
    env: {
      ...process.env,
      BENCH_QUERY:
        "auto=1&nodes=100&warmupMs=100&measureMs=500&cooldownMs=50&runs=2",
    },
  });
  try {
    const page = await app.firstWindow();
    await page.waitForFunction(
      () => window.__BENCH_RESULT__,
      {},
      { timeout: 30000 },
    );
    const result = await page.evaluate(() => window.__BENCH_RESULT__);
    validateResult(result);
    assert.equal(result.runtime, "electron-chromium");
    assert.ok(result.runs[0].resources[0].rssMb > 0);
    console.log("PASS Electron release shell, IPC, native resources, raw JSON");
  } finally {
    await app.close();
  }
}
