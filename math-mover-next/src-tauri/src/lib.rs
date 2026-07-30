mod commands;
mod db;

use db::Database;
use std::panic;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    panic::set_hook(Box::new(|panic_info| {
        eprintln!("Application panic: {:?}", panic_info);
    }));

    tauri::Builder::default()
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir().expect("Failed to get app data dir");
            let db = Database::new(app_data_dir).expect("Failed to initialize database");
            app.manage(db);

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_user,
            commands::create_user,
            commands::update_user_settings,
            commands::get_generations,
            commands::save_generation,
            commands::delete_generation,
            commands::decrement_credits,
            commands::save_image,
            commands::load_image,
            commands::delete_image,
            commands::get_image_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
