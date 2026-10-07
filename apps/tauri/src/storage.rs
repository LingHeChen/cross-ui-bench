use rusqlite::{params, Connection};
use serde_json::{json, Value};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    path::Path,
    time::Instant,
};
type E = Box<dyn std::error::Error>;
fn block(kind: &str) -> Vec<u8> {
    let mut b = vec![0; 1048576];
    let mut seed = 20261007_u32;
    for v in &mut b {
        seed ^= seed << 13;
        seed ^= seed >> 17;
        seed ^= seed << 5;
        *v = if kind == "compressible" {
            65
        } else {
            seed as u8
        };
    }
    b
}
fn fill(path: &Path, size: u64, b: &[u8]) -> Result<(), E> {
    let mut f = File::create(path)?;
    let mut p = 0;
    while p < size {
        let n = (size - p).min(b.len() as u64) as usize;
        f.write_all(&b[..n])?;
        p += n as u64;
    }
    f.sync_all()?;
    Ok(())
}
pub fn run(config: Value) -> Result<(), E> {
    let temp = config["temporaryRoot"]
        .as_str()
        .ok_or("missing temp root")?;
    let root = Path::new(temp).join(format!("rust-{}", std::process::id()));
    fs::create_dir(&root)?;
    let random = block("random");
    let compressed = block("compressible");
    let mut results = vec![];
    let result = (|| -> Result<(), E> {
        for job in config["jobs"].as_array().ok_or("missing jobs")? {
            let op = job["operation"].as_str().ok_or("missing operation")?;
            let b = if job["entropy"] == "compressible" {
                &compressed
            } else {
                &random
            };
            let mut runs = vec![];
            for repeat in 0..=5 {
                let mut bytes = job["bytes"].as_u64().unwrap_or(0);
                let mut operations = 1_u64;
                let mut version = None;
                let elapsed;
                let name = root.join("payload.bin");
                let dir = root.join("files");
                let dbname = root.join("records.sqlite");
                if [
                    "sequential-write",
                    "sequential-read",
                    "random-read",
                    "random-write",
                ]
                .contains(&op)
                {
                    if op != "sequential-write" {
                        fill(&name, bytes, b)?;
                    }
                    let mut f = if op == "sequential-write" {
                        OpenOptions::new()
                            .read(true)
                            .write(true)
                            .create(true)
                            .truncate(true)
                            .open(&name)?
                    } else {
                        OpenOptions::new()
                            .read(true)
                            .write(op == "random-write")
                            .open(&name)?
                    };
                    let mut scratch = vec![0; bytes.min(1048576) as usize];
                    let mut last_offset = 0;
                    if op.starts_with("random") {
                        operations = 2048;
                    }
                    let t = Instant::now();
                    if op == "sequential-write" {
                        let mut p = 0;
                        while p < bytes {
                            let n = (bytes - p).min(b.len() as u64) as usize;
                            f.write_all(&b[..n])?;
                            p += n as u64;
                        }
                        f.sync_all()?;
                    } else if op == "sequential-read" {
                        let mut p = 0;
                        while p < bytes {
                            let n = (bytes - p).min(scratch.len() as u64) as usize;
                            f.read_exact(&mut scratch[..n])?;
                            p += n as u64;
                        }
                    } else {
                        let mut seed = 20261007_u32;
                        for _ in 0..2048 {
                            seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
                            last_offset = (seed as u64 % (bytes / 4096)) * 4096;
                            f.seek(SeekFrom::Start(last_offset))?;
                            if op == "random-read" {
                                f.read_exact(&mut scratch[..4096])?;
                            } else {
                                f.write_all(&b[..4096])?;
                            }
                        }
                        if op == "random-write" {
                            f.sync_all()?;
                        }
                    }
                    elapsed = t.elapsed().as_secs_f64() * 1000.;
                    if f.metadata()?.len() != bytes {
                        return Err("size mismatch".into());
                    }
                    f.seek(SeekFrom::Start(if op == "random-write" {
                        last_offset
                    } else {
                        0
                    }))?;
                    let n = bytes.min(4096) as usize;
                    f.read_exact(&mut scratch[..n])?;
                    if scratch[..n] != b[..n] {
                        return Err("content mismatch".into());
                    }
                    drop(f);
                    fs::remove_file(&name)?;
                } else if ["file-create", "file-delete", "directory-scan"].contains(&op) {
                    fs::create_dir(&dir)?;
                    operations = job["count"].as_u64().ok_or("count")?;
                    let each = job["fileBytes"].as_u64().ok_or("fileBytes")? as usize;
                    bytes = operations * each as u64;
                    let create = || -> Result<(), E> {
                        for i in 0..operations {
                            let mut f = File::create(dir.join(format!("{i}.bin")))?;
                            f.write_all(&b[..each])?;
                        }
                        Ok(())
                    };
                    if op != "file-create" {
                        create()?;
                    }
                    let t = Instant::now();
                    if op == "file-create" {
                        create()?;
                    } else if op == "file-delete" {
                        for i in 0..operations {
                            fs::remove_file(dir.join(format!("{i}.bin")))?;
                        }
                    } else if fs::read_dir(&dir)?.count() as u64 != operations {
                        return Err("directory count".into());
                    }
                    elapsed = t.elapsed().as_secs_f64() * 1000.;
                    if fs::read_dir(&dir)?.count() as u64
                        != if op == "file-delete" { 0 } else { operations }
                    {
                        return Err("small files mismatch".into());
                    }
                    fs::remove_dir_all(&dir)?;
                } else {
                    let db = Connection::open(&dbname)?;
                    version = Some(
                        db.query_row("SELECT sqlite_version()", [], |r| r.get::<_, String>(0))?,
                    );
                    db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA page_size=4096; CREATE TABLE entries(id INTEGER PRIMARY KEY,value INTEGER NOT NULL,payload TEXT NOT NULL); CREATE INDEX value_idx ON entries(value)")?;
                    let rows = job["rows"].as_u64().ok_or("rows")?;
                    let mut insert = db.prepare("INSERT INTO entries VALUES(?,?,?)")?;
                    let mut insert_all = || -> Result<(), E> {
                        for i in 0..rows {
                            insert.execute(params![i, i % 1000, format!("payload-{i}")])?;
                        }
                        Ok(())
                    };
                    if !["sqlite-insert", "sqlite-batch-insert"].contains(&op) {
                        db.execute_batch("BEGIN IMMEDIATE")?;
                        insert_all()?;
                        db.execute_batch("COMMIT")?;
                        if op == "sqlite-vacuum" {
                            db.execute_batch("DELETE FROM entries WHERE id % 2=0")?;
                        }
                    }
                    operations = if ["sqlite-indexed-query", "sqlite-random-update"].contains(&op) {
                        2048
                    } else {
                        rows
                    };
                    let mut query = db.prepare("SELECT count(*) FROM entries WHERE value=?")?;
                    let mut update = db.prepare("UPDATE entries SET payload=? WHERE id=?")?;
                    let t = Instant::now();
                    match op {
                        "sqlite-insert" => insert_all()?,
                        "sqlite-batch-insert" => {
                            db.execute_batch("BEGIN IMMEDIATE")?;
                            insert_all()?;
                            db.execute_batch("COMMIT")?;
                        }
                        "sqlite-indexed-query" => {
                            for i in 0..2048 {
                                let _: u64 = query.query_row([i % 1000], |r| r.get(0))?;
                            }
                        }
                        "sqlite-random-update" => {
                            let mut seed = 20261007_u32;
                            for _ in 0..2048 {
                                seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
                                update.execute(params!["updated", seed as u64 % rows])?;
                            }
                        }
                        "sqlite-transaction" => {
                            db.execute_batch("BEGIN IMMEDIATE")?;
                            for i in 0..rows {
                                update.execute(params!["updated", i])?;
                            }
                            db.execute_batch("COMMIT")?;
                        }
                        "sqlite-vacuum" => db.execute_batch("VACUUM")?,
                        _ => return Err("unknown operation".into()),
                    };
                    elapsed = t.elapsed().as_secs_f64() * 1000.;
                    let count: u64 =
                        db.query_row("SELECT count(*) FROM entries", [], |r| r.get(0))?;
                    if count
                        != if op == "sqlite-vacuum" {
                            rows / 2
                        } else {
                            rows
                        }
                    {
                        return Err("row mismatch".into());
                    }
                    let integrity: String =
                        db.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
                    if integrity != "ok" {
                        return Err("integrity check failed".into());
                    }
                    drop(query);
                    drop(update);
                    drop(insert_all);
                    drop(insert);
                    drop(db);
                    for suffix in ["", "-wal", "-shm"] {
                        let p = root.join(format!("records.sqlite{suffix}"));
                        if p.exists() {
                            fs::remove_file(p)?;
                        }
                    }
                }
                if repeat > 0 {
                    runs.push(json!({"index":repeat,"elapsedMs":elapsed,"bytes":bytes,"operations":operations,"sqliteVersion":version,"verified":true}));
                }
            }
            results.push(json!({"benchmark":"storage","runtime":"tauri-rust","parameters":job,"runs":runs,"implementation":"std::fs / rusqlite 0.37","comparisonClass":"framework-best-practice","protocol":{"runs":5,"warmupRuns":1,"fsyncSingleFileWrites":true,"smallFileFsync":false,"sqliteJournal":"WAL","sqliteSynchronous":"FULL","blockBytes":1048576,"randomBlockBytes":4096,"randomOperations":2048,"cache":"OS page cache uncontrolled; warm reads","payload":"repeated deterministic 1MiB xorshift block; compressible block is ASCII A"}}));
            fs::write(
                config["output"].as_str().ok_or("output")?,
                serde_json::to_vec_pretty(
                    &json!({"schemaVersion":"storage-1","runtime":"tauri-rust","results":results}),
                )?,
            )?;
            println!(
                "STORAGE_PROGRESS {}",
                json!({"runtime":"tauri-rust","operation":op,"completed":results.len(),"total":config["jobs"].as_array().unwrap().len()})
            );
        }
        Ok(())
    })();
    fs::remove_dir_all(&root)?;
    result?;
    println!("STORAGE_RESULT {}", config["output"].as_str().unwrap());
    Ok(())
}
