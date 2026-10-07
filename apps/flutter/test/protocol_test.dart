import 'package:flutter_test/flutter_test.dart';
import 'package:crossui_bench/protocol.dart';

void main() {
  test('seed matches shared web LCG', () {
    final r = SeededRandom(42);
    expect(r.next(), closeTo(.2523451747838408, 1e-12));
  });
  test('frame distribution is recalculable', () {
    final s = summarizeFrames([
      {'dtMs': 10.0},
      {'dtMs': 20.0},
      {'dtMs': 30.0},
    ], 60);
    expect(s['frameP50Ms'], 20);
    expect(s['fpsAverage'], 50);
  });
  test('missing statistics remain null', () {
    expect(summarizeRuns([])['median'], isNull);
  });
}
