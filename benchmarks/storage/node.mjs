import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
export function storageBlock(kind, size = 1048576) {
  const b = Buffer.alloc(size);
  let seed = 20261007;
  for (let i = 0; i < size; i++) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    b[i] = kind === "compressible" ? 65 : seed & 255;
  }
  return b;
}
export async function runStorage(config, runtime = "electron-node") {
  const root = fs.mkdtempSync(path.join(config.temporaryRoot, "node-"));
  const results = [];
  const block = storageBlock("random");
  const compressed = storageBlock("compressible");
  const fill = (file, bytes, buf) => {
    const fd = fs.openSync(file, "w");
    try {
      for (let p = 0; p < bytes;) {
        const n = Math.min(buf.length, bytes - p);
        fs.writeSync(fd, buf, 0, n, p);
        p += n;
      }
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  };
  try {
    for (const job of config.jobs) {
      const runs = [];
      const buf = job.entropy === "compressible" ? compressed : block;
      const file = path.join(root, "payload.bin"),
        dir = path.join(root, "files"),
        dbFile = path.join(root, "records.sqlite");
      for (let repeat = 0; repeat <= 5; repeat++) {
        const op = job.operation;
        let perform,
          verify = () => {},
          cleanup = () => {},
          bytes = job.bytes ?? 0,
          operations = 1,
          sqliteVersion = null;
        if (
          [
            "sequential-write",
            "sequential-read",
            "random-read",
            "random-write",
          ].includes(op)
        ) {
          if (op !== "sequential-write") fill(file, bytes, buf);
          const fd = fs.openSync(
            file,
            op === "sequential-write"
              ? "w+"
              : op === "random-write"
                ? "r+"
                : "r",
          );
          operations = op.startsWith("random") ? 2048 : 1;
          const scratch = Buffer.alloc(Math.min(bytes, 1048576));
          let consume = 0,
            lastOffset = 0;
          perform = () => {
            if (op === "sequential-write") {
              for (let p = 0; p < bytes;) {
                const n = Math.min(buf.length, bytes - p);
                fs.writeSync(fd, buf, 0, n, p);
                p += n;
              }
              fs.fsyncSync(fd);
            } else if (op === "sequential-read") {
              for (let p = 0; p < bytes;) {
                const n = Math.min(scratch.length, bytes - p);
                const got = fs.readSync(fd, scratch, 0, n, p);
                if (got !== n) throw Error("Short read");
                consume ^= scratch[0];
                p += n;
              }
            } else {
              let seed = 20261007;
              const span = Math.floor(bytes / 4096);
              for (let i = 0; i < operations; i++) {
                seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
                lastOffset = (seed % span) * 4096;
                if (op === "random-read") {
                  fs.readSync(fd, scratch, 0, 4096, lastOffset);
                  consume ^= scratch[0];
                } else fs.writeSync(fd, buf, 0, 4096, lastOffset);
              }
              if (op === "random-write") fs.fsyncSync(fd);
            }
          };
          verify = () => {
            if (fs.fstatSync(fd).size !== bytes) throw Error("Size mismatch");
            if (op === "random-write") {
              fs.readSync(fd, scratch, 0, 4096, lastOffset);
              if (!scratch.subarray(0, 4096).equals(buf.subarray(0, 4096)))
                throw Error("Random write integrity mismatch");
            } else {
              fs.readSync(fd, scratch, 0, Math.min(4096, bytes), 0);
              if (
                !scratch
                  .subarray(0, Math.min(4096, bytes))
                  .equals(buf.subarray(0, Math.min(4096, bytes)))
              )
                throw Error("Read integrity mismatch");
            }
          };
          cleanup = () => {
            fs.closeSync(fd);
            fs.unlinkSync(file);
          };
        } else if (
          ["file-create", "file-delete", "directory-scan"].includes(op)
        ) {
          fs.mkdirSync(dir);
          operations = job.count;
          bytes = job.count * job.fileBytes;
          const create = () => {
            for (let i = 0; i < job.count; i++) {
              const fd = fs.openSync(path.join(dir, i + ".bin"), "wx");
              fs.writeSync(fd, buf, 0, job.fileBytes);
              fs.closeSync(fd);
            }
          };
          if (op !== "file-create") create();
          perform = () => {
            if (op === "file-create") create();
            else if (op === "file-delete") {
              for (let i = 0; i < job.count; i++)
                fs.unlinkSync(path.join(dir, i + ".bin"));
            } else if (fs.readdirSync(dir).length !== job.count)
              throw Error("Directory count mismatch");
          };
          verify = () => {
            if (
              fs.readdirSync(dir).length !==
              (op === "file-delete" ? 0 : job.count)
            )
              throw Error("Small files integrity mismatch");
          };
          cleanup = () => {
            for (const f of fs.readdirSync(dir))
              fs.unlinkSync(path.join(dir, f));
            fs.rmdirSync(dir);
          };
        } else {
          const db = new DatabaseSync(dbFile);
          sqliteVersion = db.prepare("SELECT sqlite_version() v").get().v;
          db.exec(
            "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA page_size=4096; CREATE TABLE entries(id INTEGER PRIMARY KEY, value INTEGER NOT NULL, payload TEXT NOT NULL); CREATE INDEX value_idx ON entries(value)",
          );
          const insert = db.prepare("INSERT INTO entries VALUES(?,?,?)");
          const insertAll = () => {
            for (let i = 0; i < job.rows; i++)
              insert.run(i, i % 1000, "payload-" + i);
          };
          const batch = () => {
            db.exec("BEGIN IMMEDIATE");
            insertAll();
            db.exec("COMMIT");
          };
          if (!["sqlite-insert", "sqlite-batch-insert"].includes(op)) {
            batch();
            if (op === "sqlite-vacuum")
              db.exec("DELETE FROM entries WHERE id % 2=0");
          }
          operations = [
            "sqlite-indexed-query",
            "sqlite-random-update",
          ].includes(op)
            ? 2048
            : job.rows;
          const query = db.prepare(
              "SELECT count(*) n FROM entries WHERE value=?",
            ),
            update = db.prepare("UPDATE entries SET payload=? WHERE id=?");
          perform = () => {
            if (op === "sqlite-insert") insertAll();
            else if (op === "sqlite-batch-insert") batch();
            else if (op === "sqlite-indexed-query") {
              for (let i = 0; i < 2048; i++) query.get(i % 1000);
            } else if (op === "sqlite-random-update") {
              let seed = 20261007;
              for (let i = 0; i < 2048; i++) {
                seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
                update.run("updated", seed % job.rows);
              }
            } else if (op === "sqlite-transaction") {
              db.exec("BEGIN IMMEDIATE");
              for (let i = 0; i < job.rows; i++) update.run("updated", i);
              db.exec("COMMIT");
            } else if (op === "sqlite-vacuum") db.exec("VACUUM");
            else throw Error("Unknown operation");
          };
          verify = () => {
            const n = db.prepare("SELECT count(*) n FROM entries").get().n;
            if (
              n !==
              (op === "sqlite-vacuum" ? Math.floor(job.rows / 2) : job.rows)
            )
              throw Error("SQLite row count mismatch");
            if (
              db.prepare("PRAGMA integrity_check").get().integrity_check !==
              "ok"
            )
              throw Error("SQLite integrity check failed");
          };
          cleanup = () => {
            db.close();
            for (const suffix of ["", "-wal", "-shm"])
              if (fs.existsSync(dbFile + suffix))
                fs.unlinkSync(dbFile + suffix);
          };
        }
        const start = performance.now();
        perform();
        const elapsedMs = performance.now() - start;
        verify();
        cleanup();
        if (repeat)
          runs.push({
            index: repeat,
            elapsedMs,
            bytes,
            operations,
            sqliteVersion,
            verified: true,
          });
      }
      results.push({
        benchmark: "storage",
        runtime,
        parameters: job,
        runs,
        implementation: "node:fs / node:sqlite",
        comparisonClass: "framework-best-practice",
        protocol: {
          runs: 5,
          warmupRuns: 1,
          fsyncSingleFileWrites: true,
          smallFileFsync: false,
          sqliteJournal: "WAL",
          sqliteSynchronous: "FULL",
          blockBytes: 1048576,
          randomBlockBytes: 4096,
          randomOperations: 2048,
          cache: "OS page cache uncontrolled; warm reads",
          payload:
            "repeated deterministic 1MiB xorshift block; compressible block is ASCII A",
        },
      });
      fs.writeFileSync(
        config.output,
        JSON.stringify(
          { schemaVersion: "storage-1", runtime, results },
          null,
          2,
        ),
      );
      console.log(
        "STORAGE_PROGRESS " +
          JSON.stringify({
            runtime,
            operation: job.operation,
            completed: results.length,
            total: config.jobs.length,
          }),
      );
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log("STORAGE_RESULT " + config.output);
  return results;
}
