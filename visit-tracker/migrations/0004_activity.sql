-- What visitors do on a page: "Downloaded cv.pdf", "Clicked “Publications” in the menu", or a paper they read
-- (type 'read', with the seconds spent on it). At most 200 per page view.
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visit_id INTEGER NOT NULL REFERENCES visits (id) ON DELETE CASCADE,
  at TEXT NOT NULL,             -- UTC ISO timestamp
  type TEXT NOT NULL,           -- read | scroll | download | outbound | email | link | copy | image | video | expand | form | print | away | error | custom
  name TEXT NOT NULL,           -- e.g. "Downloaded cv.pdf · Paper title"
  detail TEXT,                  -- e.g. the link's address
  seconds INTEGER               -- how long: reading time, time away, how far into a video
);

CREATE INDEX IF NOT EXISTS idx_events_visit ON events (visit_id, at);

ALTER TABLE visits ADD COLUMN scroll_pct INTEGER;  -- how far down the page the visitor scrolled (pages taller than the screen)
ALTER TABLE visits ADD COLUMN active_s INTEGER;    -- of duration_s, the seconds the visitor was actually using the page
ALTER TABLE visits ADD COLUMN status INTEGER;      -- 404 when the page doesn't exist (a broken link); NULL otherwise
