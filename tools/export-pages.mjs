import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const source = path.resolve(process.argv[2] ?? "results/full-benchmark");
const destination = path.resolve(process.argv[3] ?? "artifacts/pages");
if (source === destination) throw Error("Export must use a separate directory");
const html = fs.readFileSync(path.join(source, "report.html"), "utf8");
const embedded =
  /(<script id="data" type="application\/json">)([\s\S]*?)(<\/script>)/;
const match = html.match(embedded);
if (!match) throw Error("Report has no embedded data snapshot");
const data = JSON.parse(match[2]);
const allowed = path.resolve(source, "..");
const redact = (text) =>
  text.replace(/\/Users\/[^/"\s]+\//g, "/Users/[redacted]/");
const written = new Set();
function copy(relative, target = relative) {
  const file = path.resolve(source, relative);
  const output = path.resolve(destination, target);
  if (!file.startsWith(allowed + path.sep))
    throw Error("Evidence outside results directory");
  if (!output.startsWith(destination + path.sep))
    throw Error("Invalid export path");
  if (!/\.(json|png)$/.test(file)) throw Error("Unsupported evidence type");
  if (written.has(target)) return;
  fs.mkdirSync(path.dirname(output), { recursive: true });
  if (file.endsWith(".json")) {
    const json = JSON.parse(fs.readFileSync(file, "utf8"));
    fs.writeFileSync(output, redact(JSON.stringify(json)));
  } else fs.copyFileSync(file, output);
  written.add(target);
}
for (const result of data.results) {
  const target =
    result.phase === "prior-2.1GB"
      ? "prior-2.1GB/raw/" + path.basename(result.raw)
      : result.raw;
  copy(result.raw, target);
  result.raw = target;
}
for (const result of data.storage) copy(result.raw);
for (const result of data.pixel)
  for (const key of ["referenceImage", "comparisonImage", "diffImage"])
    copy(result[key]);
if (data.pixel.length) copy("pixel/results.json");
fs.mkdirSync(destination, { recursive: true });
const serialized = redact(JSON.stringify(data)).replaceAll("<", "\\u003c");
const output = html.replace(
  embedded,
  (_, open, body, close) => `${open}\n${serialized}\n${close}`,
);
fs.writeFileSync(path.join(destination, "index.html"), output);
fs.writeFileSync(
  path.join(destination, "report-data.json"),
  redact(JSON.stringify(data, null, 2)),
);
fs.writeFileSync(path.join(destination, ".nojekyll"), "");
fs.writeFileSync(
  path.join(destination, "publication.json"),
  JSON.stringify(
    {
      publishedSnapshotAt: new Date().toISOString(),
      reportUpdatedAt: data.updated,
      sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim(),
      results: data.results.length,
      storage: data.storage.length,
      pixel: data.pixel.length,
      status:
        "Snapshot; ongoing local measurements are not automatically uploaded",
      privacy: "Local macOS home directory names redacted in JSON evidence",
    },
    null,
    2,
  ),
);
console.log(`PAGES_EXPORT ${destination}; ${written.size} evidence files`);
