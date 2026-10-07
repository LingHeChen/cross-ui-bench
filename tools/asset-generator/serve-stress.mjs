import http from "node:http";
import { createReadStream } from "node:fs";
import { stat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
export async function createAssetServer(
  directory = "artifacts/stress",
  port = 1490,
) {
  const root = path.resolve(directory);
  await stat(root);
  const server = http.createServer(async (req, res) => {
    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Expose-Headers": "Content-Length, Content-Range, ETag",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    };
    const fail = (status, message) => {
      res.writeHead(status, { ...headers, "Content-Type": "text/plain" });
      res.end(message);
    };
    try {
      if (!["GET", "HEAD", "OPTIONS"].includes(req.method))
        return fail(405, "Read-only asset server");
      if (!/^(127\.0\.0\.1|localhost):\d+$/.test(req.headers.host ?? ""))
        return fail(403, "Invalid host");
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          ...headers,
          "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
          "Access-Control-Allow-Headers": "Range",
        });
        return res.end();
      }
      const url = new URL(req.url, "http://127.0.0.1");
      if (url.pathname === "/index.json") {
        const assets = [];
        for (const f of (await readdir(root)).filter((n) =>
          n.endsWith(".manifest.json"),
        )) {
          const m = JSON.parse(await readFile(path.join(root, f), "utf8"));
          const name = f.replace(/\.manifest\.json$/, ".glb");
          try {
            const s = await stat(path.join(root, name));
            if (s.size === m.size_bytes)
              assets.push({
                asset: `stress/${m.id}`,
                id: m.id,
                size_bytes: m.size_bytes,
                sha256: m.sha256,
                profile: m.generation_parameters.profile ?? "scaling",
                composition_bytes: m.composition_bytes,
              });
          } catch {}
        }
        const body = JSON.stringify(assets);
        res.writeHead(200, {
          ...headers,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        });
        return res.end(req.method === "HEAD" ? undefined : body);
      }
      const name = url.pathname.slice(1);
      if (!/^[a-z0-9_-]+\.(glb|manifest\.json)$/.test(name))
        return fail(404, "Asset not found");
      const filename = path.join(root, name),
        info = await stat(filename);
      if (!info.isFile()) return fail(404, "Asset not found");
      let start = 0,
        end = info.size - 1,
        status = 200;
      if (req.headers.range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
        if (!match || (!match[1] && !match[2])) {
          res.setHeader("Content-Range", `bytes */${info.size}`);
          return fail(416, "Invalid range");
        }
        if (match[1]) {
          start = Number(match[1]);
          if (match[2]) end = Number(match[2]);
        } else {
          const suffix = Number(match[2]);
          if (suffix === 0) return fail(416, "Invalid range");
          start = Math.max(0, info.size - suffix);
        }
        end = Math.min(end, info.size - 1);
        if (
          start >= info.size ||
          start > end ||
          !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(end)
        ) {
          res.setHeader("Content-Range", `bytes */${info.size}`);
          return fail(416, "Invalid range");
        }
        status = 206;
        headers["Content-Range"] = `bytes ${start}-${end}/${info.size}`;
      }
      res.writeHead(status, {
        ...headers,
        "Content-Type": name.endsWith(".glb")
          ? "model/gltf-binary"
          : "application/json",
        "Content-Length": end - start + 1,
        "Accept-Ranges": "bytes",
      });
      if (req.method === "HEAD") return res.end();
      const stream = createReadStream(filename, {
        start,
        end,
        highWaterMark: 1024 * 1024,
      });
      stream.on("error", (e) => res.destroy(e));
      res.on("close", () => stream.destroy());
      stream.pipe(res);
    } catch (e) {
      if (!res.headersSent)
        fail(
          e.code === "ENOENT" ? 404 : 500,
          e.code === "ENOENT" ? "Asset not found" : "Asset read failed",
        );
      else res.destroy();
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return server;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const directory = process.argv[2] ?? "artifacts/stress",
    server = await createAssetServer(directory);
  console.log(
    `Stress assets: http://127.0.0.1:1490/index.json (${path.resolve(directory)})`,
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => server.close(() => process.exit(0)));
}
