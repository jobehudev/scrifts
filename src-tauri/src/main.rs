#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{Manager, RunEvent, Url};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

const PORT: u16 = 8765;

struct BackendProcess(Mutex<Option<Child>>);

fn port_available(port: u16) -> bool {
    TcpListener::bind(("127.0.0.1", port)).is_ok()
}

/// Is the thing on this port a Scrifts backend (one left behind when the app last went down without closing it)?
fn is_scrifts_backend(port: u16) -> bool {
    let Ok(mut s) = TcpStream::connect(("127.0.0.1", port)) else { return false };
    let _ = s.set_read_timeout(Some(Duration::from_secs(20))); // the first ping starts FontForge
    if s.write_all(format!("GET /api/ping HTTP/1.0\r\nHost: 127.0.0.1:{port}\r\n\r\n").as_bytes()).is_err() {
        return false;
    }
    let mut body = String::new();
    let _ = s.read_to_string(&mut body);
    body.contains("\"fontforge\"")
}

fn find_repo_root(exe_dir: &Path) -> Option<PathBuf> {
    let mut cur = Some(exe_dir);
    while let Some(dir) = cur {
        if dir.join("backend").join("server.py").is_file() {
            return Some(dir.to_path_buf());
        }
        cur = dir.parent();
    }
    let cwd = std::env::current_dir().ok()?;
    let mut cur = Some(cwd.as_path());
    while let Some(dir) = cur {
        if dir.join("backend").join("server.py").is_file() {
            return Some(dir.to_path_buf());
        }
        cur = dir.parent();
    }
    None
}

fn spawn_backend(port: u16) -> Result<Child, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe_dir = exe.parent().ok_or("cannot determine executable directory")?;

    // 1. Packaged sidecar next to the app exe (or in forge-backend/ subfolder)
    for candidate in [
        exe_dir.join("forge-backend.exe"),
        exe_dir.join("forge-backend").join("forge-backend.exe"),
    ] {
        if candidate.is_file() {
            let mut cmd = Command::new(&candidate);
            cmd.env("FORGE_PORT", port.to_string())
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null());
            #[cfg(target_os = "windows")]
            cmd.creation_flags(CREATE_NO_WINDOW);
            return cmd.spawn().map_err(|e| format!("Failed to start forge-backend.exe: {e}"));
        }
    }

    // 2. Repo / development mode (.venv\Scripts\python.exe backend\server.py)
    let root = find_repo_root(exe_dir)
        .ok_or("Could not locate backend/server.py or forge-backend.exe.")?;
    let venv_py = root.join(".venv").join("Scripts").join("python.exe");
    let py = if venv_py.is_file() {
        venv_py
    } else {
        PathBuf::from("python")
    };
    let mut cmd = Command::new(py);
    cmd.arg(root.join("backend").join("server.py"))
        .current_dir(&root)
        .env("FORGE_PORT", port.to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd.spawn().map_err(|e| format!("Failed to start Python backend: {e}"))
}

fn wait_for_server(port: u16, timeout: Duration, backend: &BackendProcess) -> bool {
    let addr = format!("127.0.0.1:{port}").parse().unwrap();
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if TcpStream::connect_timeout(&addr, Duration::from_millis(50)).is_ok() {
            return true;
        }
        // it stopped before it ever listened: no point in waiting out the minute
        if let Ok(mut guard) = backend.0.lock() {
            if let Some(child) = guard.as_mut() {
                if matches!(child.try_wait(), Ok(Some(_))) {
                    return false;
                }
            }
        }
        std::thread::sleep(Duration::from_millis(30));
    }
    false
}

fn show_error(w: &tauri::WebviewWindow, msg: &str) {
    if let Ok(js_str) = serde_json::to_string(msg) {
        let _ = w.eval(&format!(
            "if (window.__showError) window.__showError({js_str}); else document.body.innerText = {js_str};"
        ));
    }
}

fn kill_backend(state: &BackendProcess) {
    if let Ok(mut guard) = state.0.lock() {
        if let Some(mut child) = guard.take() {
            #[cfg(target_os = "windows")]
            {
                let mut kill = Command::new("taskkill");
                kill.args(["/F", "/T", "/PID", &child.id().to_string()])
                    .stdin(Stdio::null())
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .creation_flags(CREATE_NO_WINDOW);
                let _ = kill.status();
            }
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

fn main() {
    // a backend left over from a run that did not close it: use it instead of refusing to start
    let startup: Result<Option<Child>, String> = if !port_available(PORT) && is_scrifts_backend(PORT) {
        Ok(None)
    } else if !port_available(PORT) {
        Err(format!(
            "Port {PORT} is already in use by another process. Close the other instance or process using port {PORT} and restart Scrifts."
        ))
    } else {
        spawn_backend(PORT).map(Some)
    };

    let (child, startup_err) = match startup {
        Ok(c) => (c, None),
        Err(e) => (None, Some(e)),
    };

    tauri::Builder::default()
        // only for its show_snap_overlay command: hovering our maximize button opens Windows' Snap Layouts
        .plugin(tauri_plugin_decorum::init())
        .manage(BackendProcess(Mutex::new(child)))
        .setup(move |app| {
            if let Some(w) = app.get_webview_window("main") {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    if let Some(err) = startup_err {
                        // Small delay so initial splash DOM is ready to receive eval
                        std::thread::sleep(Duration::from_millis(80));
                        show_error(&w, &err);
                        return;
                    }
                    // a cold start (antivirus reading the bundle for the first time) can take well over 15 seconds
                    if wait_for_server(PORT, Duration::from_secs(60), &handle.state::<BackendProcess>()) {
                        if let Ok(url) = Url::parse(&format!("http://127.0.0.1:{PORT}")) {
                            let _ = w.navigate(url);
                        }
                    } else {
                        show_error(
                            &w,
                            &format!("Scrifts backend did not respond on 127.0.0.1:{PORT} within a minute (see %LOCALAPPDATA%\\Scrifts\\backend.log)."),
                        );
                    }
                });
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Scrifts desktop application")
        .run(|app_handle, event| {
            if let RunEvent::Exit = event {
                let state = app_handle.state::<BackendProcess>();
                kill_backend(&state);
            }
        });
}
