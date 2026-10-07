import { _electron } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { ssim } from "ssim.js";
const root = path.resolve(process.argv[2] ?? "results/full-benchmark");
fs.mkdirSync(root + "/pixel", { recursive: true });
const fixtures = JSON.parse(fs.readFileSync("assets/pixel/fixtures.json"));
const flutter = path.resolve(
  "apps/flutter/build/macos/Build/Products/Release/crossui_bench.app/Contents/MacOS/crossui_bench",
);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function ready(file, child) {
  for (let i = 0; i < 100; i++) {
    if (fs.existsSync(file)) return;
    if (child.exitCode !== null)
      throw Error("Pixel process exited before readiness");
    await wait(200);
  }
  throw Error("Pixel capture timeout");
}
const comparisons = [];
for (const fixture of fixtures) {
  for (const runtime of ["electron", "tauri", "flutter"]) {
    const base = path.join(root, "pixel", `${fixture.id}-${runtime}`);
    if (fs.existsSync(base + ".png") && fs.existsSync(base + ".json")) continue;
    const query = new URLSearchParams({
      benchmark: "pixel",
      fixture: fixture.id,
    });
    if (runtime === "electron") {
      const app = await _electron.launch({
        args: ["apps/electron/main.cjs", "--auto"],
        env: { ...process.env, BENCH_QUERY: query.toString() },
      });
      try {
        const page = await app.firstWindow();
        await page.waitForFunction(() => window.__PIXEL_READY__, {
          timeout: 30000,
        });
        const metadata = await page.evaluate(() => window.__PIXEL_READY__);
        await page.screenshot({ path: base + ".png", scale: "device" });
        fs.writeFileSync(
          base + ".json",
          JSON.stringify(
            { ...metadata, runtime: "electron-chromium" },
            null,
            2,
          ),
        );
      } finally {
        await app.close();
      }
    } else if (runtime === "tauri") {
      const child = spawn(
        path.resolve("apps/tauri/target/release/crossui-bench"),
        [],
        {
          env: {
            ...process.env,
            BENCH_QUERY: query.toString(),
            BENCH_AUTO: "1",
            BENCH_PIXEL_OUTPUT: base,
          },
          stdio: "pipe",
        },
      );
      try {
        await ready(base + ".json", child);
        await wait(300);
        const id = execFileSync("artifacts/window-id", [String(child.pid)], {
          encoding: "utf8",
        }).trim();
        const full = base + ".window.png";
        execFileSync("screencapture", ["-l", id, "-o", "-x", full]);
        const image = PNG.sync.read(fs.readFileSync(full));
        const cropped = new PNG({ width: 2560, height: 1600 });
        if (image.width !== 2560 || image.height < 1600)
          throw Error(
            `Unexpected native screenshot ${image.width}x${image.height}`,
          );
        PNG.bitblt(image, cropped, 0, image.height - 1600, 2560, 1600, 0, 0);
        fs.writeFileSync(base + ".png", PNG.sync.write(cropped));
      } finally {
        child.kill("SIGTERM");
        await new Promise((resolve) => child.on("exit", resolve));
      }
    } else {
      const config = {
        fixture: fixture.id,
        assetRoot: path.resolve("assets"),
        output: base,
      };
      fs.writeFileSync(base + ".config.json", JSON.stringify(config));
      const child = spawn(flutter, [], {
        env: {
          ...process.env,
          BENCH_PIXEL_CONFIG: base + ".config.json",
          BENCH_AUTO: "1",
        },
        stdio: "pipe",
      });
      await new Promise((resolve, reject) => {
        child.on("error", reject);
        const timer = setTimeout(() => {
          child.kill();
          reject(Error("Flutter pixel timeout"));
        }, 30000);
        child.on("exit", (code) => {
          clearTimeout(timer);
          code === 0
            ? resolve()
            : reject(Error(`Flutter pixel failed ${code}`));
        });
      });
    }
    console.log(`PIXEL_CAPTURE ${fixture.id} ${runtime}`);
  }
  const reference = PNG.sync.read(
      fs.readFileSync(path.join(root, "pixel", fixture.id + "-electron.png")),
    ),
    aMeta = JSON.parse(
      fs.readFileSync(path.join(root, "pixel", fixture.id + "-electron.json")),
    );
  for (const runtime of ["tauri", "flutter"]) {
    const img = PNG.sync.read(
        fs.readFileSync(
          path.join(root, "pixel", fixture.id + "-" + runtime + ".png"),
        ),
      ),
      meta = JSON.parse(
        fs.readFileSync(
          path.join(root, "pixel", fixture.id + "-" + runtime + ".json"),
        ),
      );
    if (
      img.width !== reference.width ||
      img.height !== reference.height ||
      meta.dpr !== aMeta.dpr
    )
      throw Error("Pixel geometry mismatch");
    const diff = new PNG({ width: img.width, height: img.height });
    const count = pixelmatch(
      reference.data,
      img.data,
      diff.data,
      img.width,
      img.height,
      { threshold: 0.1, includeAA: false },
    );
    const file = `${fixture.id}-${runtime}-diff.png`;
    fs.writeFileSync(path.join(root, "pixel", file), PNG.sync.write(diff));
    const geometry = [],
      text = [];
    for (const [id, b] of Object.entries(aMeta.bounds)) {
      const v = meta.bounds[id];
      if (!v) {
        geometry.push({ id, missing: true });
        continue;
      }
      geometry.push({
        id,
        maxDelta: Math.max(
          ...["x", "y", "width", "height"].map((k) => Math.abs(b[k] - v[k])),
        ),
      });
      if (b.textBounds && v.textBounds)
        text.push({
          id,
          maxDelta: Math.max(
            ...["x", "y", "width", "height"].map((k) =>
              Math.abs(b.textBounds[k] - v.textBounds[k]),
            ),
          ),
        });
    }
    // SSIM uses a deterministic 640x400 downsample for bounded compute, disclosed in output.
    const down = (im) => {
      const data = new Uint8Array(640 * 400 * 4);
      for (let y = 0; y < 400; y++)
        for (let x = 0; x < 640; x++) {
          let i = (y * 640 + x) * 4,
            j = (y * 4 * im.width + x * 4) * 4;
          data.set(im.data.subarray(j, j + 4), i);
        }
      return { data, width: 640, height: 400 };
    };
    comparisons.push({
      fixture: fixture.id,
      runtime,
      reference: "electron",
      width: img.width,
      height: img.height,
      pixelDiffCount: count,
      pixelDiffPercent: (100 * count) / (img.width * img.height),
      threshold: 0.1,
      includeAA: false,
      ssim: ssim(down(reference), down(img), { ssim: "fast" }).mssim,
      ssimSampling: "every fourth pixel, 640x400",
      geometry,
      textBounds: text,
      diffImage: "pixel/" + file,
      referenceImage: `pixel/${fixture.id}-electron.png`,
      comparisonImage: `pixel/${fixture.id}-${runtime}.png`,
      class:
        runtime === "flutter" ? "semantic visual reference" : "runtime-parity",
    });
  }
  fs.writeFileSync(
    root + "/pixel/results.json",
    JSON.stringify(
      {
        schemaVersion: "pixel-1",
        comparisons,
        fixtures: fixtures.map((f) => f.id),
      },
      null,
      2,
    ),
  );
}
console.log("PIXEL_COMPLETE " + root + "/pixel/results.json");
