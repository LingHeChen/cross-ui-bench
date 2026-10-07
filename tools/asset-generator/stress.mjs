import {
  open,
  mkdir,
  stat,
  rename,
  unlink,
  writeFile,
  readFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
export const STRESS_GENERATOR_VERSION = "0.2.0";
export const PROFILES = Object.freeze({
  "geometry-heavy": { textureRatio: 0.05, morphRatio: 0.06 },
  "texture-heavy": { textureRatio: 0.85, morphRatio: 0.06 },
  mixed: { textureRatio: 0.4, morphRatio: 0.11 },
});
const align4 = (n) => Math.ceil(n / 4) * 4;
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  return c >>> 0;
});
export function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = (c >>> 8) ^ crcTable[(c ^ b) & 255];
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, bytes) {
  const out = Buffer.alloc(bytes.length + 12);
  out.writeUInt32BE(bytes.length, 0);
  out.write(type, 4, 4, "ascii");
  bytes.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, -4)), out.length - 4);
  return out;
}
export function pngSize(side) {
  const raw = side * (side * 4 + 1);
  return raw + Math.ceil(raw / 65535) * 5 + 63;
}
export function makeTexture(side, seed, role) {
  const raw = Buffer.alloc(side * (side * 4 + 1));
  let state = seed >>> 0 || 1;
  for (let y = 0; y < side; y++)
    for (let x = 0; x < side; x++) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      state >>>= 0;
      const i = y * (side * 4 + 1) + 1 + x * 4,
        r = state & 255,
        g = (state >>> 8) & 255,
        b = (state >>> 16) & 255;
      if (role === "normal") {
        raw[i] = 96 + (r & 63);
        raw[i + 1] = 96 + (g & 63);
        raw[i + 2] = 245;
      } else if (role === "occlusion") {
        raw[i] = raw[i + 1] = raw[i + 2] = 128 + (r & 127);
      } else if (role === "metallicRoughness") {
        raw[i] = 255;
        raw[i + 1] = 64 + (g & 191);
        raw[i + 2] = b;
      } else {
        raw[i] = r;
        raw[i + 1] = g;
        raw[i + 2] = b;
      }
      raw[i + 3] = 255;
    }
  // PNG/DEFLATE stored blocks: bytes are real pixels, not padding; codec is explicitly recorded.
  const compressed = Buffer.alloc(
    raw.length + Math.ceil(raw.length / 65535) * 5 + 6,
  );
  compressed[0] = 0x78;
  compressed[1] = 0x01;
  let src = 0,
    dst = 2,
    a = 1,
    b = 0;
  while (src < raw.length) {
    const size = Math.min(65535, raw.length - src);
    compressed[dst] = src + size === raw.length ? 1 : 0;
    compressed.writeUInt16LE(size, dst + 1);
    compressed.writeUInt16LE(~size & 65535, dst + 3);
    raw.copy(compressed, dst + 5, src, src + size);
    for (let end = src + size; src < end; src++) {
      a += raw[src];
      b += a;
      if ((src & 4095) === 4095) {
        a %= 65521;
        b %= 65521;
      }
    }
    a %= 65521;
    b %= 65521;
    dst += size + 5;
  }
  compressed.writeUInt32BE(((b << 16) | a) >>> 0, dst);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(side, 0);
  ihdr.writeUInt32BE(side, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}
