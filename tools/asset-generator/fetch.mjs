import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { execFileSync } from "node:child_process";
const root = path.resolve(new URL("../..", import.meta.url).pathname);
const commit = JSON.parse(
  execFileSync(
    "curl",
    [
      "-fsSL",
      "--connect-timeout",
      "15",
      "--max-time",
      "60",
      "https://api.github.com/repos/KhronosGroup/glTF-Sample-Assets/commits/main",
    ],
    { encoding: "utf8" },
  ),
).sha;
const models = ["RiggedSimple", "RiggedFigure"];
const manifest = [];
for (const name of models) {
  const base = `https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/${commit}/Models/${name}`;
  const get = async (url) =>
    execFileSync(
      "curl",
      [
        "-fsSL",
        "--retry",
        "2",
        "--connect-timeout",
        "15",
        "--max-time",
        "90",
        url,
      ],
      { maxBuffer: 100 * 1024 * 1024 },
    );
  const readme = await get(`${base}/README.md`);
  const glb = await get(`${base}/glTF-Binary/${name}.glb`);
  await mkdir(path.join(root, "assets/3d"), { recursive: true });
  await mkdir(path.join(root, "assets/licenses"), { recursive: true });
  await writeFile(path.join(root, `assets/licenses/${name}.md`), readme);
  await writeFile(path.join(root, `assets/3d/${name}.glb`), glb);
  const jsonLength = glb.readUInt32LE(12);
  const model = JSON.parse(glb.subarray(20, 20 + jsonLength).toString());
  const primitives = model.meshes?.flatMap((m) => m.primitives) ?? [];
  manifest.push({
    id: name,
    name,
    source: `https://github.com/KhronosGroup/glTF-Sample-Assets/tree/${commit}/Models/${name}`,
    license: readme.toString().includes("Creative Commons Attribution")
      ? "CC-BY-4.0"
      : "See upstream license",
    license_url: `${base}/README.md`,
    redistributable: true,
    format: "GLB",
    size_bytes: glb.length,
    sha256: createHash("sha256").update(glb).digest("hex"),
    triangles: primitives.reduce(
      (s, p) =>
        s +
        model.accessors[p.indices ?? p.attributes.POSITION].count /
          (p.indices !== undefined ? 3 : 3),
      0,
    ),
    vertices: primitives.reduce(
      (s, p) => s + model.accessors[p.attributes.POSITION].count,
      0,
    ),
    bones: model.skins?.reduce((s, skin) => s + skin.joints.length, 0) ?? 0,
    effective_skinning_bones: null,
    animations:
      model.animations?.map((a, i) => a.name ?? `animation-${i}`) ?? [],
    morph_targets: primitives.reduce(
      (n, p) => Math.max(n, p.targets?.length ?? 0),
      0,
    ),
    texture_resolution: null,
    notes:
      "Correctness baseline. Individual license preserved in assets/licenses. Effective bone count not yet extracted.",
  });
  console.log(`Fetched ${name} (${glb.length} bytes)`);
}
await writeFile(
  path.join(root, "assets/manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
