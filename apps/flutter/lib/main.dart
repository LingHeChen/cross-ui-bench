import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';

import 'protocol.dart';
import 'storage.dart';
import 'pixel.dart';

const lime = Color(0xffc0ef81);
const cases = [
  'translate',
  'scale-rotate',
  'opacity',
  'blur',
  'backdrop-blur',
  'nested-transform',
  'scroll-animation',
  'mixed',
];
final launchQuery = Uri.splitQueryString(
  Platform.environment['BENCH_QUERY'] ?? '',
);
final auto =
    Platform.environment['BENCH_AUTO'] == '1' ||
    const bool.fromEnvironment('BENCH_AUTO');
final output =
    Platform.environment['BENCH_OUTPUT'] ??
    const String.fromEnvironment('BENCH_OUTPUT', defaultValue: 'results/raw');
final warmup =
    int.tryParse(launchQuery['warmupMs'] ?? '') ??
    const int.fromEnvironment('BENCH_WARMUP_MS', defaultValue: 10000);
final measure =
    int.tryParse(launchQuery['measureMs'] ?? '') ??
    const int.fromEnvironment('BENCH_MEASURE_MS', defaultValue: 30000);
final cooldown =
    int.tryParse(launchQuery['cooldownMs'] ?? '') ??
    const int.fromEnvironment('BENCH_COOLDOWN_MS', defaultValue: 5000);
final repetitions =
    int.tryParse(launchQuery['runs'] ?? '') ??
    const int.fromEnvironment('BENCH_RUNS', defaultValue: 5);
const engineVersion = String.fromEnvironment(
  'BENCH_ENGINE_VERSION',
  defaultValue: 'unknown',
);
const frameworkVersion = String.fromEnvironment(
  'BENCH_FRAMEWORK_VERSION',
  defaultValue: 'unknown',
);
final hardwareProfile =
    const String.fromEnvironment('BENCH_HARDWARE_BASE64').isEmpty
    ? <String, dynamic>{}
    : jsonDecode(
        utf8.decode(
          base64Decode(const String.fromEnvironment('BENCH_HARDWARE_BASE64')),
        ),
      ) as Map<String, dynamic>;
Future<void> main() async {
  final pixelConfig = Platform.environment['BENCH_PIXEL_CONFIG'];
  if (pixelConfig != null) {
    await runPixel(jsonDecode(File(pixelConfig).readAsStringSync()));
    return;
  }
  final storageConfig = Platform.environment['BENCH_STORAGE_CONFIG'];
  if (storageConfig != null) {
    try {
      await runStorage(jsonDecode(File(storageConfig).readAsStringSync()));
      exit(0);
    } catch (e, st) {
      stderr.writeln('$e\n$st');
      exit(1);
    }
  }
  runApp(const BenchApp());
}

