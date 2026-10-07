import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = path.resolve(process.argv[2] ?? "results/full-benchmark");
const site = path.resolve("artifacts/pages");
const statusFile = path.resolve("artifacts/storage-publication-status.json");
const lock = path.resolve("artifacts/storage-publication.lock");
const url = "https://linghechen.github.io/cross-ui-bench/";
const runtimes = ["electron", "tauri", "flutter"];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const read = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};
function status(stage, details = {}) {
  const record = {
    stage,
    pid: process.pid,
    updatedAt: new Date().toISOString(),
    ...details,
  };
  fs.writeFileSync(statusFile + ".partial", JSON.stringify(record, null, 2));
  fs.renameSync(statusFile + ".partial", statusFile);
  console.log(JSON.stringify(record));
}
async function command(binary, args) {
  const result = await exec(binary, args, {
    timeout: 90000,
    maxBuffer: 1024 * 1024,
  });
  if (result.stdout.trim()) console.log(result.stdout.trim());
  return result.stdout;
}
fs.mkdirSync("artifacts", { recursive: true });
fs.writeFileSync(lock, String(process.pid), { flag: "wx" });
try {
  let last = "";
  while (true) {
    const state = read(root + "/run-state.json");
    const counts = Object.fromEntries(
      runtimes.map((r) => [
        r,
        read(root + `/storage/${r}.json`)?.results?.length ?? 0,
      ]),
    );
    const summary = JSON.stringify({ counts, storage: state?.storage });
    if (summary !== last) {
      status("watching", { counts, storage: state?.storage });
      last = summary;
    }
    const failed = runtimes.filter(
      (r) => state?.storage?.[r]?.status === "failed",
    );
    if (failed.length)
      throw Error(
        `Storage batch failed: ${failed.join(", ")}; publication not updated`,
      );
    if (
      runtimes.every(
        (r) => state?.storage?.[r]?.status === "complete" && counts[r] === 124,
      )
    ) {
      const html = fs.readFileSync(root + "/report.html", "utf8");
      const match = html.match(
        /<script id="data" type="application\/json">([\s\S]*?)<\/script>/,
      );
      if (match && JSON.parse(match[1]).storage.length === 372) break;
    }
    await sleep(30000);
  }
  status("exporting", { storageGroups: 372 });
  await command(process.execPath, ["tools/export-pages.mjs", root, site]);
  const data = read(site + "/report-data.json");
  if (data?.storage.length !== 372)
    throw Error("Export is missing completed storage results");
  if (
    data.storage.some(
      (r) => r.runs.length !== 5 || r.runs.some((v) => !v.verified),
    )
  )
    throw Error("Unverified storage evidence");
  await command("git", ["-C", site, "add", "."]);
  const staged = await command("git", [
    "-C",
    site,
    "diff",
    "--cached",
    "--name-only",
  ]);
  if (staged.trim())
    await command("git", [
      "-C",
      site,
      "commit",
      "-m",
      "Publish completed native storage matrix: 372 groups",
    ]);
  let pushed = false;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await command("git", ["-C", site, "push", "origin", "gh-pages"]);
      pushed = true;
      break;
    } catch (error) {
      status("push-retry", { attempt, error: error.message });
      await sleep(15000);
    }
  }
  if (!pushed) throw Error("GitHub push failed after three attempts");
  status("deploying", { storageGroups: 372, url });
  const expected = read(site + "/publication.json");
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const { stdout } = await exec(
        "curl",
        [
          "--fail",
          "--silent",
          "--show-error",
          "--max-time",
          "20",
          `${url}publication.json?storage=${Date.now()}`,
        ],
        { timeout: 25000 },
      );
      const online = JSON.parse(stdout);
      if (
        online.storage === 372 &&
        online.publishedSnapshotAt === expected.publishedSnapshotAt
      ) {
        status("published", { storageGroups: 372, url, publication: online });
        process.exitCode = 0;
        break;
      }
    } catch {
      /* Deployment or CDN may still be updating. */
    }
    if (attempt === 29)
      throw Error(
        "Pushed successfully, but online deployment was not confirmed within ten minutes",
      );
    await sleep(20000);
  }
} catch (error) {
  status("failed", { error: error.message });
  process.exitCode = 1;
} finally {
  fs.unlinkSync(lock);
}
