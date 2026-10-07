import 'dart:io';
import 'dart:convert';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter/rendering.dart';

Future<void> runPixel(Map<String, dynamic> config) async {
  WidgetsFlutterBinding.ensureInitialized();
  for (final name in ['Sans', 'Mono']) {
    final loader = FontLoader('PixelPlex$name');
    loader.addFont(
      Future.value(
        ByteData.sublistView(
          File('${config['assetRoot']}/fonts/IBMPlex$name-Regular.ttf')
              .readAsBytesSync(),
        ),
      ),
    );
    await loader.load();
  }
  final specs = jsonDecode(
    File('${config['assetRoot']}/pixel/fixtures.json').readAsStringSync(),
  ) as List<dynamic>;
  final fixture = Map<String, dynamic>.from(
    specs.firstWhere((f) => f['id'] == config['fixture']),
  );
  runApp(PixelApp(config: config, fixture: fixture));
}

Color _color(String? hex) {
  final value = (hex ?? '#193a2c').substring(1);
  final argb = value.length == 8
      ? value.substring(6) + value.substring(0, 6)
      : 'ff$value';
  return Color(int.parse(argb, radix: 16));
}

class PixelApp extends StatefulWidget {
  final Map<String, dynamic> config, fixture;
  const PixelApp({super.key, required this.config, required this.fixture});
  @override
  State<PixelApp> createState() => _PixelState();
}

