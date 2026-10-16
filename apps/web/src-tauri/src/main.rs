#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::sync::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, State, WebviewWindow};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Snapshot { name: String, model_path: Option<String>, expression_map: Option<serde_json::Value>, emotion: String, mouth_open: f64, voice_state: String, connected: bool, busy: bool, animation: Option<serde_json::Value>, motion: Option<serde_json::Value> }
#[derive(Clone, Default, Serialize)]
struct Envelope { revision: u64, snapshot: Snapshot }
#[derive(Default)]
struct Desktop { snapshot: Mutex<Envelope>, click_through: Mutex<bool>, warnings: Mutex<Vec<String>> }
fn known(window: &WebviewWindow) -> Result<(), String> {
 if ["chat", "companion"].contains(&window.label()) { Ok(()) } else { Err("Unknown window".into()) }
}
fn action(app: &tauri::AppHandle, name: &str) -> Result<(), String> {
 let w = app.get_webview_window("companion").ok_or("Missing companion")?;
 let result = match name {
  "show" | "interactive" => { w.set_ignore_cursor_events(false).map_err(|e| e.to_string())?; *app.state::<Desktop>().click_through.lock().unwrap() = false; w.show() },
  "hide" => w.hide(),
  "click-through" => { w.set_ignore_cursor_events(true).map_err(|e|e.to_string())?; *app.state::<Desktop>().click_through.lock().unwrap() = true; Ok(()) },
  "chat" => { let c = app.get_webview_window("chat").ok_or("Missing chat")?; c.show().map_err(|e|e.to_string())?; c.unminimize().map_err(|e|e.to_string())?; c.set_focus() },
  "reset" => { w.center().map_err(|e|e.to_string())?; return action(app, "show"); },
  _ => return Err("Unknown action".into()),
 };
 result.map_err(|e|e.to_string())
}
#[tauri::command]
fn desktop_action(window: WebviewWindow, action: String) -> Result<(), String> { known(&window)?; crate::action(window.app_handle(), &action) }
#[tauri::command]
fn publish_snapshot(window: WebviewWindow, state: State<Desktop>, snapshot: Snapshot) -> Result<(), String> {
 if window.label() != "chat" { return Err("Only chat can publish".into()); }
 let mut envelope = state.snapshot.lock().map_err(|e|e.to_string())?;
 envelope.revision += 1;
 envelope.snapshot = snapshot;
 window.app_handle().emit_to("companion", "desktop:snapshot", envelope.clone()).map_err(|e|e.to_string())
}
#[tauri::command]
fn get_snapshot(window: WebviewWindow, state: State<Desktop>) -> Result<Envelope, String> { known(&window)?; Ok(state.snapshot.lock().map_err(|e|e.to_string())?.clone()) }
#[tauri::command]
fn desktop_status(window: WebviewWindow, state: State<Desktop>) -> Result<serde_json::Value, String> {
 known(&window)?;
 Ok(serde_json::json!({"autostart": window.app_handle().autolaunch().is_enabled().map_err(|e|e.to_string())?, "clickThrough": *state.click_through.lock().unwrap(), "warnings": *state.warnings.lock().unwrap()}))
}
#[tauri::command]
fn set_autostart(window: WebviewWindow, enabled: bool) -> Result<(), String> {
 if window.label() != "chat" { return Err("Use chat settings".into()); }
 let manager = window.app_handle().autolaunch();
 if enabled { manager.enable() } else { manager.disable() }.map_err(|e|e.to_string())
}
fn main() {
 let show = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyY);
 let chat = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyM);
 let hide = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyH);
 tauri::Builder::default()
 .manage(Desktop::default())
 .plugin(tauri_plugin_single_instance::init(|app, _, _| { let _ = action(app, "show"); let _ = action(app, "chat"); }))
 .plugin(tauri_plugin_window_state::Builder::default().with_state_flags(StateFlags::POSITION | StateFlags::SIZE).build())
 .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
 .plugin(tauri_plugin_global_shortcut::Builder::new().with_handler(move |app, shortcut, event| {
   if event.state() == ShortcutState::Pressed {
    let name = if shortcut == &show { "show" } else if shortcut == &chat { "chat" } else if shortcut == &hide { "hide" } else { return; };
    let _ = action(app, name);
   }
 }).build())
 .invoke_handler(tauri::generate_handler![desktop_action, publish_snapshot, get_snapshot, desktop_status, set_autostart])
 .setup(move |app| {
   let items = [("show", "Show companion · Ctrl+Alt+Y"), ("hide", "Hide companion · Ctrl+Alt+H"), ("chat", "Open chat · Ctrl+Alt+M"), ("interactive", "Interactive"), ("click-through", "Click-through"), ("reset", "Reset companion position"), ("quit", "Quit")];
   let menu = Menu::new(app)?;
   for (id, title) in items { menu.append(&MenuItem::with_id(app, id, title, true, None::<&str>)?)?; }
   TrayIconBuilder::new().icon(app.default_window_icon().expect("bundled icon").clone()).tooltip("Komorebi").menu(&menu)
    .on_menu_event(|app, event| { if event.id.as_ref() == "quit" { let _ = app.save_window_state(StateFlags::POSITION | StateFlags::SIZE); app.exit(0); } else { let _ = action(app, event.id.as_ref()); } }).build(app)?;
   for shortcut in [show, chat, hide] {
    if let Err(error) = app.global_shortcut().register(shortcut) { app.state::<Desktop>().warnings.lock().unwrap().push(format!("Shortcut unavailable: {error}")); }
   }
   // A saved position may be on a disconnected monitor. Keep at least part of the window reachable.
   for label in ["companion", "chat"] {
    if let Some(w) = app.get_webview_window(label) {
     if let (Ok(p), Ok(s), Ok(monitors)) = (w.outer_position(), w.outer_size(), w.available_monitors()) {
      let visible = monitors.iter().any(|m| { let q=m.position(); let z=m.size(); (p.x as i64) < q.x as i64 + z.width as i64 && p.x as i64 + s.width as i64 > q.x as i64 && (p.y as i64) < q.y as i64 + z.height as i64 && p.y as i64 + s.height as i64 > q.y as i64 });
      if !visible { let _ = w.center(); }
     }
    }
   }
   Ok(())
 })
 .on_window_event(|window, event| {
  if let tauri::WindowEvent::CloseRequested { api, .. } = event {
   api.prevent_close();
   if window.label() == "chat" { let _ = window.emit("desktop:stop", ()); }
   let _ = window.app_handle().save_window_state(StateFlags::POSITION | StateFlags::SIZE);
   let _ = window.hide();
  }
 })
 .run(tauri::generate_context!()).expect("Failed to run Komorebi");
}
