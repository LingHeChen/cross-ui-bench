import { invoke } from "@tauri-apps/api/core";
export async function prepareViewport() {
  if (window.__TAURI_INTERNALS__) {
    await invoke("configure_viewport", {
      width: innerWidth,
      height: innerHeight,
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}
export function makeBridge() {
  if (window.benchNative)
    return {
      ...window.benchNative,
      metadata: async () => ({
        ...(await window.benchNative.metadata()),
        benchmark_source_sha256: __BENCH_SOURCE_SHA256__,
        viewport_width: innerWidth,
        viewport_height: innerHeight,
      }),
    };
  if (window.__TAURI_INTERNALS__)
    return {
      metadata: async () => {
        const m = await invoke("metadata");
        return {
          ...m,
          display_resolution: `${screen.width}x${screen.height}`,
          display_scale: devicePixelRatio,
          benchmark_source_sha256: __BENCH_SOURCE_SHA256__,
          viewport_width: innerWidth,
          viewport_height: innerHeight,
          locale: navigator.language,
          webview_user_agent: navigator.userAgent,
        };
      },
      sample: () => invoke("sample"),
      failure: (message) => invoke("failure", { message }),
      save: (result) => invoke("save", { result }),
    };
  return {
    metadata: async () => ({
      os: navigator.platform,
      os_version: null,
      cpu: null,
      cpu_arch: null,
      cpu_cores: navigator.hardwareConcurrency ?? null,
      ram: null,
      gpu: null,
      gpu_driver: null,
      display_resolution: `${screen.width}x${screen.height}`,
      display_scale: devicePixelRatio,
      refresh_rate: null,
      runtime: "browser",
      runtime_version: null,
      webview_version: navigator.userAgent,
      framework: "web",
      framework_version: null,
      build_mode: import.meta.env.PROD ? "release" : "debug",
      benchmark_source_sha256: __BENCH_SOURCE_SHA256__,
      viewport_width: innerWidth,
      viewport_height: innerHeight,
      locale: navigator.language,
      resource_scope: "not available in browser baseline",
    }),
    sample: async () => null,
    save: async (result) => {
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(result, null, 2)], {
          type: "application/json",
        }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `${result.id}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return "Downloaded raw JSON";
    },
  };
}
