-- One row per page view.
CREATE TABLE IF NOT EXISTS visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pv_id TEXT UNIQUE,            -- random id generated in the browser for this page view
  ts TEXT NOT NULL,             -- UTC ISO timestamp, e.g. 2026-10-18T09:41:07.123Z
  visitor TEXT,                 -- short hash of IP + browser, used to count unique visitors

  -- Network / organization
  ip TEXT,                      -- cleared after IP_RETENTION_DAYS
  org TEXT,                     -- network owner, e.g. "Carnegie Mellon University", "Google LLC"
  asn INTEGER,                  -- autonomous system number of that network
  kind TEXT,                    -- academic | cloud | other
  hostname TEXT,                -- reverse DNS of the IP, e.g. eduroam-12.wlan.cam.ac.uk
  host_domain TEXT,             -- registrable part of hostname, e.g. cam.ac.uk

  -- Location (from the IP address, city level)
  city TEXT,
  region TEXT,
  region_code TEXT,
  postal TEXT,
  country TEXT,                 -- ISO 3166-1 alpha-2, e.g. AE
  continent TEXT,
  lat REAL,
  lon REAL,
  tz TEXT,                      -- visitor's IANA time zone, e.g. America/New_York

  -- Page
  path TEXT,
  title TEXT,
  referrer TEXT,
  ref_host TEXT,                -- external referrer host; NULL for direct visits and internal navigation
  utm_source TEXT,

  -- Device
  device TEXT,                  -- desktop | mobile | tablet
  os TEXT,
  browser TEXT,
  screen TEXT,
  lang TEXT,
  user_agent TEXT,

  duration_s INTEGER            -- seconds the page was visible, reported when the visitor leaves
);

CREATE INDEX IF NOT EXISTS idx_visits_ts ON visits (ts);

-- Small key/value store for precomputed public data (the contact-page map).
CREATE TABLE IF NOT EXISTS cache (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated TEXT NOT NULL
);
