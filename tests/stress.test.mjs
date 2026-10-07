import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, open } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import validator from "gltf-validator";
import { writeStress } from "../tools/asset-generator/stress.mjs";
import { verifyStress } from "../tools/asset-generator/verify-stress.mjs";
import { createAssetServer } from "../tools/asset-generator/serve-stress.mjs";
test("three stress profiles are fully valid, deterministic and served with correct ranges", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "crossui-stress-"));
  let first;
  for (const profile of ["geometry-heavy", "mixed", "texture-heavy"]) {
    const m = await writeStress(
      { profile, targetBytes: 10000000, bones: 16, textureSize: 256 },
      dir,
    );
    assert.ok(m.size_bytes >= 10000000 && m.size_bytes < 10001024);
    const file = path.join(dir, m.id + ".glb");
    const result = await verifyStress(file);
    assert.equal(result.valid, true);
    const official = await validator.validateBytes(
      new Uint8Array(await readFile(file)),
      {},
    );
    assert.equal(official.issues.numErrors, 0);
    assert.equal(official.issues.numWarnings, 0);
    if (!first) first = m;
  }
  const secondDir = await mkdtemp(path.join(os.tmpdir(), "crossui-repeat-"));
  const repeat = await writeStress(first.generation_parameters, secondDir);
  assert.equal(repeat.sha256, first.sha256);
  const server = await createAssetServer(dir, 0);
  try {
    const base = "http://127.0.0.1:" + server.address().port;
    assert.equal((await (await fetch(base + "/index.json")).json()).length, 3);
    const url = base + "/" + first.id + ".glb";
    const head = await fetch(url, { method: "HEAD" });
    assert.equal(Number(head.headers.get("content-length")), first.size_bytes);
    const range = await fetch(url, { headers: { Range: "bytes=0-19" } });
    assert.equal(range.status, 206);
    assert.equal((await range.arrayBuffer()).byteLength, 20);
    assert.equal(
      (await fetch(url, { headers: { Range: "bytes=999999999-" } })).status,
      416,
    );
    assert.equal((await fetch(base + "/package.json")).status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  const file = await open(path.join(dir, first.id + ".glb"), "r+");
  try {
    const h = Buffer.alloc(20);
    await file.read(h, 0, 20, 0);
    const start = 20 + h.readUInt32LE(12) + 8;
    await file.write(Buffer.from([255, 255, 255, 127]), 0, 4, start + 16 * 64);
  } finally {
    await file.close();
  }
  await assert.rejects(() => verifyStress(path.join(dir, first.id + ".glb")));
});
