import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import validator from "gltf-validator";
import { generateCharacter } from "../tools/asset-generator/generate.mjs";
import { storageBlock, runStorage } from "../benchmarks/storage/node.mjs";
test("scaling GLBs have exact bounds and official validation succeeds", async () => {
  for (const bones of [50, 100, 250, 500, 1000]) {
    const { buffer, metadata } = generateCharacter({
      triangles: 10000,
      bones,
      textureSize: 64,
    });
    assert.equal(metadata.effective_skinning_bones, bones);
    const r = await validator.validateBytes(new Uint8Array(buffer));
    assert.equal(r.issues.numErrors, 0, JSON.stringify(r.issues.messages));
    assert.equal(r.issues.numWarnings, 0);
  }
});
test("native filesystem and SQLite workloads verify their results", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "crossui-storage-")),
    output = path.join(root, "results.json");
  const jobs = [
    "sequential-write",
    "sequential-read",
    "random-read",
    "random-write",
  ]
    .map((operation) => ({ operation, bytes: 65536, entropy: "random" }))
    .concat(
      ["file-create", "file-delete", "directory-scan"].map((operation) => ({
        operation,
        count: 10,
        fileBytes: 4096,
        entropy: "compressible",
      })),
      [
        "sqlite-insert",
        "sqlite-batch-insert",
        "sqlite-indexed-query",
        "sqlite-random-update",
        "sqlite-transaction",
        "sqlite-vacuum",
      ].map((operation) => ({ operation, rows: 100 })),
    );
  const results = await runStorage(
    { temporaryRoot: root, output, jobs },
    "node-test",
  );
  assert.equal(results.length, 13);
  for (const r of results) {
    assert.equal(r.runs.length, 5);
    assert.ok(r.runs.every((v) => v.verified && v.elapsedMs > 0));
  }
  assert.equal(JSON.parse(await readFile(output)).results.length, 13);
  assert.equal(
    storageBlock("compressible", 4096).every((v) => v === 65),
    true,
  );
});
