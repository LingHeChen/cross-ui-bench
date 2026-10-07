import { writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
export const GENERATOR_VERSION = "0.2.0";
export function generateCharacter({
  triangles = 1000,
  bones = 16,
  textureSize = 256,
  characters = 1,
} = {}) {
  for (const [name, value, max] of [
    ["triangles", triangles, 10000000],
    ["bones", bones, 1000],
    ["textureSize", textureSize, 8192],
    ["characters", characters, 50],
  ])
    if (!Number.isInteger(value) || value < 1 || value > max)
      throw new Error(
        `${name} must be an integer in 1..${max}; scaling limit exceeded`,
      );
  if (triangles < bones * 2)
    throw new Error(
      "Need at least two triangles per bone to ensure effective weights",
    );
  const pieces = [],
    views = [],
    accessors = [];
  let offset = 0;
  const add = (array, componentType, type, min, max) => {
    const data = Buffer.from(array.buffer, array.byteOffset, array.byteLength),
      padded = Buffer.alloc(Math.ceil(data.length / 4) * 4);
    data.copy(padded);
    const view = views.length;
    views.push({ buffer: 0, byteOffset: offset, byteLength: data.length });
    pieces.push(padded);
    offset += padded.length;
    const accessor = accessors.length;
    accessors.push({
      bufferView: view,
      componentType,
      count:
        array.length / { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[type],
      type,
      ...(min ? { min, max } : {}),
    });
    return accessor;
  };
  const positions = new Float32Array(triangles * 9),
    normals = new Float32Array(triangles * 9),
    uvs = new Float32Array(triangles * 6),
    joints = new Uint16Array(triangles * 12),
    weights = new Float32Array(triangles * 12);
  // A procedurally tessellated humanoid silhouette. Each vertical band has real joint weights.
  const rows = Math.max(bones, Math.ceil(Math.sqrt(triangles / 4))),
    cols = Math.max(1, Math.floor(triangles / (rows * 4)));
  for (let t = 0; t < triangles; t++) {
    const side = Math.floor(t / (rows * cols * 2)) % 2,
      cell = Math.floor(t / 2) % (rows * cols),
      row = Math.floor(cell / cols),
      col = cell % cols,
      flip = t % 2;
    const corners = flip
      ? [
          [0, 0],
          [1, 1],
          [0, 1],
        ]
      : [
          [0, 0],
          [1, 0],
          [1, 1],
        ];
    for (let v = 0; v < 3; v++) {
      const u = (col + corners[v][0]) / cols,
        y = ((row + corners[v][1]) / rows) * 2;
      const width = y > 1.65 ? 0.22 : y > 1.1 ? 0.7 : y > 0.7 ? 0.4 : 0.45;
      const x = (u - 0.5) * width,
        z = (side === 0 ? 1 : -1) * (y > 1.65 ? 0.12 : 0.09);
      const vertex = t * 3 + v;
      positions.set([x, y, z], vertex * 3);
      normals.set([0, 0, side === 0 ? 1 : -1], vertex * 3);
      uvs.set([u, y / 2], vertex * 2);
      const joint = Math.min(bones - 1, Math.floor((y / 2) * bones + 1e-6));
      joints[vertex * 4] = joint;
      weights[vertex * 4] = 1;
    }
  }
  const actualMin = [Infinity, Infinity, Infinity],
    actualMax = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i++) {
    const axis = i % 3;
    actualMin[axis] = Math.min(actualMin[axis], positions[i]);
    actualMax[axis] = Math.max(actualMax[axis], positions[i]);
  }
  const attrs = {
    POSITION: add(positions, 5126, "VEC3", actualMin, actualMax),
    NORMAL: add(normals, 5126, "VEC3"),
    TEXCOORD_0: add(uvs, 5126, "VEC2"),
    JOINTS_0: add(joints, 5123, "VEC4"),
    WEIGHTS_0: add(weights, 5126, "VEC4"),
  };
  for (const accessor of Object.values(attrs))
    views[accessors[accessor].bufferView].target = 34962;
  const matrices = new Float32Array(bones * 16);
  for (let b = 0; b < bones; b++) {
    matrices[b * 16] =
      matrices[b * 16 + 5] =
      matrices[b * 16 + 10] =
      matrices[b * 16 + 15] =
        1;
    matrices[b * 16 + 13] = (-b * 2) / bones;
  }
  const inverseBindMatrices = add(matrices, 5126, "MAT4");
  const times = new Float32Array([0, 0.5, 1, 1.5, 2]);
  const timeAccessor = add(times, 5126, "SCALAR", [0], [2]);
  const samplers = [],
    channels = [];
  const nodes = Array.from({ length: bones }, (_, b) => ({
    name: `bone-${b}`,
    translation: [0, b === 0 ? 0 : 2 / bones, 0],
    ...(b < bones - 1 ? { children: [b + 1] } : {}),
  }));
  for (let b = 0; b < bones; b++) {
    const rotations = new Float32Array(20);
    for (let f = 0; f < 5; f++) {
      const angle =
        f === 4 ? 0 : (Math.sin((f * Math.PI) / 2 + b * 0.25) * 0.6) / bones;
      rotations.set([0, 0, Math.sin(angle / 2), Math.cos(angle / 2)], f * 4);
    }
    const output = add(rotations, 5126, "VEC4");
    channels.push({
      sampler: samplers.length,
      target: { node: b, path: "rotation" },
    });
    samplers.push({ input: timeAccessor, output, interpolation: "LINEAR" });
  }
  // PNG contains actual pixel data with deterministic high entropy, never file padding.
  const png = makePng(textureSize);
  const textureView = views.length;
  views.push({ buffer: 0, byteOffset: offset, byteLength: png.length });
  const pngPadded = Buffer.alloc(Math.ceil(png.length / 4) * 4);
  png.copy(pngPadded);
  pieces.push(pngPadded);
  offset += pngPadded.length;
  const meshNodes = [];
  for (let c = 0; c < characters; c++) {
    meshNodes.push(nodes.length);
    nodes.push({
      name: `character-${c}`,
      mesh: 0,
      skin: 0,
      translation: [c * 1.2, 0, 0],
    });
  }
  const gltf = {
    asset: { version: "2.0", generator: `CrossUI Bench ${GENERATOR_VERSION}` },
    scene: 0,
    scenes: [{ nodes: [0, ...meshNodes] }],
    nodes,
    skins: [
      {
        inverseBindMatrices,
        joints: Array.from({ length: bones }, (_, b) => b),
        skeleton: 0,
      },
    ],
    meshes: [{ primitives: [{ attributes: attrs, material: 0 }] }],
    materials: [
      {
        pbrMetallicRoughness: {
          baseColorTexture: { index: 0 },
          metallicFactor: 0,
          roughnessFactor: 0.8,
        },
        doubleSided: true,
      },
    ],
    images: [{ bufferView: textureView, mimeType: "image/png" }],
    textures: [{ source: 0 }],
    animations: [{ name: "Fast Motion", samplers, channels }],
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: offset }],
  };
  const jsonRaw = Buffer.from(JSON.stringify(gltf));
  const json = Buffer.alloc(Math.ceil(jsonRaw.length / 4) * 4, 32);
  jsonRaw.copy(json);
  const bin = Buffer.concat(pieces);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28 + json.length + bin.length, 8);
  header.writeUInt32LE(json.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(bin.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);
  return {
    buffer: Buffer.concat([header, json, binHeader, bin]),
    metadata: {
      triangles,
      vertices: triangles * 3,
      bones,
      effective_skinning_bones: new Set(joints.filter((_, i) => i % 4 === 0))
        .size,
      animations: ["Fast Motion"],
      morph_targets: 0,
      texture_resolution: textureSize,
      mesh_count: characters,
      material_count: 1,
      index_count: 0,
      raw_texture_size: textureSize * textureSize * 4,
      gpu_texture_size_estimate: textureSize * textureSize * 4,
      notes:
        "Non-indexed procedural humanoid silhouette. Chain skeleton, real weights and animation. Duplication shares skeleton; independently animated duplication is performed by the runtime scene, not baked into this GLB.",
    },
  };
}

