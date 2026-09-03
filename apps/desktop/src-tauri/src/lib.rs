#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/** Start the desktop shell around the built, worker-capable Harness page. */
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running DSH Spatial desktop")
}
