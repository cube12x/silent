//! SQLite migrations, applied by tauri-plugin-sql on startup.

use tauri_plugin_sql::{Migration, MigrationKind};

pub fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "init",
            sql: include_str!("../migrations/0001_init.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "chats repo_path",
            sql: include_str!("../migrations/0002_chats_repo_path.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "v2 cli-native: provider/session columns, drop demo rows",
            sql: include_str!("../migrations/0003_v2.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "v2.2 ai planning",
            sql: include_str!("../migrations/0004_v22.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "v2.3 kits, spec, polish",
            sql: include_str!("../migrations/0005_kits.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "v2.4 template agents",
            sql: include_str!("../migrations/0006_template_agents.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "v3.0 blueprints",
            sql: include_str!("../migrations/0007_blueprints.sql"),
            kind: MigrationKind::Up,
        },
    ]
}
