import os from "node:os";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
export function hardware() {
  let gpu = null,
    display_resolution = null,
    display_scale = null;
  if (process.platform === "darwin") {
    try {
      const data = JSON.parse(
        execFileSync("system_profiler", ["SPDisplaysDataType", "-json"], {
          encoding: "utf8",
          timeout: 15000,
        }),
      );
      const card = data.SPDisplaysDataType?.[0];
      gpu = card?.sppci_model ?? null;
      const d = card?.spdisplays_ndrvs?.[0];
      display_resolution = d?._spdisplays_resolution ?? null;
    } catch {}
  }
  return {
    os: os.platform(),
    os_version: os.release(),
    cpu: os.cpus()[0]?.model ?? null,
    cpu_arch: os.arch(),
    cpu_cores: os.cpus().length,
    ram: os.totalmem(),
    gpu,
    gpu_driver: null,
    display_resolution,
    display_scale,
    refresh_rate: null,
    runtime: "node",
    runtime_version: process.versions.node,
    webview_version: null,
    framework: null,
    framework_version: null,
    build_mode: "unknown",
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  console.log(JSON.stringify(hardware(), null, 2));