import { deflateSync } from "node:zlib";
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const b of buffer) {
    crc ^= b;
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const text = Buffer.from(type),
    out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  text.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([text, data])), out.length - 4);
  return out;
}
function makePng(n) {
  const pixels = Buffer.alloc(n * (n * 4 + 1));
  let seed = 42;
  for (let y = 0; y < n; y++) {
    const start = y * (n * 4 + 1);
    for (let x = 0; x < n; x++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const i = start + 1 + x * 4;
      pixels[i] = 80 + (seed & 63);
      pixels[i + 1] = 150 + ((seed >>> 8) & 63);
      pixels[i + 2] = 60 + ((seed >>> 16) & 63);
      pixels[i + 3] = 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(n, 0);
  header.writeUInt32BE(n, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
export async function writeCharacter(
  params = {},
  id = "character-lowpoly",
  directory = "assets/generated",
) {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error("Invalid generated asset id");
  params = {
    triangles: 1000,
    bones: 16,
    textureSize: 256,
    characters: 1,
    ...params,
  };
  const { buffer, metadata } = generateCharacter(params);
  await mkdir(directory, { recursive: true });
  await writeFile(`${directory}/${id}.glb`, buffer);
  const manifest = {
    id,
    name: id,
    source: "tools/asset-generator/generate.mjs",
    license: "CC0-1.0",
    license_url: "https://creativecommons.org/publicdomain/zero/1.0/",
    redistributable: true,
    format: "GLB",
    size_bytes: buffer.length,
    ...metadata,
    generated_from: "procedural",
    generator_version: GENERATOR_VERSION,
    generation_parameters: params,
    sha256: createHash("sha256").update(buffer).digest("hex"),
  };
  await writeFile(
    `${directory}/${id}.manifest.json`,
    JSON.stringify(manifest, null, 2) + "\n",
  );
  return manifest;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const params = {};
  let id = "character-lowpoly",
    output = "assets/generated";
  for (const arg of process.argv.slice(2)) {
    const [k, v] = arg.replace(/^--/, "").split("=");
    if (k === "id") id = v;
    else if (k === "output") output = v;
    else if (["triangles", "bones", "characters", "textureSize"].includes(k))
      params[k] = Number(v);
    else throw new Error(`Unknown option ${k}`);
  }
  console.log(
    JSON.stringify(await writeCharacter(params, id, output), null, 2),
  );
}
