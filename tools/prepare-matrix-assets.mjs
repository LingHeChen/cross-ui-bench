import { spawn } from "node:child_process";
import { readFile, writeFile, stat } from "node:fs/promises";
const specs = new Map();
const add = (triangles, bones, textureSize = 1024) => {
  const id = `scale-t${triangles}-b${bones}-x${textureSize}`;
  specs.set(id, { triangles, bones, textureSize });
  return id;
};
for (const b of [50, 100, 250, 500, 1000]) add(1000000, b, 4096);
for (const t of [100000, 500000, 1000000, 5000000, 10000000]) add(t, 100, 4096);
for (const x of [1024, 2048, 4096, 8192]) add(1000000, 100, x);
add(100000, 100, 4096);
for (const [id, spec] of specs) {
  try {
    const previous = JSON.parse(
      await readFile(`artifacts/stress/${id}.manifest.json`, "utf8"),
    );
    if (previous.generator_version !== "0.2.0")
      throw Error("Outdated generator");
    console.log(`EXISTS ${id}`);
    continue;
  } catch {}
  console.log(`GENERATE ${id}`);
  await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--max-old-space-size=8192",
        "tools/asset-generator/generate.mjs",
        `--id=${id}`,
        "--output=artifacts/stress",
        ...Object.entries(spec).map(([k, v]) => `--${k}=${v}`),
      ],
      { stdio: "inherit" },
    );
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(Error(`Failed ${id}: ${code}`)),
    );
  });
}
await writeFile(
  "artifacts/scaling-index.json",
  JSON.stringify(
    [...specs].map(([id, parameters]) => ({
      asset: "stress/" + id,
      parameters,
    })),
    null,
    2,
  ),
);
