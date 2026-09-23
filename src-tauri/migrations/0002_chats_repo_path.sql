-- chats.repo_path was referenced by the repository layer but missing from 0001.
ALTER TABLE chats ADD COLUMN repo_path TEXT;
