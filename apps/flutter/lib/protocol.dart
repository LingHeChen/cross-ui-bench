import 'dart:math' as math;

class SeededRandom {
  int state;
  SeededRandom(this.state);
  double next() {
    state = (state * 1664525 + 1013904223) & 0xffffffff;
    return state / 4294967296;
  }
}

double? percentile(List<double> values, double p) {
  if (values.isEmpty) return null;
  final a = [...values]..sort(), index = (a.length - 1) * p, lo = index.floor();
  return a[lo] + (a[index.ceil()] - a[lo]) * (index - lo);
}

Map<String, dynamic> summarizeFrames(
  List<Map<String, dynamic>> frames,
  int hz,
) {
  final a = frames
      .map((f) => (f['dtMs'] as num).toDouble())
      .where((v) => v > 0 && v.isFinite)
      .toList();
  if (a.isEmpty) {
    return {
      'frameCount': 0,
      'fpsAverage': null,
      'frameP50Ms': null,
      'frameP95Ms': null,
      'frameP99Ms': null,
      'worstFrameMs': null,
      'droppedFramePercent': null,
    };
  }
  final dropped = a.fold<int>(
    0,
    (s, n) => s + math.max(0, (n / (1000 / hz)).round() - 1),
  );
  return {
    'frameCount': a.length,
    'fpsAverage': 1000 * a.length / a.reduce((s, n) => s + n),
    'frameP50Ms': percentile(a, .5),
    'frameP95Ms': percentile(a, .95),
    'frameP99Ms': percentile(a, .99),
    'worstFrameMs': a.reduce(math.max),
    'droppedFramePercent': 100 * dropped / (a.length + dropped),
  };
}

Map<String, dynamic> summarizeRuns(List<double> a) {
  if (a.isEmpty) {
    return {'median': null, 'min': null, 'max': null, 'variance': null};
  }
  final mean = a.reduce((s, n) => s + n) / a.length;
  return {
    'median': percentile(a, .5),
    'min': a.reduce(math.min),
    'max': a.reduce(math.max),
    'variance':
        a.fold<double>(0, (s, n) => s + math.pow(n - mean, 2)) / a.length,
  };
}
