import 'dart:io';
import 'dart:convert';
import 'dart:typed_data';
import 'dart:math' as math;

import 'package:sqlite3/sqlite3.dart';

Uint8List storageBlock(String entropy) {
  final bytes = Uint8List(1048576);
  var seed = 20261007;
  for (var i = 0; i < bytes.length; i++) {
    seed = (seed ^ (seed << 13)) & 0xffffffff;
    seed = (seed ^ (seed >> 17)) & 0xffffffff;
    seed = (seed ^ (seed << 5)) & 0xffffffff;
    bytes[i] = entropy == 'compressible' ? 65 : seed & 255;
  }
  return bytes;
}

Future<void> runStorage(Map<String, dynamic> config) async {
  final root = Directory(config['temporaryRoot']).createTempSync('dart-');
  final results = <Map<String, dynamic>>[];
  final random = storageBlock('random'),
      compressed = storageBlock('compressible');
  void fill(String name, int size, Uint8List buf) {
    final f = File(name).openSync(mode: FileMode.write);
    try {
      for (var p = 0; p < size; p += buf.length) {
        f.writeFromSync(buf, 0, math.min(buf.length, size - p));
      }
      f.flushSync();
    } finally {
      f.closeSync();
    }
  }

  try {
    for (final dynamic rawJob in config['jobs']) {
      final job = Map<String, dynamic>.from(rawJob),
          runs = <Map<String, dynamic>>[];
      final buf = job['entropy'] == 'compressible' ? compressed : random;
      for (var repeat = 0; repeat <= 5; repeat++) {
        final op = job['operation'] as String;
        var bytes = (job['bytes'] ?? 0) as int, operations = 1;
        String? sqliteVersion;
        late void Function() perform, cleanup;
        void Function() verify = () {};
        final name = '${root.path}/payload.bin',
            dir = Directory('${root.path}/files'),
            dbName = '${root.path}/records.sqlite';
        if ([
          'sequential-write',
          'sequential-read',
          'random-read',
          'random-write',
        ].contains(op)) {
          if (op != 'sequential-write') fill(name, bytes, buf);
          final f = File(name).openSync(
            mode: op == 'sequential-write'
                ? FileMode.write
                : op == 'random-write'
                ? FileMode.append
                : FileMode.read,
          );
          final scratch = Uint8List(math.min(bytes, 1048576));
          var lastOffset = 0;
          operations = op.startsWith('random') ? 2048 : 1;
          perform = () {
            if (op == 'sequential-write') {
              for (var p = 0; p < bytes; p += buf.length) {
                f.writeFromSync(buf, 0, math.min(buf.length, bytes - p));
              }
              f.flushSync();
            } else if (op == 'sequential-read') {
              for (var p = 0; p < bytes; p += scratch.length) {
                final n = math.min(scratch.length, bytes - p);
                if (f.readIntoSync(scratch, 0, n) != n) {
                  throw StateError('Short read');
                }
              }
            } else {
              var seed = 20261007;
              final span = bytes ~/ 4096;
              for (var i = 0; i < operations; i++) {
                seed = (seed * 1664525 + 1013904223) & 0xffffffff;
                lastOffset = (seed % span) * 4096;
                f.setPositionSync(lastOffset);
                if (op == 'random-read') {
                  if (f.readIntoSync(scratch, 0, 4096) != 4096) {
                    throw StateError('Short random read');
                  }
                } else {
                  f.writeFromSync(buf, 0, 4096);
                }
              }
              if (op == 'random-write') f.flushSync();
            }
          };
          verify = () {
            if (f.lengthSync() != bytes) throw StateError('Size mismatch');
            if (op == 'random-write' ||
                op == 'sequential-read' ||
                op == 'sequential-write') {
              f.setPositionSync(op == 'random-write' ? lastOffset : 0);
              final read = f.readSync(4096);
              for (var i = 0; i < read.length; i++) {
                if (read[i] != buf[i]) {
                  throw StateError('Random write integrity mismatch');
                }
              }
            }
          };
          cleanup = () {
            f.closeSync();
            File(name).deleteSync();
          };
        } else if ([
          'file-create',
          'file-delete',
          'directory-scan',
        ].contains(op)) {
          dir.createSync();
          operations = job['count'];
          bytes = operations * (job['fileBytes'] as int);
          void create() {
            for (var i = 0; i < operations; i++) {
              File('${dir.path}/$i.bin').writeAsBytesSync(
                Uint8List.sublistView(buf, 0, job['fileBytes']),
                flush: false,
              );
            }
          }

          if (op != 'file-create') create();
          perform = () {
            if (op == 'file-create') {
              create();
            } else if (op == 'file-delete') {
              for (var i = 0; i < operations; i++) {
                File('${dir.path}/$i.bin').deleteSync();
              }
            } else {
              if (dir.listSync().length != operations) {
                throw StateError('Directory mismatch');
              }
            }
          };
          verify = () {
            if (dir.listSync().length !=
                (op == 'file-delete' ? 0 : operations)) {
              throw StateError('Small files mismatch');
            }
          };
          cleanup = () {
            dir.deleteSync(recursive: true);
          };
        } else {
          final db = sqlite3.open(dbName);
          sqliteVersion = db.select('SELECT sqlite_version() v').single['v'];
          db.execute('PRAGMA journal_mode=WAL');
          db.execute('PRAGMA synchronous=FULL');
          db.execute('PRAGMA page_size=4096');
          db.execute(
            'CREATE TABLE entries(id INTEGER PRIMARY KEY, value INTEGER NOT NULL, payload TEXT NOT NULL)',
          );
          db.execute('CREATE INDEX value_idx ON entries(value)');
          final rows = job['rows'] as int,
              insert = db.prepare('INSERT INTO entries VALUES(?,?,?)'),
              update = db.prepare('UPDATE entries SET payload=? WHERE id=?'),
              query = db.prepare(
                'SELECT count(*) n FROM entries WHERE value=?',
              );
          void insertAll() {
            for (var i = 0; i < rows; i++) {
              insert.execute([i, i % 1000, 'payload-$i']);
            }
          }

          void batch() {
            db.execute('BEGIN IMMEDIATE');
            insertAll();
            db.execute('COMMIT');
          }

          if (!['sqlite-insert', 'sqlite-batch-insert'].contains(op)) {
            batch();
            if (op == 'sqlite-vacuum') {
              db.execute('DELETE FROM entries WHERE id % 2=0');
            }
          }
          operations =
              ['sqlite-indexed-query', 'sqlite-random-update'].contains(op)
              ? 2048
              : rows;
          perform = () {
            if (op == 'sqlite-insert') {
              insertAll();
            } else if (op == 'sqlite-batch-insert') {
              batch();
            } else if (op == 'sqlite-indexed-query') {
              for (var i = 0; i < 2048; i++) {
                query.select([i % 1000]);
              }
            } else if (op == 'sqlite-random-update') {
              var seed = 20261007;
              for (var i = 0; i < 2048; i++) {
                seed = (seed * 1664525 + 1013904223) & 0xffffffff;
                update.execute(['updated', seed % rows]);
              }
            } else if (op == 'sqlite-transaction') {
              db.execute('BEGIN IMMEDIATE');
              for (var i = 0; i < rows; i++) {
                update.execute(['updated', i]);
              }
              db.execute('COMMIT');
            } else if (op == 'sqlite-vacuum') {
              db.execute('VACUUM');
            } else {
              throw StateError('Unknown operation');
            }
          };
          verify = () {
            if (db.select('SELECT count(*) n FROM entries').single['n'] !=
                (op == 'sqlite-vacuum' ? rows ~/ 2 : rows)) {
              throw StateError('Row mismatch');
            }
            if (db.select('PRAGMA integrity_check').single.values.first !=
                'ok') {
              throw StateError('Integrity check failed');
            }
          };
          cleanup = () {
            insert.dispose();
            update.dispose();
            query.dispose();
            db.dispose();
            for (final suffix in ['', '-wal', '-shm']) {
              final f = File(dbName + suffix);
              if (f.existsSync()) f.deleteSync();
            }
          };
        }
        final timer = Stopwatch()..start();
        perform();
        timer.stop();
        final elapsed = timer.elapsedMicroseconds / 1000;
        verify();
        cleanup();
        if (repeat > 0) {
          runs.add({
            'index': repeat,
            'elapsedMs': elapsed,
            'bytes': bytes,
            'operations': operations,
            'sqliteVersion': sqliteVersion,
            'verified': true,
          });
        }
      }
      results.add({
        'benchmark': 'storage',
        'runtime': 'flutter-dart',
        'parameters': job,
        'runs': runs,
        'implementation': 'dart:io / sqlite3 2.9.4',
        'comparisonClass': 'framework-best-practice',
        'protocol': {
          'runs': 5,
          'warmupRuns': 1,
          'fsyncSingleFileWrites': true,
          'smallFileFsync': false,
          'sqliteJournal': 'WAL',
          'sqliteSynchronous': 'FULL',
          'blockBytes': 1048576,
          'randomBlockBytes': 4096,
          'randomOperations': 2048,
          'cache': 'OS page cache uncontrolled; warm reads',
          'payload': 'repeated deterministic 1MiB xorshift block; compressible block is ASCII A',
        },
      });
      File(config['output']).writeAsStringSync(
        jsonEncode({
          'schemaVersion': 'storage-1',
          'runtime': 'flutter-dart',
          'results': results,
        }),
      );
      stdout.writeln(
        'STORAGE_PROGRESS ${jsonEncode({'runtime': 'flutter-dart', 'operation': job['operation'], 'completed': results.length, 'total': config['jobs'].length})}',
      );
    }
  } finally {
    root.deleteSync(recursive: true);
  }
  stdout.writeln('STORAGE_RESULT ${config['output']}');
}
