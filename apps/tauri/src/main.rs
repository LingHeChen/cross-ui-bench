#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use serde_json::{json, Value};
use std::{sync::Mutex, time::Instant};
use sysinfo::{Pid, ProcessesToUpdate, System};
use tauri::Manager;
struct Collector {
    system: Mutex<System>,
    start: Instant,
}
#[tauri::command]
fn metadata() -> Value {
    let fixed_refresh = std::env::var("BENCH_FIXED_REFRESH_HZ")
        .ok()
        .and_then(|s| s.parse::<f64>().ok())
        .filter(|v| *v == 60.0 || *v == 120.0);
    let sys = System::new_all();
    json!({"os":std::env::consts::OS,"os_version":System::os_version(),"cpu":sys.cpus().first().map(|c|c.brand()),"cpu_arch":std::env::consts::ARCH,"cpu_cores":sys.cpus().len(),"ram":sys.total_memory(),"gpu":null,"gpu_driver":null,"display_resolution":null,"display_scale":null,"refresh_rate":fixed_refresh,"refresh_rate_source":if fixed_refresh.is_some(){"operator-confirmed fixed display setting"}else{"unavailable"},"runtime":if cfg!(target_os="macos"){"tauri-wkwebview"}else if cfg!(target_os="windows"){"tauri-webview2"}else{"tauri-webkitgtk"},"runtime_version":tauri::VERSION,"webview_version":null,"framework":"tauri","framework_version":tauri::VERSION,"build_mode":if cfg!(debug_assertions){"debug"}else{"release"},"resource_scope":"Tauri host plus discoverable child processes; OS WebView helper coverage may be incomplete; CPU percent is one-core normalized"})
}
#[tauri::command]
fn sample(state: tauri::State<Collector>) -> Value {
    let mut sys = state.system.lock().unwrap();
    sys.refresh_processes(ProcessesToUpdate::All, true);
    let root = Pid::from_u32(std::process::id());
    let mut ids = vec![root];
    loop {
        let children: Vec<Pid> = sys
            .processes()
            .iter()
            .filter(|(id, p)| {
                !ids.contains(id) && p.parent().is_some_and(|parent| ids.contains(&parent))
            })
            .map(|(id, _)| *id)
            .collect();
        if children.is_empty() {
            break;
        }
        ids.extend(children);
    }
    let (mut cpu, mut rss) = (0.0, 0_u64);
    for id in &ids {
        if let Some(p) = sys.process(*id) {
            cpu += p.cpu_usage();
            rss += p.memory();
        }
    }
    json!({"tMs":state.start.elapsed().as_secs_f64()*1000.0,"cpuPercent":cpu,"rssMb":rss as f64/1048576.0,"processCount":ids.len()})
}
#[tauri::command]
fn save(result: Value, app: tauri::AppHandle) -> Result<String, String> {
    let id = result["id"].as_str().ok_or("Missing result id")?;
    if id.len() != 36 || !id.chars().all(|c| c.is_ascii_hexdigit() || c == '-') {
        return Err("Invalid id".into());
    }
    if result["schemaVersion"] != "1.0.0" || !result["runs"].is_array() {
        return Err("Invalid result".into());
    }
    let root = std::env::var("BENCH_OUTPUT")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| {
            std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../results/raw")
        });
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let path = root.join(format!("{id}.json"));
    std::fs::write(
        &path,
        serde_json::to_vec_pretty(&result).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    println!("RESULT {}", path.display());
    if std::env::var("BENCH_AUTO").is_ok() {
        app.exit(0);
    }
    Ok(path.to_string_lossy().into_owned())
}
#[tauri::command]
fn configure_viewport(width: f64, height: f64, window: tauri::WebviewWindow) -> Result<(), String> {
    if width <= 0.0 || height <= 0.0 {
        return Err("Invalid viewport".into());
    }
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let size = window
        .inner_size()
        .map_err(|e| e.to_string())?
        .to_logical::<f64>(scale);
    window
        .set_size(tauri::LogicalSize::new(
            size.width + 1280.0 - width,
            size.height + 800.0 - height,
        ))
        .map_err(|e| e.to_string())
}
#[tauri::command]
fn failure(message: String, app: tauri::AppHandle) {
    eprintln!("BENCH_ERROR {message}");
    if std::env::var("BENCH_AUTO").is_ok() {
        app.exit(1);
    }
}
#[tauri::command]
fn pixel_ready(metadata: Value) -> Result<(), String> {
    if let Ok(output) = std::env::var("BENCH_PIXEL_OUTPUT") {
        std::fs::write(
            format!("{output}.json"),
            serde_json::to_vec_pretty(&metadata).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        println!("PIXEL_READY {output}");
    }
    Ok(())
}
mod storage;
fn main() {
    if let Ok(config) = std::env::var("BENCH_STORAGE_CONFIG") {
        let result = std::fs::read_to_string(config)
            .map_err(|e| e.to_string())
            .and_then(|s| serde_json::from_str(&s).map_err(|e| e.to_string()))
            .and_then(|config| storage::run(config).map_err(|e| e.to_string()));
        if let Err(e) = result {
            eprintln!("STORAGE_ERROR {e}");
            std::process::exit(1);
        }
        return;
    }
    tauri::Builder::default()
        .manage(Collector {
            system: Mutex::new(System::new_all()),
            start: Instant::now(),
        })
        .setup(|app| {
            if let Ok(query) = std::env::var("BENCH_QUERY") {
                if let Some(window) = app.get_webview_window("main") {
                    let mut url = window.url()?;
                    url.set_query(Some(&query));
                    window.navigate(url)?;
                    if std::env::var("BENCH_AUTO").is_ok() {
                        window.set_always_on_top(true)?;
                        window.set_focus()?;
                    }
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            metadata,
            pixel_ready,
            sample,
            save,
            failure,
            configure_viewport
        ])
        .run(tauri::generate_context!())
        .expect("Tauri launch failed");
}
