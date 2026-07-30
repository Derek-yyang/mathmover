use crate::db::{Database, Generation, User, UserSettings};
use serde::{Deserialize, Serialize};
use std::fs;
use tauri::{State, Manager};

#[derive(Debug, Serialize, Deserialize)]
pub struct SaveGenerationInput {
    pub user_id: String,
    pub ggb_commands: String,
    pub problem_type: String,
    pub image_path: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SaveImageOutput {
    pub path: String,
    pub id: String,
}

#[tauri::command]
pub fn get_user(db: State<Database>, user_id: String) -> Result<Option<User>, String> {
    db.get_user(&user_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_user(db: State<Database>, email: String) -> Result<User, String> {
    db.create_user(&email).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_user_settings(
    db: State<Database>,
    user_id: String,
    settings: UserSettings,
) -> Result<Option<User>, String> {
    db.update_user_settings(&user_id, settings)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_generations(db: State<Database>, user_id: String) -> Result<Vec<Generation>, String> {
    db.get_generations(&user_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_generation(
    db: State<Database>,
    input: SaveGenerationInput,
) -> Result<Generation, String> {
    db.save_generation(
        &input.user_id,
        &input.ggb_commands,
        &input.problem_type,
        input.image_path.as_deref(),
        input.description.as_deref(),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_generation(db: State<Database>, generation_id: String) -> Result<(), String> {
    db.delete_generation(&generation_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn decrement_credits(
    db: State<Database>,
    user_id: String,
    amount: i32,
) -> Result<i32, String> {
    db.decrement_credits(&user_id, amount).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_image(
    app_handle: tauri::AppHandle,
    user_id: String,
    image_data: Vec<u8>,
    filename: String,
) -> Result<SaveImageOutput, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;

    let images_dir = app_data_dir.join("images").join(&user_id);
    fs::create_dir_all(&images_dir).map_err(|e| e.to_string())?;

    let ext = std::path::Path::new(&filename)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png");
    let id = uuid::Uuid::new_v4().to_string();
    let new_filename = format!("{}.{}", id, ext);
    let file_path = images_dir.join(&new_filename);

    fs::write(&file_path, image_data).map_err(|e| e.to_string())?;

    Ok(SaveImageOutput {
        path: file_path.to_string_lossy().to_string(),
        id,
    })
}

#[tauri::command]
pub fn load_image(path: String) -> Result<Vec<u8>, String> {
    fs::read(&path).map_err(|e| format!("Failed to read image: {}", e))
}

#[tauri::command]
pub fn delete_image(path: String) -> Result<(), String> {
    fs::remove_file(&path).map_err(|e| format!("Failed to delete image: {}", e))
}

#[tauri::command]
pub fn get_image_path(app_handle: tauri::AppHandle, user_id: String, image_id: String) -> Result<String, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;

    let images_dir = app_data_dir.join("images").join(&user_id);

    if let Ok(entries) = fs::read_dir(&images_dir) {
        for entry in entries.flatten() {
            let filename = entry.file_name().to_string_lossy().to_string();
            if filename.starts_with(&image_id) {
                return Ok(entry.path().to_string_lossy().to_string());
            }
        }
    }

    Err("Image not found".to_string())
}
