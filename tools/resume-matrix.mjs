import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

// A GUI launchd job survives the terminal/Codex process that starts it.
// It is registered for this login only, not installed for automatic boot/login.
const workspace = path.resolve(import.meta.dirname, "..");
const root = path.resolve(process.argv[2] ?? "results/full-benchmark");
const label = "com.linghechen.crossui-bench.matrix";
const domain = `gui/${process.getuid()}`;
let existing;
try {
  existing = execFileSync("launchctl", ["print", `${domain}/${label}`], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
} catch {
  /* No registered job. */
}
if (existing?.includes("state = running"))
  throw Error("Matrix launchd job is already running");
if (existing) execFileSync("launchctl", ["bootout", `${domain}/${label}`]);
const processes = execFileSync("ps", ["-axo", "pid=,command="], {
  encoding: "utf8",
});
if (
  processes
    .split("\n")
    .some((line) => /\bnode\s+.*(?:\/|\s)full-matrix\.mjs(?:\s|$)/.test(line))
) {
  throw Error(
    "Another matrix process is running; refusing duplicate measurement",
  );
}
const logs = path.join(root, "logs");
fs.mkdirSync(logs, { recursive: true });
fs.mkdirSync(path.join(workspace, "artifacts"), { recursive: true });
const escape = (s) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const string = (s) => `<string>${escape(s)}</string>`;
const file = path.join(workspace, "artifacts", "resume-matrix.plist");
fs.writeFileSync(
  file,
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key>${string(label)}
<key>ProgramArguments</key><array>${["/usr/bin/caffeinate", "-di", process.execPath, path.join(workspace, "tools/full-matrix.mjs"), root].map(string).join("")}</array>
<key>WorkingDirectory</key>${string(workspace)}
<key>EnvironmentVariables</key><dict><key>PATH</key>${string(process.env.PATH)}</dict>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><false/>
<key>ProcessType</key><string>Interactive</string>
<key>StandardOutPath</key>${string(path.join(logs, "matrix-launchd.stdout.log"))}
<key>StandardErrorPath</key>${string(path.join(logs, "matrix-launchd.stderr.log"))}
</dict></plist>`,
);
execFileSync("plutil", ["-lint", file], { stdio: "inherit" });
execFileSync("launchctl", ["bootstrap", domain, file]);
console.log(`RESUMED ${domain}/${label}`);
console.log(`Logs: ${logs}/matrix-launchd.stdout.log`);
