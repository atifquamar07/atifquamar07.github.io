-- Reloads: when a visitor opens the same page again within 30 minutes of their last view of it,
-- the existing row counts a reload instead of a new row being added.
ALTER TABLE visits ADD COLUMN reloads INTEGER NOT NULL DEFAULT 0;
ALTER TABLE visits ADD COLUMN last_ts TEXT;      -- time of the latest reload
ALTER TABLE visits ADD COLUMN last_pv_id TEXT;   -- page-view id of the latest reload (for its time-on-page report)

CREATE INDEX IF NOT EXISTS idx_visits_visitor_path_ts ON visits (visitor, path, ts);
CREATE INDEX IF NOT EXISTS idx_visits_last_pv_id ON visits (last_pv_id);

-- Merge reloads that were already stored as separate rows. A row starts a new visit unless the same
-- visitor viewed the same page less than 30 minutes before it; the first row of each visit is kept.
WITH ordered AS (
  SELECT id, visitor, path, ts, duration_s,
         LAG(ts) OVER (PARTITION BY visitor, path ORDER BY ts, id) AS prev_ts
  FROM visits WHERE visitor IS NOT NULL
),
numbered AS (
  SELECT *, SUM(CASE WHEN prev_ts IS NULL OR julianday(ts) - julianday(prev_ts) >= 30.0 / 1440 THEN 1 ELSE 0 END)
              OVER (PARTITION BY visitor, path ORDER BY ts, id ROWS UNBOUNDED PRECEDING) AS visit_no
  FROM ordered
),
merged AS (
  SELECT MIN(id) AS keep_id, COUNT(*) - 1 AS reloads, MAX(ts) AS last_ts, MAX(duration_s) AS duration_s
  FROM numbered GROUP BY visitor, path, visit_no HAVING COUNT(*) > 1
)
UPDATE visits
SET reloads = (SELECT reloads FROM merged WHERE keep_id = visits.id),
    last_ts = (SELECT last_ts FROM merged WHERE keep_id = visits.id),
    duration_s = (SELECT duration_s FROM merged WHERE keep_id = visits.id)
WHERE id IN (SELECT keep_id FROM merged);

WITH ordered AS (
  SELECT id, visitor, path, ts,
         LAG(ts) OVER (PARTITION BY visitor, path ORDER BY ts, id) AS prev_ts
  FROM visits WHERE visitor IS NOT NULL
),
numbered AS (
  SELECT *, SUM(CASE WHEN prev_ts IS NULL OR julianday(ts) - julianday(prev_ts) >= 30.0 / 1440 THEN 1 ELSE 0 END)
              OVER (PARTITION BY visitor, path ORDER BY ts, id ROWS UNBOUNDED PRECEDING) AS visit_no
  FROM ordered
)
DELETE FROM visits
WHERE visitor IS NOT NULL
  AND id NOT IN (SELECT MIN(id) FROM numbered GROUP BY visitor, path, visit_no);
