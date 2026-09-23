//! SQLite migrations, applied by tauri-plugin-sql on startup.

use tauri_plugin_sql::{Migration, MigrationKind};

pub fn migrations() -> Vec<Migration> {
    vec![Migration {
        version: 1,
        description: "init",
        sql: include_str!("../migrations/0001_init.sql"),
        kind: MigrationKind::Up,
    }]
}
