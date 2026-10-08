-- MindMirror (2026-10-08): one row per modded model (Bilinç + Eylem + gateway + tools + sessions), as JSON like blueprints.
CREATE TABLE IF NOT EXISTS mind_models (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
