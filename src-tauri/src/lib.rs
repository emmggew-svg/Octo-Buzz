use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

mod api;

#[derive(Clone, Serialize)]
struct CursorPayload {
    x: f64,
    y: f64,
}

#[derive(Clone, Deserialize)]
struct RectArg {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

#[derive(Default)]
struct HotZones {
    gear: Option<RectArg>,
    sidebar: Option<RectArg>,
    panel: Option<RectArg>,
    interactive: bool,
}

fn in_rect(rect: &RectArg, x: f64, y: f64) -> bool {
    x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h
}

#[derive(Clone, Serialize)]
struct Insets {
    bottom: f64,
}

const REPO_URL: &str = "https://github.com/emmggew-svg/Octo-Buzz";

#[tauri::command]
fn open_repo() {
    #[cfg(windows)]
    let mut command = {
        use std::os::windows::process::CommandExt;
        let mut cmd = std::process::Command::new("explorer");
        cmd.arg(REPO_URL).creation_flags(0x0800_0000);
        cmd
    };
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut cmd = std::process::Command::new("open");
        cmd.arg(REPO_URL);
        cmd
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut cmd = std::process::Command::new("xdg-open");
        cmd.arg(REPO_URL);
        cmd
    };

    let _ = command.spawn();
}

#[derive(Clone, Serialize)]
struct Occlusion {
    under: f64,
    left: f64,
    right: f64,
}

const AVOID_SHIFT: f64 = 260.0;

/// Mean edge energy of a physical-pixel band; text and icons score high, flat desktop ~0.
fn region_score(raw: &[u8], stride: usize, x0: usize, y0: usize, x1: usize, y1: usize) -> f64 {
    let mut total = 0.0f64;
    let mut count = 0u32;

    for y in (y0..y1).step_by(2) {
        for x in (x0..x1).step_by(2) {
            let here = y * stride + x * 4;
            let right = here + 8;
            let below = here + stride * 2;
            if right + 2 >= raw.len() || below + 2 >= raw.len() {
                continue;
            }
            let luma = |i: usize| {
                raw[i] as f64 * 0.299 + raw[i + 1] as f64 * 0.587 + raw[i + 2] as f64 * 0.114
            };
            let base = luma(here);
            let edge = (luma(right) - base).abs() + (luma(below) - base).abs();
            total += edge.min(180.0);
            count += 1;
        }
    }

    if count == 0 {
        return 0.0;
    }
    total / count as f64
}

/// Detail under the panel, plus under where it would sit after dodging left or right.
fn occlusion(window: &tauri::WebviewWindow, zones: &Mutex<HotZones>) -> Option<Occlusion> {
    let panel = {
        let guard = zones.lock().ok()?;
        guard.panel.clone()?
    };

    let monitor = xcap::Monitor::all().ok()?.into_iter().next()?;
    let image = monitor.capture_image().ok()?;

    let scale = window.scale_factor().ok()?;
    let origin = window.outer_position().ok()?;
    let width = image.width() as usize;
    let height = image.height() as usize;
    let stride = width * 4;
    let raw = image.as_raw();

    let y0 = origin.y + ((panel.y + panel.h + 16.0) * scale) as i32;
    let y1 = y0 + (100.0 * scale) as i32;
    let base_x0 = origin.x + ((panel.x + 60.0) * scale) as i32;
    let base_x1 = origin.x + ((panel.x + panel.w - 60.0) * scale) as i32;
    let offset = (AVOID_SHIFT * scale) as i32;

    let score = |dx: i32| -> f64 {
        let x0 = (base_x0 + dx).max(1) as usize;
        let x1 = ((base_x1 + dx).max(2) as usize).min(width - 1);
        let y0 = y0.max(1) as usize;
        let y1 = (y1 as usize).min(height - 1);
        if x1 <= x0 + 2 || y1 <= y0 + 2 {
            return 0.0;
        }
        region_score(raw, stride, x0, y0, x1, y1)
    };

    Some(Occlusion {
        under: score(0),
        left: score(-offset),
        right: score(offset),
    })
}

#[tauri::command]
fn screen_insets(window: tauri::WebviewWindow) -> Insets {
    let monitor = window.primary_monitor().ok().flatten();
    let Some(monitor) = monitor else {
        return Insets { bottom: 0.0 };
    };

    let scale = monitor.scale_factor();
    let monitor_bottom = monitor.position().y + monitor.size().height as i32;
    let work = monitor.work_area();
    let work_bottom = work.position.y + work.size.height as i32;
    let bottom = ((monitor_bottom - work_bottom) as f64 / scale).max(0.0);

    Insets { bottom }
}

