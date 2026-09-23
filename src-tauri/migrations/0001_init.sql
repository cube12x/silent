-- Silent v1 schema
CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  model_id TEXT NOT NULL,
  repo_agent_id TEXT,
  gateway TEXT,
  codex_thread_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  blocks_json TEXT NOT NULL DEFAULT '[]',
  usage_json TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, created_at);
CREATE TABLE IF NOT EXISTS repo_agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  repo_path TEXT NOT NULL,
  primary_model_id TEXT NOT NULL,
  fallback_model_ids_json TEXT NOT NULL DEFAULT '[]',
  gateway_prompt TEXT NOT NULL DEFAULT '',
  gateway_profile_json TEXT NOT NULL DEFAULT '{}',
  permissions_json TEXT NOT NULL DEFAULT '{}',
  tools_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'idle',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  prompt TEXT NOT NULL,
  repo_agent_id TEXT,
  repo_path TEXT,
  model_pool_json TEXT NOT NULL DEFAULT '[]',
  execution_mode TEXT NOT NULL,
  cost_mode TEXT NOT NULL,
  status TEXT NOT NULL,
  plan_json TEXT NOT NULL DEFAULT '[]',
  routing_json TEXT NOT NULL DEFAULT '[]',
  estimate_json TEXT,
  started_at INTEGER,
  finished_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS subtasks (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  depends_on_json TEXT NOT NULL DEFAULT '[]',
  state TEXT NOT NULL,
  assigned_model_id TEXT,
  attempts_json TEXT NOT NULL DEFAULT '[]',
  files_json TEXT NOT NULL DEFAULT '[]',
  commands_json TEXT NOT NULL DEFAULT '[]',
  summary TEXT,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_subtasks_run ON subtasks(run_id, position);
CREATE TABLE IF NOT EXISTS terminal_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subtask_id TEXT NOT NULL REFERENCES subtasks(id) ON DELETE CASCADE,
  ts INTEGER NOT NULL,
  stream TEXT NOT NULL,
  text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_terminal_subtask ON terminal_lines(subtask_id, id);
CREATE TABLE IF NOT EXISTS memory_entries (
  id TEXT PRIMARY KEY,
  layer TEXT NOT NULL,
  scope_id TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT '',
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS activity (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT,
  ref_id TEXT,
  created_at INTEGER NOT NULL
);
