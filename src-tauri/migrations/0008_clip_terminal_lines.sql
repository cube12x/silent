-- 2026-10-04: terminal lines over 4000 chars (whole file bodies echoed by CLIs) held 17 MB of a 56 MB database.
-- New lines are clipped on insert; this clips what is already stored.
UPDATE terminal_lines SET text = substr(text, 1, 4000) || '… [clipped]' WHERE length(text) > 4000;
