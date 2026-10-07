import { open, readFile, writeFile, stat, readdir } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import path from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { crc32 } from "./stress.mjs";
const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 },
  sizes = { 5123: 2, 5126: 4 };
async function readExactly(file, length, position) {
  const buffer = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const r = await file.read(
      buffer,
      offset,
      length - offset,
      position + offset,
    );
    if (!r.bytesRead) throw new Error("Unexpected EOF");
    offset += r.bytesRead;
  }
  return buffer;
}
export function verifyPng(bytes) {
  assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  let p = 8,
    width,
    height,
    idat = [],
    seenEnd = false;
  while (p < bytes.length) {
    const length = bytes.readUInt32BE(p),
      type = bytes.toString("ascii", p + 4, p + 8),
      end = p + 12 + length;
    assert.ok(end <= bytes.length, "PNG chunk within bounds");
    assert.equal(
      crc32(bytes.subarray(p + 4, end - 4)),
      bytes.readUInt32BE(end - 4),
      "PNG CRC",
    );
    const data = bytes.subarray(p + 8, end - 4);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.equal(data[8], 8);
      assert.equal(data[9], 6);
      assert.equal(data[12], 0);
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") seenEnd = true;
    else throw new Error(`Unexpected PNG chunk ${type}`);
    p = end;
  }
  assert.ok(seenEnd && width && height);
  const raw = inflateSync(Buffer.concat(idat));
  assert.equal(raw.length, height * (width * 4 + 1));
  for (let y = 0; y < height; y++)
    assert.equal(raw[y * (width * 4 + 1)], 0, "PNG filter");
  return { width, height, rawBytes: width * height * 4 };
}
export async function verifyStress(
  filename,
  { onProgress = () => {}, manifest = true } = {},
) {
  const started = performance.now(),
    size = (await stat(filename)).size,
    file = await open(filename, "r");
  let peakRss = process.memoryUsage().rss;
  try {
    const header = await readExactly(file, 20, 0);
    assert.equal(header.readUInt32LE(0), 0x46546c67);
    assert.equal(header.readUInt32LE(4), 2);
    assert.equal(header.readUInt32LE(8), size);
    assert.equal(header.readUInt32LE(16), 0x4e4f534a);
    const jsonLength = header.readUInt32LE(12);
    assert.equal(jsonLength % 4, 0);
    assert.ok(jsonLength < 16 * 1024 * 1024, "Bounded JSON");
    const gltf = JSON.parse(
      (await readExactly(file, jsonLength, 20)).toString(),
    );
    const binHeader = await readExactly(file, 8, 20 + jsonLength),
      binOffset = 28 + jsonLength,
      binLength = binHeader.readUInt32LE(0);
    assert.equal(binHeader.readUInt32LE(4), 0x004e4942);
    assert.equal(binLength % 4, 0);
    assert.equal(binOffset + binLength, size);
    assert.equal(gltf.buffers.length, 1);
    assert.equal(gltf.buffers[0].byteLength, binLength);
    let end = 0;
    for (const view of gltf.bufferViews) {
      assert.equal(view.buffer, 0);
      assert.equal(view.byteOffset % 4, 0);
      assert.ok(
        view.byteOffset >= end && view.byteOffset - end <= 3,
        "Only required alignment between blocks",
      );
      assert.ok(view.byteLength > 0);
      end = view.byteOffset + view.byteLength;
      assert.ok(end <= binLength);
    }
    assert.ok(binLength - end <= 3, "No trailing size padding");
    const usedViews = new Set(),
      usedAccessors = new Set(),
      usedMaterials = new Set(),
      usedImages = new Set(),
      effectiveBones = new Set(),
      meshNodes = new Map(),
      reachable = new Set();
    const walk = (node) => {
      assert.ok(!reachable.has(node), "No repeated/cyclic scene nodes");
      reachable.add(node);
      for (const child of gltf.nodes[node].children ?? []) walk(child);
    };
    for (const node of gltf.scenes[gltf.scene].nodes) walk(node);
    assert.equal(
      reachable.size,
      gltf.nodes.length,
      "Every node is in the scene",
    );
    for (const [index, node] of gltf.nodes.entries())
      if (node.mesh !== undefined) {
        assert.ok(reachable.has(index));
        meshNodes.set(node.mesh, index);
        assert.equal(node.skin, 0);
      }
    const mark = (id) => {
      const a = gltf.accessors[id];
      assert.ok(a);
      usedAccessors.add(id);
      usedViews.add(a.bufferView);
      const v = gltf.bufferViews[a.bufferView],
        element = sizes[a.componentType] * components[a.type],
        stride = v.byteStride ?? element;
      assert.ok(
        (a.byteOffset ?? 0) + (a.count - 1) * stride + element <= v.byteLength,
        "Accessor within view",
      );
      return a;
    };
    let triangles = 0,
      morphBytes = 0,
      geometryBytes = 0,
      geometryViews = new Set();
    let lastNotify = 0;
    for (const [m, mesh] of gltf.meshes.entries()) {
      assert.ok(meshNodes.has(m), "Mesh is instantiated");
      assert.equal(mesh.primitives.length, 1);
      const p = mesh.primitives[0],
        position = mark(p.attributes.POSITION),
        normal = mark(p.attributes.NORMAL),
        uv = mark(p.attributes.TEXCOORD_0),
        joints = mark(p.attributes.JOINTS_0),
        weights = mark(p.attributes.WEIGHTS_0),
        tangent = mark(p.attributes.TANGENT),
        view = gltf.bufferViews[position.bufferView];
      assert.equal(position.count % 3, 0);
      triangles += position.count / 3;
      assert.equal(view.byteStride, 72);
      assert.equal(position.componentType, 5126);
      assert.equal(position.byteOffset, 0);
      assert.equal(normal.byteOffset, 12);
      assert.equal(uv.byteOffset, 24);
      assert.equal(joints.byteOffset, 32);
      assert.equal(joints.componentType, 5123);
      assert.equal(weights.byteOffset, 40);
      for (const a of [normal, uv, joints, weights, tangent]) {
        assert.equal(a.bufferView, position.bufferView);
        assert.equal(a.count, position.count);
      }
      assert.equal(tangent.byteOffset, 56);
      geometryViews.add(position.bufferView);
      usedMaterials.add(p.material);
      const bytes = await readExactly(
          file,
          view.byteLength,
          binOffset + view.byteOffset,
        ),
        f = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4),
        u = new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.length / 2),
        mins = [Infinity, Infinity, Infinity],
        maxs = [-Infinity, -Infinity, -Infinity];
      for (let v = 0; v < position.count; v++) {
        const i = v * 18,
          j = i * 2;
        for (let k = 0; k < 3; k++) {
          const n = f[i + k];
          if (!Number.isFinite(n)) throw new Error("Non-finite position");
          mins[k] = Math.min(mins[k], n);
          maxs[k] = Math.max(maxs[k], n);
        }
        const length = f[i + 3] ** 2 + f[i + 4] ** 2 + f[i + 5] ** 2;
        const tangentLength = f[i + 14] ** 2 + f[i + 15] ** 2 + f[i + 16] ** 2;
        if (
          Math.abs(tangentLength - 1) > 1e-5 ||
          Math.abs(
            f[i + 14] * f[i + 3] + f[i + 15] * f[i + 4] + f[i + 16] * f[i + 5],
          ) > 1e-5 ||
          f[i + 17] !== -1
        )
          throw new Error("Invalid tangent");
        if (Math.abs(length - 1) > 1e-5)
          throw new Error("Normal not unit length");
        if (!Number.isFinite(f[i + 6]) || !Number.isFinite(f[i + 7]))
          throw new Error("Invalid UV");
        let sum = 0;
        for (let k = 0; k < 4; k++) {
          const joint = u[j + 16 + k],
            weight = f[i + 10 + k];
          if (
            joint >= gltf.skins[0].joints.length ||
            !Number.isFinite(weight) ||
            weight < 0 ||
            weight > 1
          )
            throw new Error("Invalid joint/weight");
          sum += weight;
          if (weight > 0) effectiveBones.add(joint);
        }
        if (Math.abs(sum - 1) > 1e-6)
          throw new Error("Weights do not sum to one");
      }
      assert.deepEqual(mins, position.min);
      assert.deepEqual(maxs, position.max);
      for (const target of p.targets ?? []) {
        const a = mark(target.POSITION);
        assert.equal(a.count, position.count);
        const bv = gltf.bufferViews[a.bufferView];
        morphBytes += bv.byteLength;
        const data = await readExactly(
            file,
            bv.byteLength,
            binOffset + bv.byteOffset,
          ),
          values = new Float32Array(
            data.buffer,
            data.byteOffset,
            data.length / 4,
          );
        const lo = [Infinity, Infinity, Infinity],
          hi = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < values.length; i++) {
          const x = values[i];
          if (!Number.isFinite(x)) throw new Error("Invalid morph delta");
          const k = i % 3;
          lo[k] = Math.min(lo[k], x);
          hi[k] = Math.max(hi[k], x);
        }
        assert.deepEqual(lo, a.min);
        assert.deepEqual(hi, a.max);
      }
      peakRss = Math.max(peakRss, process.memoryUsage().rss);
      if (performance.now() - lastNotify > 2000) {
        onProgress({
          phase: "geometry/morph",
          completed: m + 1,
          total: gltf.meshes.length,
        });
        lastNotify = performance.now();
      }
    }
    for (const view of geometryViews)
      geometryBytes += gltf.bufferViews[view].byteLength;
    assert.equal(
      usedMaterials.size,
      gltf.materials.length,
      "No unused material payload",
    );
    for (const id of usedMaterials) {
      const m = gltf.materials[id];
      for (const t of [
        m.pbrMetallicRoughness.baseColorTexture,
        m.pbrMetallicRoughness.metallicRoughnessTexture,
        m.normalTexture,
        m.occlusionTexture,
        m.emissiveTexture,
      ]) {
        assert.ok(t);
        usedImages.add(gltf.textures[t.index].source);
      }
    }
    assert.equal(
      usedImages.size,
      gltf.images.length,
      "Every texture is used by scene materials",
    );
    let textureBytes = 0,
      rawTextureBytes = 0;
    for (const image of gltf.images) {
      const view = gltf.bufferViews[image.bufferView];
      usedViews.add(image.bufferView);
      const png = verifyPng(
        await readExactly(file, view.byteLength, binOffset + view.byteOffset),
      );
      textureBytes += view.byteLength;
      rawTextureBytes += png.rawBytes;
      peakRss = Math.max(peakRss, process.memoryUsage().rss);
      onProgress({
        phase: "png",
        completed: usedViews.size,
        total: gltf.bufferViews.length,
      });
    }
    const skin = gltf.skins[0];
    mark(skin.inverseBindMatrices);
    const ibm = gltf.accessors[skin.inverseBindMatrices],
      ibmView = gltf.bufferViews[ibm.bufferView],
      matrices = new Float32Array(
        (
          await readExactly(
            file,
            ibmView.byteLength,
            binOffset + ibmView.byteOffset,
          )
        ).buffer,
      );
    assert.equal(ibm.count, skin.joints.length);
    for (let j = 0; j < skin.joints.length; j++) {
      assert.ok(reachable.has(skin.joints[j]));
      if (j < skin.joints.length - 1)
        assert.ok(
          gltf.nodes[skin.joints[j]].children.includes(skin.joints[j + 1]),
        );
      assert.ok(
        Math.abs(matrices[j * 16 + 13] + (j * 2) / (skin.joints.length - 1)) <
          1e-6,
      );
      assert.equal(matrices[j * 16], 1);
      assert.equal(matrices[j * 16 + 15], 1);
    }
    const animatedBones = new Set(),
      animatedMorphNodes = new Set(),
      checkedInputs = new Set();
    let animationBytes = 0,
      animationViews = new Set();
    for (const animation of gltf.animations)
      for (const channel of animation.channels) {
        assert.ok(reachable.has(channel.target.node));
        const sampler = animation.samplers[channel.sampler],
          input = mark(sampler.input),
          output = mark(sampler.output);
        for (const a of [input, output]) animationViews.add(a.bufferView);
        if (!checkedInputs.has(sampler.input)) {
          checkedInputs.add(sampler.input);
          const v = gltf.bufferViews[input.bufferView],
            b = await readExactly(file, v.byteLength, binOffset + v.byteOffset),
            times = new Float32Array(b.buffer, b.byteOffset, b.length / 4);
          assert.equal(times[0], 0);
          assert.equal(times.at(-1), 2);
          for (let i = 1; i < times.length; i++)
            if (!(times[i] > times[i - 1]))
              throw new Error("Animation times not increasing");
        }
        const view = gltf.bufferViews[output.bufferView],
          b = await readExactly(
            file,
            view.byteLength,
            binOffset + view.byteOffset,
          ),
          values = new Float32Array(b.buffer, b.byteOffset, b.length / 4);
        if (channel.target.path === "rotation") {
          assert.equal(output.count, input.count);
          animatedBones.add(channel.target.node);
          let moving = false;
          for (let i = 0; i < values.length; i += 4) {
            const length =
              values[i] ** 2 +
              values[i + 1] ** 2 +
              values[i + 2] ** 2 +
              values[i + 3] ** 2;
            if (!Number.isFinite(length) || Math.abs(length - 1) > 1e-5)
              throw new Error("Invalid animation quaternion");
            moving ||= Math.abs(values[i + 2]) > 1e-6;
          }
          assert.ok(moving, "Real joint animation");
        } else {
          assert.equal(channel.target.path, "weights");
          animatedMorphNodes.add(channel.target.node);
          const count =
            gltf.meshes[gltf.nodes[channel.target.node].mesh].weights.length;
          assert.equal(output.count, input.count * count);
          assert.ok(values.some((v) => v > 0));
          for (const value of values) assert.ok(Number.isFinite(value));
        }
      }
    for (const joint of skin.joints)
      assert.ok(animatedBones.has(joint), "Every hierarchy joint animated");
    for (const [mesh, node] of meshNodes)
      if (gltf.meshes[mesh].weights)
        assert.ok(animatedMorphNodes.has(node), "Every morph mesh animated");
    for (const view of animationViews)
      animationBytes += gltf.bufferViews[view].byteLength;
    assert.equal(
      usedAccessors.size,
      gltf.accessors.length,
      "Every accessor used",
    );
    assert.equal(
      usedViews.size,
      gltf.bufferViews.length,
      "Every binary resource referenced",
    );
    const hash = createHash("sha256");
    for await (const bytes of createReadStream(filename, {
      highWaterMark: 4 * 1024 * 1024,
    }))
      hash.update(bytes);
    const sha256 = hash.digest("hex");
    if (manifest) {
      const m = JSON.parse(
        await readFile(filename.replace(/\.glb$/, ".manifest.json"), "utf8"),
      );
      assert.equal(m.size_bytes, size);
      assert.equal(m.sha256, sha256);
      assert.equal(m.triangles, triangles);
      assert.equal(m.effective_skinning_bones, effectiveBones.size);
      assert.equal(m.raw_texture_size, rawTextureBytes);
      assert.equal(m.composition_bytes.geometry, geometryBytes);
      assert.equal(m.composition_bytes.textures, textureBytes);
      assert.equal(m.composition_bytes.morph, morphBytes);
      assert.equal(m.composition_bytes.animations, animationBytes);
      assert.equal(
        Object.values(m.composition_bytes).reduce((s, n) => s + n, 0),
        size,
      );
    }
    return {
      valid: true,
      size_bytes: size,
      sha256,
      triangles,
      effective_skinning_bones: effectiveBones.size,
      bones: skin.joints.length,
      images: gltf.images.length,
      mesh_count: gltf.meshes.length,
      all_resources_referenced: true,
      full_vertex_and_png_validation: true,
      verification_elapsed_ms: performance.now() - started,
      peak_rss_bytes: peakRss,
      notes: [
        "Streamed structural/resource validator; official Khronos JavaScript validator is separately run on reduced-size profiles.",
        "All vertex positions, normals, weights, morph deltas, animation values, PNG CRC/DEFLATE pixels and SHA-256 checked.",
      ],
    };
  } finally {
    await file.close();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const input = process.argv[2] ?? "artifacts/stress",
    files = (await stat(input)).isDirectory()
      ? (await readdir(input))
          .filter((f) => f.endsWith(".glb"))
          .map((f) => path.join(input, f))
      : [input];
  for (const file of files) {
    console.log(`Verifying ${file}`);
    const result = await verifyStress(file, {
      onProgress: (p) => {
        if (p.phase !== "png")
          console.log(`${p.phase}: ${p.completed}/${p.total}`);
      },
    });
    await writeFile(
      file.replace(/\.glb$/, ".validation.json"),
      JSON.stringify(result, null, 2) + "\n",
    );
    console.log(`VALID ${file} ${result.sha256}`);
  }
}
