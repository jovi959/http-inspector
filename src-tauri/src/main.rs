#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // The binary remains a thin composition root for the standalone app.
    http_inspector_lib::run();
}