const roles = [
  "baseColor",
  "normal",
  "metallicRoughness",
  "occlusion",
  "emissive",
];
function split(total, limit) {
  const count = Math.ceil(total / limit),
    base = Math.floor(total / count),
    extra = total % count;
  return Array.from({ length: count }, (_, i) => base + (i < extra ? 1 : 0));
}
function grid(triangles) {
  const cols = Math.max(4, Math.min(128, Math.floor(triangles / 2))),
    rows = Math.ceil(triangles / (cols * 2));
  return { cols, rows };
}
function coordinates(t, v, cols, rows) {
  const cell = Math.floor(t / 2),
    col = cell % cols,
    row = Math.floor(cell / cols),
    second = t % 2;
  const dx = second ? (v === 2 ? 0 : 1) : v === 1 ? 1 : 0,
    dy = second ? (v === 0 ? 0 : 1) : v === 2 ? 1 : 0;
  return [(col + dx) / cols, (row + dy) / rows];
}
function geometryBounds(triangles, tileX, tileZ) {
  const { cols } = grid(triangles);
  let minX = Infinity,
    maxX = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  for (let c = 0; c <= cols; c++) {
    const a = (c / cols) * Math.PI * 2,
      x = Math.fround(tileX + Math.cos(a) * 0.25),
      z = Math.fround(tileZ + Math.sin(a) * 0.25);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  return { min: [minX, 0, minZ], max: [maxX, 2, maxZ] };
}
export function makeGeometry(triangles, bones, tileX = 0, tileZ = 0) {
  const out = Buffer.alloc(triangles * 3 * 72),
    floats = new Float32Array(out.buffer, out.byteOffset, out.length / 4),
    shorts = new Uint16Array(out.buffer, out.byteOffset, out.length / 2),
    { cols, rows } = grid(triangles);
  const sin = Float64Array.from({ length: cols + 1 }, (_, c) =>
      Math.sin((c / cols) * Math.PI * 2),
    ),
    cos = Float64Array.from({ length: cols + 1 }, (_, c) =>
      Math.cos((c / cols) * Math.PI * 2),
    );
  for (let t = 0; t < triangles; t++)
    for (let v = 0; v < 3; v++) {
      const [u, yRatio] = coordinates(t, v, cols, rows),
        c = Math.round(u * cols),
        i = (t * 3 + v) * 18,
        j = i * 2,
        scaled = yRatio * (bones - 1),
        bone = Math.min(bones - 1, Math.floor(scaled)),
        weight = scaled - bone;
      floats[i] = tileX + cos[c] * 0.25;
      floats[i + 1] = yRatio * 2;
      floats[i + 2] = tileZ + sin[c] * 0.25;
      floats[i + 3] = cos[c];
      floats[i + 4] = 0;
      floats[i + 5] = sin[c];
      floats[i + 6] = u;
      floats[i + 7] = yRatio;
      shorts[j + 16] = bone;
      shorts[j + 17] = weight > 0 ? Math.min(bones - 1, bone + 1) : 0;
      floats[i + 10] = 1 - weight;
      floats[i + 11] = weight;
      floats[i + 14] = -sin[c];
      floats[i + 16] = cos[c];
      floats[i + 17] = -1;
    }
  return out;
}
function smallFloat(values) {
  return Buffer.from(new Float32Array(values).buffer);
}
export function planStress({
  profile = "mixed",
  targetBytes = 2100000000,
  bones = 100,
  morphTargets = 20,
  textureSize = 2048,
  seed = 20261007,
} = {}) {
  if (!PROFILES[profile]) throw new Error("Unknown stress profile");
  if (
    !Number.isSafeInteger(targetBytes) ||
    targetBytes < 4000000 ||
    targetBytes > 3000000000
  )
    throw new Error(
      "targetBytes must be in 4,000,000..3,000,000,000 (GLB uint32 limit)",
    );
  if (!Number.isInteger(bones) || bones < 2 || bones > 1000)
    throw new Error("bones must be in 2..1000");
  if (!Number.isInteger(morphTargets) || morphTargets < 1 || morphTargets > 100)
    throw new Error("morphTargets must be in 1..100");
  if (![64, 128, 256, 512, 1024, 2048].includes(textureSize))
    throw new Error("textureSize must be a supported power of two in 64..2048");
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
    throw new Error("seed must be uint32");
  const recipe = PROFILES[profile];
  let side = textureSize;
  while (side > 64 && pngSize(side) * 5 > targetBytes * recipe.textureRatio)
    side /= 2;
  const materialCount = Math.max(
    1,
    Math.floor((targetBytes * recipe.textureRatio) / (pngSize(side) * 5)),
  );
  const textureBytes = materialCount * 5 * align4(pngSize(side)),
    keyCount = Math.max(
      5,
      Math.floor((targetBytes * 0.038) / (bones * 16 + 4)),
    ),
    morphTriangles = Math.max(
      8,
      Math.floor((targetBytes * recipe.morphRatio) / (morphTargets * 36)),
    );
  const params = {
    profile,
    targetBytes,
    bones,
    morphTargets,
    textureSize,
    seed,
  };
  let triangleCount = Math.floor(
    (targetBytes -
      textureBytes -
      keyCount * (bones * 16 + 4) -
      morphTriangles * morphTargets * 36 -
      100000) /
      216,
  );
  triangleCount = Math.max(morphTriangles + 8 * materialCount, triangleCount);
  const build = (triangles) => {
    const blocks = [],
      views = [],
      accessors = [],
      meshes = [],
      nodes = [],
      channels = [],
      samplers = [],
      images = [],
      textures = [],
      materials = [];
    let offset = 0;
    const composition = {
      geometry: 0,
      textures: 0,
      animations: 0,
      morph: 0,
      skeleton: 0,
      alignment: 0,
      jsonAndHeaders: 0,
    };
    const addBlock = (name, length, kind, generate, stride) => {
      const view = views.length;
      views.push({
        buffer: 0,
        byteOffset: offset,
        byteLength: length,
        ...(stride
          ? { byteStride: stride, target: 34962 }
          : kind === "morph"
            ? { target: 34962 }
            : {}),
      });
      blocks.push({ name, length, kind, view, generate });
      offset += align4(length);
      composition[kind] += length;
      composition.alignment += align4(length) - length;
      return view;
    };
    const accessor = (
      view,
      componentType,
      type,
      count,
      byteOffset = 0,
      bounds,
    ) => {
      const id = accessors.length;
      accessors.push({
        bufferView: view,
        componentType,
        type,
        count,
        byteOffset,
        ...bounds,
      });
      return id;
    };
    for (let b = 0; b < bones; b++)
      nodes.push({
        name: `bone-${b}`,
        translation: [0, b ? 2 / (bones - 1) : 0, 0],
        ...(b < bones - 1 ? { children: [b + 1] } : {}),
      });
    const ibmView = addBlock(
      "inverse-bind-matrices",
      bones * 64,
      "skeleton",
      () => {
        const a = new Float32Array(bones * 16);
        for (let b = 0; b < bones; b++) {
          a[b * 16] = a[b * 16 + 5] = a[b * 16 + 10] = a[b * 16 + 15] = 1;
          a[b * 16 + 13] = (-b * 2) / (bones - 1);
        }
        return Buffer.from(a.buffer);
      },
    );
    const ibm = accessor(ibmView, 5126, "MAT4", bones);
    const morphChunks = split(morphTriangles, 65536),
      normalTotal = triangles - morphTriangles;
    const chunks = [
      ...morphChunks.map((triangles) => ({ triangles, morph: true })),
      ...split(
        normalTotal,
        Math.max(
          8,
          Math.min(
            65536,
            Math.floor(
              normalTotal / Math.max(1, materialCount - morphChunks.length),
            ),
          ),
        ),
      ).map((triangles) => ({ triangles, morph: false })),
    ];
    const columns = Math.ceil(Math.sqrt(chunks.length)),
      meshNodes = [],
      morphNodes = [];
    let effective = new Set();
    for (const [m, chunk] of chunks.entries()) {
      const n = chunk.triangles,
        tileX = ((m % columns) - (columns - 1) / 2) * 0.7,
        tileZ = (Math.floor(m / columns) - (columns - 1) / 2) * 0.7,
        bounds = geometryBounds(n, tileX, tileZ);
      const view = addBlock(
        `geometry-${m}`,
        n * 216,
        "geometry",
        () => makeGeometry(n, bones, tileX, tileZ),
        72,
      );
      const attrs = {
        POSITION: accessor(view, 5126, "VEC3", n * 3, 0, bounds),
        NORMAL: accessor(view, 5126, "VEC3", n * 3, 12),
        TEXCOORD_0: accessor(view, 5126, "VEC2", n * 3, 24),
        JOINTS_0: accessor(view, 5123, "VEC4", n * 3, 32),
        WEIGHTS_0: accessor(view, 5126, "VEC4", n * 3, 40),
        TANGENT: accessor(view, 5126, "VEC4", n * 3, 56),
      };
      const { rows } = grid(n);
      for (let row = 0; row <= rows; row++) {
        const scaled = (row / rows) * (bones - 1),
          joint = Math.min(bones - 1, Math.floor(scaled));
        effective.add(joint);
        if (scaled > joint) effective.add(Math.min(bones - 1, joint + 1));
      }
      const primitive = { attributes: attrs, material: m % materialCount };
      if (chunk.morph) {
        primitive.targets = [];
        for (let k = 0; k < morphTargets; k++) {
          const amp = Math.fround((0.0025 * (k + 1)) / morphTargets),
            half = Math.fround(amp / 2);
          const targetView = addBlock(
            `morph-${m}-${k}`,
            n * 36,
            "morph",
            () => {
              const a = new Float32Array(n * 9);
              for (let v = 0; v < n * 3; v++) {
                a[v * 3] = (v % 2 ? 1 : -1) * amp;
                a[v * 3 + 1] = ((v % 3) - 1) * half;
                a[v * 3 + 2] = ((v % 5) - 2) * half;
              }
              return Buffer.from(a.buffer);
            },
          );
          primitive.targets.push({
            POSITION: accessor(targetView, 5126, "VEC3", n * 3, 0, {
              min: [-amp, -half, -amp],
              max: [amp, half, amp],
            }),
          });
        }
      }
      meshes.push({
        name: `mesh-${m}`,
        primitives: [primitive],
        ...(chunk.morph ? { weights: Array(morphTargets).fill(0) } : {}),
      });
      meshNodes.push(nodes.length);
      if (chunk.morph) morphNodes.push(nodes.length);
      nodes.push({ name: `mesh-node-${m}`, mesh: m, skin: 0 });
    }
    const timeView = addBlock(
      "animation-time",
      keyCount * 4,
      "animations",
      () => {
        const a = Float32Array.from(
          { length: keyCount },
          (_, i) => (i / (keyCount - 1)) * 2,
        );
        return Buffer.from(a.buffer);
      },
    );
    const input = accessor(timeView, 5126, "SCALAR", keyCount, 0, {
      min: [0],
      max: [2],
    });
    for (let b = 0; b < bones; b++) {
      const view = addBlock(
        `bone-animation-${b}`,
        keyCount * 16,
        "animations",
        () => {
          const a = new Float32Array(keyCount * 4);
          for (let i = 0; i < keyCount; i++) {
            const angle =
              (Math.sin((i / (keyCount - 1)) * Math.PI * 12 + b * 0.037) *
                0.6) /
              bones;
            a[i * 4 + 2] = Math.sin(angle / 2);
            a[i * 4 + 3] = Math.cos(angle / 2);
          }
          return Buffer.from(a.buffer);
        },
      );
      channels.push({
        sampler: samplers.length,
        target: { node: b, path: "rotation" },
      });
      samplers.push({
        input,
        output: accessor(view, 5126, "VEC4", keyCount),
        interpolation: "LINEAR",
      });
    }
    const morphKeys = 64,
      morphTime = addBlock("morph-time", morphKeys * 4, "animations", () =>
        smallFloat(
          Array.from(
            { length: morphKeys },
            (_, i) => (i / (morphKeys - 1)) * 2,
          ),
        ),
      ),
      morphInput = accessor(morphTime, 5126, "SCALAR", morphKeys, 0, {
        min: [0],
        max: [2],
      });
    for (const node of morphNodes) {
      const view = addBlock(
        `morph-animation-${node}`,
        morphKeys * morphTargets * 4,
        "animations",
        () =>
          smallFloat(
            Array.from(
              { length: morphKeys * morphTargets },
              (_, i) =>
                0.015 *
                (0.5 +
                  0.5 *
                    Math.sin(
                      (Math.floor(i / morphTargets) / (morphKeys - 1)) *
                        Math.PI *
                        4 +
                        (i % morphTargets) * 0.5,
                    )),
            ),
          ),
      );
      channels.push({
        sampler: samplers.length,
        target: { node, path: "weights" },
      });
      samplers.push({
        input: morphInput,
        output: accessor(view, 5126, "SCALAR", morphKeys * morphTargets),
        interpolation: "LINEAR",
      });
    }
    for (let m = 0; m < materialCount; m++) {
      const textureIds = [];
      for (let r = 0; r < roles.length; r++) {
        const view = addBlock(
          `texture-${m}-${roles[r]}`,
          pngSize(side),
          "textures",
          () =>
            makeTexture(
              side,
              (seed + Math.imul(m + 1, 2654435761) + r * 1013904223) >>> 0,
              roles[r],
            ),
        );
        textureIds.push(textures.length);
        images.push({
          name: `material-${m}-${roles[r]}`,
          bufferView: view,
          mimeType: "image/png",
        });
        textures.push({ source: images.length - 1, sampler: 0 });
      }
      materials.push({
        name: `pbr-${m}`,
        pbrMetallicRoughness: {
          baseColorTexture: { index: textureIds[0] },
          metallicRoughnessTexture: { index: textureIds[2] },
          metallicFactor: 0.7,
          roughnessFactor: 0.8,
        },
        normalTexture: { index: textureIds[1] },
        occlusionTexture: { index: textureIds[3] },
        emissiveTexture: { index: textureIds[4] },
        emissiveFactor: [0.05, 0.05, 0.05],
        doubleSided: true,
      });
    }
    const gltf = {
      asset: {
        version: "2.0",
        generator: `CrossUI Bench Stress ${STRESS_GENERATOR_VERSION}`,
        copyright: "CrossUI Bench contributors; CC0-1.0",
      },
      scene: 0,
      scenes: [{ nodes: [0, ...meshNodes] }],
      nodes,
      meshes,
      skins: [
        {
          inverseBindMatrices: ibm,
          joints: Array.from({ length: bones }, (_, b) => b),
          skeleton: 0,
        },
      ],
      materials,
      images,
      textures,
      samplers: [
        { magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 },
      ],
      animations: [{ name: "Fast Motion + Morph", channels, samplers }],
      accessors,
      bufferViews: views,
      buffers: [{ byteLength: offset }],
      extras: { profile, targetBytes, seed },
    };
    const jsonRaw = Buffer.from(JSON.stringify(gltf)),
      json = Buffer.alloc(align4(jsonRaw.length), 32);
    jsonRaw.copy(json);
    const fileBytes = 28 + json.length + offset;
    composition.jsonAndHeaders = 28 + json.length;
    return {
      gltf,
      json,
      blocks,
      composition,
      fileBytes,
      triangleCount: triangles,
      meshCount: chunks.length,
      materialCount,
      imageCount: materialCount * 5,
      side,
      keyCount,
      morphTriangles,
      effectiveBones: effective.size,
      parameters: params,
    };
  };
  let plan;
  for (let attempt = 0; attempt < 12; attempt++) {
    plan = build(triangleCount);
    const diff = targetBytes - plan.fileBytes;
    if (diff >= 0 && diff < 216) {
      triangleCount += 1;
      continue;
    }
    if (diff < 0 && diff > -512) break;
    triangleCount += Math.ceil(diff / 216);
  }
  if (plan.fileBytes < targetBytes || plan.fileBytes > targetBytes + 1024)
    throw new Error("Cannot fit target with real geometry within 1024 bytes");
  return plan;
}
export async function writeStress(
  options = {},
  directory = "artifacts/stress",
  onProgress = () => {},
) {
  const plan = planStress(options),
    id = `mega-${plan.parameters.targetBytes === 2100000000 ? "2_1gb" : `${plan.parameters.targetBytes}bytes`}-${plan.parameters.profile}`;
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, `${id}.glb`),
    partial = `${file}.partial`;
  try {
    await stat(file);
    throw new Error(
      `Asset already exists: ${file}; choose a new output directory`,
    );
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  const handle = await open(partial, "wx"),
    hash = createHash("sha256"),
    started = performance.now();
  let written = 0,
    peakRss = process.memoryUsage().rss,
    lastNotify = 0;
  const put = async (bytes) => {
    let offset = 0;
    while (offset < bytes.length) {
      const r = await handle.write(bytes, offset, bytes.length - offset);
      if (!r.bytesWritten) throw new Error("Zero-byte write");
      offset += r.bytesWritten;
    }
    hash.update(bytes);
    written += bytes.length;
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  };
  try {
    const header = Buffer.alloc(20);
    header.writeUInt32LE(0x46546c67);
    header.writeUInt32LE(2, 4);
    header.writeUInt32LE(plan.fileBytes, 8);
    header.writeUInt32LE(plan.json.length, 12);
    header.writeUInt32LE(0x4e4f534a, 16);
    await put(header);
    await put(plan.json);
    const binHeader = Buffer.alloc(8);
    binHeader.writeUInt32LE(plan.gltf.buffers[0].byteLength);
    binHeader.writeUInt32LE(0x004e4942, 4);
    await put(binHeader);
    for (const block of plan.blocks) {
      const bytes = block.generate();
      if (bytes.length !== block.length)
        throw new Error(`Incorrect block size: ${block.name}`);
      await put(bytes);
      const padding = align4(bytes.length) - bytes.length;
      if (padding) await put(Buffer.alloc(padding));
      if (performance.now() - lastNotify > 2000) {
        onProgress({
          id,
          written,
          total: plan.fileBytes,
          resource: block.name,
          rssMb: process.memoryUsage().rss / 1048576,
        });
        lastNotify = performance.now();
      }
    }
    if (written !== plan.fileBytes) throw new Error("GLB length mismatch");
    await handle.sync();
    await handle.close();
    await rename(partial, file);
  } catch (e) {
    await handle.close().catch(() => {});
    await unlink(partial).catch(() => {});
    throw e;
  }
  const manifest = {
    id,
    name: id,
    source: "tools/asset-generator/stress.mjs",
    license: "CC0-1.0",
    license_url: "https://creativecommons.org/publicdomain/zero/1.0/",
    redistributable: true,
    format: "GLB",
    size_bytes: written,
    sha256: hash.digest("hex"),
    triangles: plan.triangleCount,
    vertices: plan.triangleCount * 3,
    index_count: 0,
    bones: plan.parameters.bones,
    effective_skinning_bones: plan.effectiveBones,
    animations: ["Fast Motion + Morph"],
    animation_keyframes_per_bone: plan.keyCount,
    morph_targets: plan.parameters.morphTargets,
    morph_triangles: plan.morphTriangles,
    mesh_count: plan.meshCount,
    material_count: plan.materialCount,
    texture_count: plan.imageCount,
    texture_resolution: plan.side,
    raw_texture_size: plan.imageCount * plan.side * plan.side * 4,
    gpu_texture_size_estimate: Math.ceil(
      (plan.imageCount * plan.side * plan.side * 4 * 4) / 3,
    ),
    texture_codec: "PNG RGBA8 / DEFLATE stored (no entropy compression)",
    generated_from:
      "procedural skinned cylinder meshes / animated hierarchy / morph / PBR maps",
    generator_version: STRESS_GENERATOR_VERSION,
    generator_source_sha256: createHash("sha256")
      .update(await readFile(new URL("./stress.mjs", import.meta.url)))
      .digest("hex"),
    generation_parameters: plan.parameters,
    composition_bytes: plan.composition,
    generation_metrics: {
      elapsed_ms: performance.now() - started,
      peak_rss_bytes: peakRss,
      node_version: process.version,
    },
    notes: [
      "2.1 GB means 2,100,000,000 decimal bytes; actual file is within 1024 bytes above target.",
      "All images and morph targets are referenced by visible scene meshes; all joints belong to the animated hierarchy.",
      "Geometry uses interleaved POSITION/NORMAL/UV/JOINTS/WEIGHTS plus TANGENT at 72 bytes per vertex.",
      "Mandatory 4-byte GLB alignment only; no size padding.",
      "GPU estimate includes a full mip chain, excludes geometry/render targets/driver overhead.",
    ],
  };
  await writeFile(
    path.join(directory, `${id}.manifest.json`),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  return manifest;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const args = Object.fromEntries(
      process.argv.slice(2).map((a) => {
        const [key, ...value] = a.replace(/^--/, "").split("=");
        return [key, value.join("=")];
      }),
    ),
    allowed = [
      "profile",
      "targetBytes",
      "bones",
      "morphTargets",
      "textureSize",
      "seed",
      "output",
    ];
  for (const key of Object.keys(args))
    if (!allowed.includes(key)) throw new Error(`Unknown option: ${key}`);
  const options = {};
  for (const key of [
    "targetBytes",
    "bones",
    "morphTargets",
    "textureSize",
    "seed",
  ])
    if (args[key]) options[key] = Number(args[key]);
  const profiles =
    args.profile === "all" ? Object.keys(PROFILES) : [args.profile ?? "mixed"];
  for (const profile of profiles) {
    const manifest = await writeStress(
      { ...options, profile },
      args.output ?? "artifacts/stress",
      (p) =>
        console.log(
          `${p.id}: ${((100 * p.written) / p.total).toFixed(1)}% ${p.resource} RSS ${p.rssMb.toFixed(0)} MiB`,
        ),
    );
    console.log(
      `COMPLETE ${manifest.id}: ${manifest.size_bytes} bytes SHA256 ${manifest.sha256}`,
    );
  }
}
