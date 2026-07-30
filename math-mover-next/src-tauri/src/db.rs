use rusqlite::{Connection, Result, params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct User {
    pub id: String,
    pub email: String,
    pub credits: i32,
    pub subscription_tier: String,
    pub api_key: Option<String>,
    pub api_base_url: Option<String>,
    pub api_model_name: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Generation {
    pub id: String,
    pub user_id: String,
    pub image_path: Option<String>,
    pub ggb_commands: String,
    pub problem_type: String,
    pub description: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UserSettings {
    pub email: Option<String>,
    pub credits: Option<i32>,
    pub subscription_tier: Option<String>,
    pub api_key: Option<String>,
    pub api_base_url: Option<String>,
    pub api_model_name: Option<String>,
}

pub struct Database {
    pub conn: Mutex<Connection>,
}

impl Database {
    pub fn new(app_data_dir: PathBuf) -> Result<Self> {
        std::fs::create_dir_all(&app_data_dir).ok();
        let db_path = app_data_dir.join("mathmover.db");
        let conn = Connection::open(&db_path)?;

        let db = Database {
            conn: Mutex::new(conn),
        };
        db.init_tables()?;
        Ok(db)
    }

    fn init_tables(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();

        conn.execute(
            "CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                email TEXT NOT NULL,
                credits INTEGER DEFAULT 10,
                subscription_tier TEXT DEFAULT 'free',
                api_key TEXT,
                api_base_url TEXT,
                api_model_name TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            )",
            [],
        )?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS generations (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                image_path TEXT,
                ggb_commands TEXT NOT NULL,
                problem_type TEXT NOT NULL,
                description TEXT,
                created_at TEXT DEFAULT (datetime('now')),
                FOREIGN KEY (user_id) REFERENCES users(id)
            )",
            [],
        )?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS images (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                filename TEXT NOT NULL,
                filepath TEXT NOT NULL,
                created_at TEXT DEFAULT (datetime('now')),
                FOREIGN KEY (user_id) REFERENCES users(id)
            )",
            [],
        )?;

        Ok(())
    }

    pub fn get_user(&self, user_id: &str) -> Result<Option<User>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, email, credits, subscription_tier, api_key, api_base_url, api_model_name, created_at
             FROM users WHERE id = ?1"
        )?;

        let user = stmt.query_row(params![user_id], |row| {
            Ok(User {
                id: row.get(0)?,
                email: row.get(1)?,
                credits: row.get(2)?,
                subscription_tier: row.get(3)?,
                api_key: row.get(4)?,
                api_base_url: row.get(5)?,
                api_model_name: row.get(6)?,
                created_at: row.get(7)?,
            })
        }).optional()?;

        Ok(user)
    }

    pub fn create_user(&self, email: &str) -> Result<User> {
        let conn = self.conn.lock().unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        conn.execute(
            "INSERT INTO users (id, email, credits, created_at) VALUES (?1, ?2, 10, ?3)",
            params![id, email, now],
        )?;

        Ok(User {
            id,
            email: email.to_string(),
            credits: 10,
            subscription_tier: "free".to_string(),
            api_key: None,
            api_base_url: None,
            api_model_name: None,
            created_at: now,
        })
    }

    pub fn update_user_settings(&self, user_id: &str, settings: UserSettings) -> Result<Option<User>> {
        let conn = self.conn.lock().unwrap();

        if let Some(email) = &settings.email {
            conn.execute("UPDATE users SET email = ?1 WHERE id = ?2", params![email, user_id])?;
        }
        if let Some(credits) = settings.credits {
            conn.execute("UPDATE users SET credits = ?1 WHERE id = ?2", params![credits, user_id])?;
        }
        if let Some(tier) = &settings.subscription_tier {
            conn.execute("UPDATE users SET subscription_tier = ?1 WHERE id = ?2", params![tier, user_id])?;
        }
        if let Some(api_key) = &settings.api_key {
            conn.execute("UPDATE users SET api_key = ?1 WHERE id = ?2", params![api_key, user_id])?;
        }
        if let Some(base_url) = &settings.api_base_url {
            conn.execute("UPDATE users SET api_base_url = ?1 WHERE id = ?2", params![base_url, user_id])?;
        }
        if let Some(model) = &settings.api_model_name {
            conn.execute("UPDATE users SET api_model_name = ?1 WHERE id = ?2", params![model, user_id])?;
        }

        drop(conn);
        self.get_user(user_id)
    }

    pub fn get_generations(&self, user_id: &str) -> Result<Vec<Generation>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, user_id, image_path, ggb_commands, problem_type, description, created_at
             FROM generations WHERE user_id = ?1 ORDER BY created_at DESC"
        )?;

        let generations = stmt.query_map(params![user_id], |row| {
            Ok(Generation {
                id: row.get(0)?,
                user_id: row.get(1)?,
                image_path: row.get(2)?,
                ggb_commands: row.get(3)?,
                problem_type: row.get(4)?,
                description: row.get(5)?,
                created_at: row.get(6)?,
            })
        })?.collect::<Result<Vec<_>>>()?;

        Ok(generations)
    }

    pub fn save_generation(&self, user_id: &str, ggb_commands: &str, problem_type: &str, image_path: Option<&str>, description: Option<&str>) -> Result<Generation> {
        let conn = self.conn.lock().unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        conn.execute(
            "INSERT INTO generations (id, user_id, image_path, ggb_commands, problem_type, description, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![id, user_id, image_path, ggb_commands, problem_type, description, now],
        )?;

        Ok(Generation {
            id,
            user_id: user_id.to_string(),
            image_path: image_path.map(String::from),
            ggb_commands: ggb_commands.to_string(),
            problem_type: problem_type.to_string(),
            description: description.map(String::from),
            created_at: now,
        })
    }

    pub fn delete_generation(&self, generation_id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM generations WHERE id = ?1", params![generation_id])?;
        Ok(())
    }

    pub fn decrement_credits(&self, user_id: &str, amount: i32) -> Result<i32> {
        let conn = self.conn.lock().unwrap();

        conn.execute(
            "UPDATE users SET credits = MAX(0, credits - ?1) WHERE id = ?2",
            params![amount, user_id],
        )?;

        let credits: i32 = conn.query_row(
            "SELECT credits FROM users WHERE id = ?1",
            params![user_id],
            |row| row.get(0),
        )?;

        Ok(credits)
    }
}