#[tauri::command]
fn set_hot_zones(
    zones: tauri::State<'_, Mutex<HotZones>>,
    gear: Option<RectArg>,
    sidebar: Option<RectArg>,
    panel: Option<RectArg>,
) {
    if let Ok(mut zones) = zones.lock() {
        zones.gear = gear;
        zones.sidebar = sidebar;
        zones.panel = panel;
    }
}

fn fit_to_top(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    if let Some(monitor) = window.primary_monitor()? {
        let scale = monitor.scale_factor();
        let size = monitor.size().to_logical::<f64>(scale);
        let position = monitor.position().to_logical::<f64>(scale);
        window.set_size(tauri::LogicalSize::new(size.width, size.height))?;
        window.set_position::<tauri::LogicalPosition<f64>>(tauri::LogicalPosition::new(
            position.x, position.y,
        ))?;
    }
    Ok(())
}

pub fn run() {
    let ctrl_q = Shortcut::new(Some(Modifiers::CONTROL), Code::KeyQ);
    let handler_shortcut = ctrl_q.clone();

    tauri::Builder::default()
        .manage(Mutex::new(HotZones::default()))
        .invoke_handler(tauri::generate_handler![
            set_hot_zones,
            screen_insets,
            open_repo,
            api::api_providers,
            api::api_save_key,
            api::api_clear_key,
            api::api_select,
            api::api_test,
            api::api_models,
            api::open_key_page
        ])
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if shortcut == &handler_shortcut {
                        if event.state() == ShortcutState::Pressed {
                            let _ = app.emit("reach-start", ());
                        } else if event.state() == ShortcutState::Released {
                            let _ = app.emit("reach-end", ());
                        }
                    }
                })
                .build(),
        )
        .setup(move |app| {
            match app.global_shortcut().register(ctrl_q) {
                Ok(_) => println!("[octo] Ctrl+Q registered"),
                Err(err) => eprintln!("[octo] Ctrl+Q registration failed: {err}"),
            }

            let window = app.get_webview_window("main").unwrap();
            fit_to_top(&window)?;
            window.set_ignore_cursor_events(true)?;
            window.set_always_on_top(true)?;

            let toggle = MenuItem::with_id(app, "toggle", "Göster / Gizle", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Çıkış", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&toggle, &quit])?;

            TrayIconBuilder::with_id("octo-tray")
                .icon(tauri::image::Image::from_bytes(include_bytes!(
                    "../icons/32x32.png"
                ))?)
                .tooltip("Octo — fareyi takip ediyor")
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => app.exit(0),
                    "toggle" => {
                        if let Some(window) = app.get_webview_window("main") {
                            if window.is_visible().unwrap_or(true) {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                            }
                        }
                    }
                    _ => {}
                })
                .build(app)?;

            let handle = app.handle().clone();
            std::thread::spawn(move || loop {
                if let Some(window) = handle.get_webview_window("main") {
                    if window.is_visible().unwrap_or(true) {
                        if let (Ok(cursor), Ok(origin), Ok(scale)) = (
                            window.cursor_position(),
                            window.outer_position(),
                            window.scale_factor(),
                        ) {
                            let x = (cursor.x - origin.x as f64) / scale;
                            let y = (cursor.y - origin.y as f64) / scale;
                            let _ = handle.emit("cursor", CursorPayload { x, y });

                            let zones = handle.state::<Mutex<HotZones>>();
                            let inside = {
                                let guard = zones.lock().unwrap();
                                guard.gear.as_ref().is_some_and(|r| in_rect(r, x, y))
                                    || guard.sidebar.as_ref().is_some_and(|r| in_rect(r, x, y))
                            };
                            let changed = {
                                let mut guard = zones.lock().unwrap();
                                if guard.interactive != inside {
                                    guard.interactive = inside;
                                    true
                                } else {
                                    false
                                }
                            };
                            if changed {
                                let _ = window.set_ignore_cursor_events(!inside);
                            }
                        }
                    }
                }
                std::thread::sleep(Duration::from_millis(16));
            });

            let occlusion_handle = app.handle().clone();
            std::thread::spawn(move || loop {
                if let Some(window) = occlusion_handle.get_webview_window("main") {
                    if window.is_visible().unwrap_or(true) {
                        let zones = occlusion_handle.state::<Mutex<HotZones>>();
                        if let Some(payload) = occlusion(&window, &zones) {
                            let _ = occlusion_handle.emit("occlusion", payload);
                        }
                    }
                }
                std::thread::sleep(Duration::from_millis(400));
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