class BenchApp extends StatelessWidget {
  const BenchApp({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
    debugShowCheckedModeBanner: false,
    title: 'CrossUI Bench',
    theme: ThemeData(
      brightness: Brightness.dark,
      scaffoldBackgroundColor: const Color(0xff101410),
      colorScheme: ColorScheme.fromSeed(
        seedColor: lime,
        brightness: Brightness.dark,
      ),
    ),
    home: const Console(),
  );
}

class NodeSpec {
  final double x, y, delay, duration, hue;
  NodeSpec(SeededRandom random)
    : x = random.next() * .9,
      y = random.next() * .85,
      delay = random.next() * 3,
      duration = 2 + random.next() * 2,
      hue = 90 + random.next() * 65;
}

class Console extends StatefulWidget {
  const Console({super.key});
  @override
  State<Console> createState() => _ConsoleState();
}

class _ConsoleState extends State<Console>
    with SingleTickerProviderStateMixin, WidgetsBindingObserver {
  late final AnimationController clock;
  final scroll = ScrollController();
  List<NodeSpec> specs = [];
  String selected =
      launchQuery['case'] ??
      const String.fromEnvironment('BENCH_CASE', defaultValue: 'translate');
  int nodes =
          int.tryParse(launchQuery['nodes'] ?? '') ??
          const int.fromEnvironment('BENCH_NODES', defaultValue: 500),
      hz =
          int.tryParse(launchQuery['refresh'] ?? '') ??
          const int.fromEnvironment('BENCH_REFRESH_HZ', defaultValue: 60);
  bool running = false, cancelled = false, measuring = false;
  String phase = 'STANDBY',
      notice = 'Flutter semantic reference · native 3D backend deferred.';
  List<Map<String, dynamic>> frames = [], resources = [];
  int? previousVsync, firstVsync;
  int measurementStartVsync = 0;
  double? previousCpuSeconds;
  int? previousCpuWallMs;
  int sampleOriginMs = 0;
  Map<String, dynamic>? last;
  Timer? sampler;
  final stopwatch = Stopwatch();
  @override
  void initState() {
    super.initState();
    clock = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 120),
    )..addListener(_scrollTick);
    WidgetsBinding.instance.addObserver(this);
    SchedulerBinding.instance.addTimingsCallback(_timings);
    if (auto) WidgetsBinding.instance.addPostFrameCallback((_) => run());
  }

  void _scrollTick() {
    if (selected == 'scroll-animation' && scroll.hasClients) {
      scroll.jumpTo(
        (.5 + .5 * math.sin(clock.value * 120 / 3)) *
            scroll.position.maxScrollExtent,
      );
    }
  }

  void _timings(List<ui.FrameTiming> batch) {
    if (!measuring) return;
    for (final f in batch) {
      final t = f.timestampInMicroseconds(ui.FramePhase.vsyncStart);
      if (t < measurementStartVsync ||
          t > measurementStartVsync + measure * 1000) {
        continue;
      }
      firstVsync ??= measurementStartVsync;
      if (previousVsync != null && t > previousVsync!) {
        frames.add({
          'tMs': (t - firstVsync!) / 1000,
          'dtMs': (t - previousVsync!) / 1000,
          'buildMs': f.buildDuration.inMicroseconds / 1000,
          'rasterMs': f.rasterDuration.inMicroseconds / 1000,
        });
      }
      previousVsync = t;
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (running &&
        [
          AppLifecycleState.hidden,
          AppLifecycleState.paused,
          AppLifecycleState.detached,
        ].contains(state)) {
      cancelled = true;
    }
  }

  @override
  void didChangeMetrics() {
    if (running) {
      cancelled = true;
    }
  }

  Future<Map<String, dynamic>> sample() async {
    double? cpu;
    if (!Platform.isWindows) {
      try {
        final p = await Process.run('ps', ['-p', '$pid', '-o', 'time=']);
        final parts = (p.stdout as String).trim().split(':');
        double seconds = 0;
        for (final part in parts) {
          seconds = seconds * 60 + double.parse(part);
        }
        final wall = stopwatch.elapsedMilliseconds;
        if (previousCpuSeconds != null &&
            previousCpuWallMs != null &&
            wall > previousCpuWallMs!) {
          cpu = math.max(
            0,
            (seconds - previousCpuSeconds!) *
                100000 /
                (wall - previousCpuWallMs!),
          );
        }
        previousCpuSeconds = seconds;
        previousCpuWallMs = wall;
      } catch (_) {}
    }
    return {
      'tMs': stopwatch.elapsedMilliseconds - sampleOriginMs,
      'cpuPercent': cpu,
      'rssMb': ProcessInfo.currentRss / 1048576,
    };
  }

  Future<void> waitPhase(int ms) async {
    final deadline = DateTime.now().add(Duration(milliseconds: ms));
    while (DateTime.now().isBefore(deadline)) {
      if (cancelled) throw StateError('Experiment cancelled');
      await Future<void>.delayed(const Duration(milliseconds: 50));
    }
    if (cancelled) throw StateError('Experiment cancelled');
  }

  Future<void> run() async {
    if (running) return;
    if (![60, 120].contains(hz) ||
        !cases.contains(selected) ||
        ![100, 500, 1000, 5000, 10000].contains(nodes) ||
        repetitions < 1 ||
        warmup < 0 ||
        measure <= 0 ||
        cooldown < 0) {
      setState(() => notice = 'Invalid benchmark configuration');
      if (auto) exit(1);
      return;
    }
    setState(() {
      running = true;
      cancelled = false;
      notice = 'Running semantic reference. Keep this window visible.';
    });
    stopwatch.reset();
    stopwatch.start();
    final runs = <Map<String, dynamic>>[],
        started = DateTime.now().toUtc().toIso8601String();
    final view = View.of(context), display = view.display;
    final actualHz = display.refreshRate;
    final reasons = <String>[];
    if (!kReleaseMode) reasons.add('Non-release build');
    if (warmup < 10000 ||
        measure < 30000 ||
        cooldown < 5000 ||
        repetitions < 5) {
      reasons.add('Shortened protocol; diagnostic only');
    }
    if ((actualHz - hz).abs() > .5) {
      reasons.add('Display refresh rate differs from target');
    }
    try {
      for (int index = 1; index <= repetitions; index++) {
        final random = SeededRandom(20261007);
        setState(() {
          specs = List.generate(nodes, (_) => NodeSpec(random));
          phase = 'WARMUP $index / $repetitions';
        });
        clock.repeat();
        await waitPhase(warmup);
        frames = [];
        resources = [];
        previousVsync = null;
        firstVsync = null;
        setState(() => phase = 'MEASURE $index / $repetitions');
        sampleOriginMs = stopwatch.elapsedMilliseconds;
        previousCpuSeconds = null;
        previousCpuWallMs = null;
        resources.add(await sample());
        measurementStartVsync = SchedulerBinding
            .instance
            .currentSystemFrameTimeStamp
            .inMicroseconds;
        previousVsync = measurementStartVsync;
        firstVsync = measurementStartVsync;
        measuring = true;
        bool sampling = false;
        sampler = Timer.periodic(const Duration(seconds: 1), (_) async {
          if (sampling) return;
          sampling = true;
          try {
            resources.add(await sample());
          } finally {
            sampling = false;
          }
        });
        await waitPhase(measure);
        // Flush timings reported asynchronously by the engine before ending the window.
        await Future<void>.delayed(const Duration(milliseconds: 1100));
        measuring = false;
        sampler?.cancel();
        while (sampling) {
          await Future<void>.delayed(const Duration(milliseconds: 10));
        }
        resources.add(await sample());
        frames = frames.where((f) => (f['tMs'] as num) <= measure).toList();
        clock.stop();
        if (frames.isEmpty) {
          throw StateError('No engine frame timings recorded');
        }
        final cpus = resources
            .map((r) => r['cpuPercent'])
            .whereType<double>()
            .toList();
        final metrics = {
          ...summarizeFrames(frames, hz),
          'cpuAverage': cpus.isEmpty
              ? null
              : cpus.reduce((s, n) => s + n) / cpus.length,
          'cpuPeak': cpus.isEmpty ? null : cpus.reduce(math.max),
          'peakMemoryMb': resources
              .map((r) => (r['rssMb'] as num).toDouble())
              .reduce(math.max),
          'gpuAverage': null,
          'gpuMemoryMb': null,
          'privateMemoryMb': null,
        };
        runs.add({
          'index': index,
          'frames': [...frames],
          'resources': [...resources],
          'metrics': metrics,
        });
        setState(() => phase = 'COOLDOWN $index / $repetitions');
        await waitPhase(cooldown);
      }
      final summary = <String, dynamic>{};
      for (final key in (runs.first['metrics'] as Map<String, dynamic>).keys) {
        summary[key] = summarizeRuns(
          runs
              .map((r) => r['metrics'][key])
              .whereType<num>()
              .map((n) => n.toDouble())
              .toList(),
        );
      }
      final random = math.Random.secure();
      final b = List.generate(16, (_) => random.nextInt(256));
      b[6] = (b[6] & 15) | 64;
      b[8] = (b[8] & 63) | 128;
      final hex = b.map((v) => v.toRadixString(16).padLeft(2, '0')).join();
      final id =
          '${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
      final result = {
        'schemaVersion': '1.0.0',
        'coldStartupMs': null,
        'id': id,
        'benchmark': 'css-animation',
        'case': selected,
        'runtime': 'flutter-native',
        'implementation': 'flutter/AnimatedBuilder',
        'comparisonClass': 'framework-best-practice',
        'parameters': {'nodes': nodes, 'caseName': selected},
        'asset': null,
        'assetSha256': null,
        'metadata': {
          'benchmark_source_sha256': const String.fromEnvironment(
            'BENCH_SOURCE_SHA256',
            defaultValue: 'unknown',
          ),
          'os': Platform.operatingSystem,
          'os_version': Platform.operatingSystemVersion,
          'cpu': hardwareProfile['cpu'],
          'cpu_arch': hardwareProfile['cpu_arch'],
          'cpu_cores': Platform.numberOfProcessors,
          'ram': hardwareProfile['ram'],
          'gpu': hardwareProfile['gpu'],
          'gpu_driver': null,
          'display_resolution':
              '${display.size.width.toInt()}x${display.size.height.toInt()}',
          'display_scale': view.devicePixelRatio,
          'workload_width': 640,
          'workload_height': 360,
          'viewport_width': view.physicalSize.width / view.devicePixelRatio,
          'viewport_height': view.physicalSize.height / view.devicePixelRatio,
          'refresh_rate': actualHz,
          'runtime': 'flutter-native',
          'runtime_version': engineVersion,
          'render_backend': Platform.isMacOS
              ? 'Impeller/Metal (Flutter SDK default)'
              : 'Flutter SDK platform default; verify backend before comparison',
          'webview_version': null,
          'framework': 'flutter',
          'framework_version': frameworkVersion,
          'build_mode': kReleaseMode ? 'release' : 'debug',
          'locale': Platform.localeName,
          'resource_scope': 'Flutter application process RSS; ps CPU time deltas over wall time; percent is one-core normalized',
        },
        'protocol': {
          'warmupMs': warmup,
          'measureMs': measure,
          'cooldownMs': cooldown,
          'runs': repetitions,
          'refreshRateHz': hz,
          'seed': 20261007,
        },
        'qualification': {'eligible': reasons.isEmpty, 'reasons': reasons},
        'startedAt': started,
        'completedAt': DateTime.now().toUtc().toIso8601String(),
        'runs': runs,
        'summary': summary,
        'limitations': [
          'Flutter is a semantic UI reference; not a Chromium/WebKit compatibility test.',
          'Frames use engine vsync timestamps; Web groups use requestAnimationFrame.',
          'CPU uses ps CPU-time deltas; process scope differs from Electron process-tree metrics.',
          'GPU metrics unavailable; null is not zero.',
          'Native 3D FFI/wgpu backend is not implemented in this baseline.',
        ],
      };
      await Directory(output).create(recursive: true);
      final file = File('$output/$id.json');
      await file.writeAsString(
        const JsonEncoder.withIndent('  ').convert(result),
      );
      setState(() {
        last = result;
        phase = 'COMPLETE';
        notice =
            'Raw JSON saved: ${file.path}${reasons.isNotEmpty ? ' · DIAGNOSTIC' : ''}';
      });
      debugPrint('RESULT ${file.path}');
      if (auto) exit(0);
    } catch (e) {
      stderr.writeln('BENCH_ERROR $e');
      setState(() {
        phase = 'CANCELLED / FAILED';
        notice = e.toString();
      });
      if (auto) exit(1);
    } finally {
      measuring = false;
      sampler?.cancel();
      clock.stop();
      stopwatch.stop();
      if (mounted) setState(() => running = false);
    }
  }

  Widget animatedNode(int i) {
    final s = specs[i],
        p = ((clock.value * 120 + s.delay) / s.duration) % 1,
        wave = p < .5 ? p * 2 : (1 - p) * 2;
    Widget child = Container(
      width: selected == 'mixed'
          ? 112
          : selected == 'backdrop-blur'
          ? 60
          : 12,
      height: selected == 'mixed'
          ? 65
          : selected == 'backdrop-blur'
          ? 40
          : 12,
      decoration: BoxDecoration(
        color: HSLColor.fromAHSL(
          selected == 'backdrop-blur' ? 0.12 : 0.8,
          s.hue,
          .6,
          .6,
        ).toColor(),
        borderRadius: selected == 'mixed' ? BorderRadius.circular(5) : null,
      ),
      child: selected == 'mixed'
          ? Padding(
              padding: const EdgeInsets.all(8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Task ${i + 1}',
                    style: const TextStyle(
                      fontSize: 8,
                      color: Color(0xff132010),
                    ),
                  ),
                  const Text(
                    'render / active',
                    style: TextStyle(fontSize: 7, color: Color(0xff132010)),
                  ),
                  const SizedBox(height: 6),
                  Container(
                    height: 3,
                    width: 65,
                    color: const Color(0xff334a22),
                  ),
                ],
              ),
            )
          : null,
    );
    switch (selected) {
      case 'translate':
        child = Transform.translate(
          offset: Offset(60 * wave, -40 * wave),
          child: child,
        );
      case 'scale-rotate':
        child = Transform.translate(
          offset: Offset(35 * wave, -25 * wave),
          child: Transform.rotate(
            angle: math.pi * wave,
            child: Transform.scale(scale: 1 + .5 * wave, child: child),
          ),
        );
      case 'opacity':
        child = Opacity(opacity: .1 + .9 * wave, child: child);
      case 'blur':
        child = ImageFiltered(
          imageFilter: ui.ImageFilter.blur(sigmaX: 8 * wave, sigmaY: 8 * wave),
          child: child,
        );
      case 'backdrop-blur':
        child = ClipRect(
          child: BackdropFilter(
            filter: ui.ImageFilter.blur(sigmaX: 12 * wave, sigmaY: 12 * wave),
            child: child,
          ),
        );
      case 'nested-transform':
        for (int d = 0; d < 7; d++) {
          child = Transform.rotate(
            angle: math.pi / 12,
            child: Transform.translate(
              offset: const Offset(1, 0),
              child: child,
            ),
          );
        }
        child = Transform.rotate(angle: p * 2 * math.pi, child: child);
      case 'scroll-animation':
        child = Transform.translate(
          offset: Offset(25 * wave, 0),
          child: Opacity(
            opacity: .3 + .7 * wave,
            child: SizedBox(
              height: 28,
              width: 800,
              child: ColoredBox(
                color: HSLColor.fromAHSL(1, s.hue, .6, .6).toColor(),
                child: Text(
                  'Frame pipeline · ${i + 1}',
                  style: const TextStyle(
                    fontSize: 10,
                    color: Color(0xff182410),
                  ),
                ),
              ),
            ),
          ),
        );
      case 'mixed':
        child = Transform.translate(
          offset: Offset(20 * wave, -15 * wave),
          child: Opacity(
            opacity: .6 + .4 * wave,
            child: Transform.scale(scale: 1 + .05 * wave, child: child),
          ),
        );
    }
    return child;
  }

  Widget workload() => AnimatedBuilder(
    animation: clock,
    builder: (context, _) => LayoutBuilder(
      builder: (context, size) {
        if (selected == 'scroll-animation') {
          return SingleChildScrollView(
            controller: scroll,
            child: Column(
              children: List.generate(
                specs.length,
                (i) => Padding(
                  padding: const EdgeInsets.symmetric(vertical: 3),
                  child: animatedNode(i),
                ),
              ),
            ),
          );
        }
        return Stack(
          clipBehavior: Clip.hardEdge,
          children: [
            ...List.generate(
              specs.length,
              (i) => Positioned(
                left: specs[i].x * size.maxWidth,
                top: specs[i].y * size.maxHeight,
                child: animatedNode(i),
              ),
            ),
            if (selected == 'mixed')
              Positioned(
                left: 70,
                right: 70,
                top: 40,
                bottom: 40,
                child: IgnorePointer(
                  child: Stack(
                    children: [
                      Container(
                        width: 95,
                        color: const Color(0xdd111e12),
                        padding: const EdgeInsets.all(12),
                        child: const Text(
                          'Workspace\n\nOverview\nMessages\nFiles',
                          style: TextStyle(fontSize: 10),
                        ),
                      ),
                      Positioned(
                        left: 100,
                        right: 0,
                        child: Container(
                          color: const Color(0x99263d24),
                          padding: const EdgeInsets.all(12),
                          child: const Text(
                            'Overview / Editor / Activity',
                            style: TextStyle(fontSize: 10),
                          ),
                        ),
                      ),
                      const Positioned(
                        left: 110,
                        top: 60,
                        child: Text(
                          '01 const runtime = await bench();\n02 render(scene);\n03 collect(metrics);',
                          style: TextStyle(fontSize: 10),
                        ),
                      ),
                      Positioned(
                        right: 15,
                        top: 100,
                        child: ClipRect(
                          child: BackdropFilter(
                            filter: ui.ImageFilter.blur(sigmaX: 8, sigmaY: 8),
                            child: Container(
                              width: 145,
                              height: 90,
                              color: const Color(0x40588b3a),
                              alignment: Alignment.center,
                              child: const Text(
                                'Rendering preview',
                                style: TextStyle(fontSize: 10),
                              ),
                            ),
                          ),
                        ),
                      ),
                      const Positioned(
                        bottom: 20,
                        left: 140,
                        child: Text(
                          '+    ↗    ⚙',
                          style: TextStyle(fontSize: 16),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
          ],
        );
      },
    ),
  );
  @override
  Widget build(BuildContext context) {
    final summary = last?['summary'] as Map<String, dynamic>?;
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(28),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Row(
                children: [
                  Icon(Icons.grid_view, color: lime),
                  SizedBox(width: 12),
                  Text('CrossUI Bench', style: TextStyle(fontSize: 24)),
                  Spacer(),
                  Text(
                    'FLUTTER / SEMANTIC REFERENCE',
                    style: TextStyle(fontSize: 10, color: lime),
                  ),
                ],
              ),
              const SizedBox(height: 24),
              const Text(
                'Motion under pressure.',
                style: TextStyle(fontSize: 34),
              ),
              const SizedBox(height: 8),
              const Text(
                'Same visual workload. Flutter rendering. Independent implementation.',
                style: TextStyle(color: Colors.grey, fontSize: 12),
              ),
              const SizedBox(height: 24),
              Expanded(
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Expanded(
                      child: Container(
                        decoration: BoxDecoration(
                          border: Border.all(color: const Color(0xff394332)),
                          color: const Color(0xff111910),
                        ),
                        child: Column(
                          children: [
                            Padding(
                              padding: const EdgeInsets.all(14),
                              child: Row(
                                children: [
                                  const Text(
                                    'LIVE WORKLOAD',
                                    style: TextStyle(fontSize: 11),
                                  ),
                                  const Spacer(),
                                  Text(
                                    phase,
                                    style: const TextStyle(
                                      fontSize: 10,
                                      color: lime,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            Expanded(
                              child: specs.isEmpty
                                  ? const Center(
                                      child: Text(
                                        'Configure the workload and start an experiment.',
                                        style: TextStyle(color: Colors.grey),
                                      ),
                                    )
                                  : Center(
                                      child: SizedBox(
                                        width: 640,
                                        height: 360,
                                        child: workload(),
                                      ),
                                    ),
                            ),
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(width: 24),
                    SizedBox(
                      width: 235,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          const Text(
                            'Experiment setup',
                            style: TextStyle(fontSize: 17),
                          ),
                          const SizedBox(height: 16),
                          DropdownButtonFormField<String>(
                            initialValue: selected,
                            items: cases
                                .map(
                                  (s) => DropdownMenuItem(
                                    value: s,
                                    child: Text(
                                      s,
                                      style: const TextStyle(fontSize: 12),
                                    ),
                                  ),
                                )
                                .toList(),
                            onChanged: running
                                ? null
                                : (v) => setState(() => selected = v!),
                          ),
                          const SizedBox(height: 16),
                          DropdownButtonFormField<int>(
                            initialValue: nodes,
                            items: [100, 500, 1000, 5000, 10000]
                                .map(
                                  (n) => DropdownMenuItem(
                                    value: n,
                                    child: Text('$n nodes'),
                                  ),
                                )
                                .toList(),
                            onChanged: running
                                ? null
                                : (v) => setState(() => nodes = v!),
                          ),
                          const SizedBox(height: 16),
                          DropdownButtonFormField<int>(
                            initialValue: hz,
                            items: [60, 120]
                                .map(
                                  (n) => DropdownMenuItem(
                                    value: n,
                                    child: Text('$n Hz target'),
                                  ),
                                )
                                .toList(),
                            onChanged: running
                                ? null
                                : (v) => setState(() => hz = v!),
                          ),
                          const SizedBox(height: 24),
                          Text(
                            '${warmup / 1000}s warm-up\n${measure / 1000}s measurement\n${cooldown / 1000}s cool-down\n$repetitions repetitions',
                            style: const TextStyle(
                              fontSize: 12,
                              height: 2,
                              color: Colors.grey,
                            ),
                          ),
                          const SizedBox(height: 24),
                          FilledButton(
                            style: FilledButton.styleFrom(
                              backgroundColor: lime,
                              foregroundColor: const Color(0xff233517),
                            ),
                            onPressed: running ? null : run,
                            child: const Text('Start experiment ↗'),
                          ),
                          if (running)
                            TextButton(
                              onPressed: () => cancelled = true,
                              child: const Text('Cancel'),
                            ),
                          const SizedBox(height: 14),
                          const Text(
                            'Native 3D: backend not implemented. No fabricated Flutter 3D score.',
                            style: TextStyle(fontSize: 11, color: Colors.grey),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 18),
              Row(
                children:
                    ['fpsAverage', 'frameP95Ms', 'frameP99Ms', 'peakMemoryMb']
                        .map(
                          (key) => Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  key,
                                  style: const TextStyle(
                                    fontSize: 10,
                                    color: Colors.grey,
                                  ),
                                ),
                                Text(
                                  summary?[key]?['median'] is num
                                      ? (summary![key]['median'] as num)
                                            .toStringAsFixed(1)
                                      : '—',
                                  style: const TextStyle(
                                    fontSize: 28,
                                    color: lime,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        )
                        .toList(),
              ),
              const SizedBox(height: 14),
              Text(
                notice,
                style: const TextStyle(fontSize: 11, color: Colors.grey),
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  void dispose() {
    sampler?.cancel();
    SchedulerBinding.instance.removeTimingsCallback(_timings);
    WidgetsBinding.instance.removeObserver(this);
    clock.dispose();
    scroll.dispose();
    super.dispose();
  }
}
