import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const assets = [];
for (const [id, pkg, file] of [
  ["ibm-plex-sans", "ibm-plex-sans", "ibm-plex-sans-latin-400-normal.woff2"],
  ["ibm-plex-mono", "ibm-plex-mono", "ibm-plex-mono-latin-400-normal.woff2"],
]) {
  const bytes = await readFile(`node_modules/@fontsource/${pkg}/files/${file}`);
  const version = JSON.parse(
    await readFile(`node_modules/@fontsource/${pkg}/package.json`),
  ).version;
  assets.push({
    id,
    name: id,
    source: `https://github.com/IBM/plex (via @fontsource/${pkg}@${version})`,
    license: "OFL-1.1",
    license_url: "https://github.com/IBM/plex/blob/master/LICENSE.txt",
    redistributable: true,
    format: "WOFF2",
    size_bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    triangles: null,
    vertices: null,
    bones: null,
    effective_skinning_bones: null,
    animations: [],
    morph_targets: null,
    texture_resolution: null,
    notes:
      "Locally bundled Latin UI font. Sans regular/medium/semibold are pinned by package-lock.json.",
  });
}
const icon = await readFile("assets/ui/icon.svg");
assets.push({
  id: "crossui-icon",
  name: "CrossUI icon",
  source: "assets/ui/icon.svg",
  license: "MIT",
  license_url: "LICENSE",
  redistributable: true,
  format: "SVG",
  size_bytes: icon.length,
  sha256: createHash("sha256").update(icon).digest("hex"),
});
await writeFile(
  "assets/ui-manifest.json",
  JSON.stringify(assets, null, 2) + "\n",
);
