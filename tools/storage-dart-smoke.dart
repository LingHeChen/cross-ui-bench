import 'dart:convert';
import 'dart:io';
import '../apps/flutter/lib/storage.dart';
Future<void> main(List<String> args) async {
 final config=jsonDecode(File(args[0]).readAsStringSync()) as Map<String,dynamic>;
 config['output']='results/storage-dart-smoke.json';await runStorage(config);
}