class _PixelState extends State<PixelApp> {
  final boundary = GlobalKey();
  final keys = <String, GlobalKey>{};
  final texts = <String, Map<String, dynamic>>{};
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      await Future<void>.delayed(const Duration(milliseconds: 800));
      await capture();
    });
  }

  Future<void> capture() async {
    final bounds = <String, dynamic>{};
    for (final entry in keys.entries) {
      final box = entry.value.currentContext!.findRenderObject() as RenderBox;
      final p = box.localToGlobal(Offset.zero);
      Map<String, dynamic>? textBounds;
      final n = texts[entry.key];
      if (n != null) {
        final painter = TextPainter(
          text: TextSpan(text: n['text'], style: textStyle(n)),
          textDirection: TextDirection.ltr,
        )..layout(maxWidth: box.size.width);
        textBounds = {
          'x': p.dx,
          'y': p.dy,
          'width': painter.width,
          'height': painter.height,
        };
      }
      bounds[entry.key] = {
        'x': p.dx,
        'y': p.dy,
        'width': box.size.width,
        'height': box.size.height,
        'textBounds': textBounds,
      };
    }
    final render =
        boundary.currentContext!.findRenderObject() as RenderRepaintBoundary;
    final dpr = View.of(context).devicePixelRatio;
    final image = await render.toImage(pixelRatio: dpr);
    final png = await image.toByteData(format: ui.ImageByteFormat.png);
    File(widget.config['output'] + '.png')
        .writeAsBytesSync(png!.buffer.asUint8List());
    File(widget.config['output'] + '.json').writeAsStringSync(
      jsonEncode({
        'fixture': widget.fixture['id'],
        'width': 1280,
        'height': 800,
        'dpr': dpr,
        'bounds': bounds,
        'locale': 'en',
        'theme': 'light',
        'font': 'bundled IBM Plex TTF',
        'runtime': 'flutter-native',
      }),
    );
    stdout.writeln('PIXEL_RESULT ${widget.config['output']}');
    if (Platform.environment['BENCH_AUTO'] == '1') exit(0);
  }

  TextStyle textStyle(Map<String, dynamic> n) => TextStyle(
    fontFamily: n['mono'] == true ? 'PixelPlexMono' : 'PixelPlexSans',
    fontSize: (n['fontSize'] ?? 16).toDouble(),
    height: 1.25,
    fontWeight: FontWeight.w400,
    color: _color(n['textColor'] ?? (n['type'] == 'text' ? n['color'] : null)),
  );
  Widget node(dynamic raw) {
    final n = Map<String, dynamic>.from(raw);
    keys[n['id']] ??= GlobalKey();
    final type = n['type'];
    Widget child;
    if (type == 'text') {
      texts[n['id']] = n;
      child = Text(
        n['text'],
        style: textStyle(n),
        textDirection: TextDirection.ltr,
      );
    } else if (type == 'image') {
      child = Image.file(
        File('${widget.config['assetRoot']}/pixel/image.png'),
        fit: BoxFit.cover,
      );
    } else if (type == 'icon') {
      child = CustomPaint(painter: PixelIcon());
    } else if (type == 'input') {
      child = TextField(
        readOnly: true,
        style: textStyle(n),
        decoration: InputDecoration(
          hintText: n['text'],
          hintStyle: textStyle(n).copyWith(color: _color('#68756a')),
          isDense: true,
          contentPadding: const EdgeInsets.symmetric(
            horizontal: 12,
            vertical: 8,
          ),
          border: InputBorder.none,
        ),
      );
    } else if (type == 'button') {
      child = Semantics(
        button: true,
        child: Center(
          child: Text(
            n['text'],
            style: textStyle(n),
            textDirection: TextDirection.ltr,
          ),
        ),
      );
    } else {
      child = Stack(
        clipBehavior: Clip.none,
        children: (n['children'] as List<dynamic>? ?? []).map(node).toList(),
      );
    }
    final decorated = Container(
      key: keys[n['id']],
      decoration: BoxDecoration(
        color:
            type == 'gradient' ||
                type == 'text' ||
                type == 'image' ||
                type == 'icon'
            ? null
            : _color(n['color'] ?? '#ffffff00'),
        border: n['border'] != null || type == 'input'
            ? Border.all(color: _color(n['border'] ?? '#d7ddd5'))
            : null,
        borderRadius: BorderRadius.circular(
          (n['radius'] ?? (type == 'button' || type == 'input' ? 6 : 0))
              .toDouble(),
        ),
        gradient: type == 'gradient'
            ? LinearGradient(
                begin: const Alignment(-.866, -.5),
                end: const Alignment(.866, .5),
                colors: [_color('#193a2c'), _color('#c0ef81')],
              )
            : null,
        boxShadow: n['shadow'] == true
            ? [
                BoxShadow(
                  color: _color('#193a2c26'),
                  offset: const Offset(0, 10),
                  blurRadius: 24,
                ),
              ]
            : null,
      ),
      child: child,
    );
    final result = type == 'blur'
        ? ClipRRect(
            borderRadius: BorderRadius.circular((n['radius'] ?? 0).toDouble()),
            child: BackdropFilter(
              filter: ui.ImageFilter.blur(sigmaX: 8, sigmaY: 8),
              child: decorated,
            ),
          )
        : decorated;
    return Positioned(
      left: n['x'].toDouble(),
      top: n['y'].toDouble(),
      width: n['width'].toDouble(),
      height: n['height'].toDouble(),
      child: result,
    );
  }

  @override
  Widget build(BuildContext context) => MaterialApp(
    debugShowCheckedModeBanner: false,
    locale: const Locale('en'),
    theme: ThemeData(fontFamily: 'PixelPlexSans'),
    home: RepaintBoundary(
      key: boundary,
      child: Material(
        color: _color(widget.fixture['background']),
        child: Stack(
          clipBehavior: Clip.hardEdge,
          children: (widget.fixture['nodes'] as List<dynamic>)
              .map(node)
              .toList(),
        ),
      ),
    ),
  );
}

class PixelIcon extends CustomPainter {
  @override
  void paint(Canvas c, Size s) {
    final p = Paint()
      ..color = _color('#193a2c')
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2;
    for (final r in [
      const Rect.fromLTWH(4, 4, 10, 10),
      const Rect.fromLTWH(18, 4, 10, 10),
      const Rect.fromLTWH(4, 18, 10, 10),
    ]) {
      c.drawRect(r, p);
    }
    c.drawLine(const Offset(18, 18), const Offset(28, 28), p);
    c.drawLine(const Offset(28, 18), const Offset(18, 28), p);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
