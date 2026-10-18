-- Your own names for networks that public records only list under their internet provider,
-- e.g. a campus whose addresses are registered to Etisalat.
CREATE TABLE IF NOT EXISTS network_labels (
  prefix TEXT PRIMARY KEY,      -- an IP address or range, e.g. 5.195.0.145 or 5.195.0.0/24
  name TEXT NOT NULL,           -- e.g. MBZUAI (campus Wi-Fi)
  kind TEXT NOT NULL,           -- academic | other
  created TEXT NOT NULL
);

-- Network owner as reported by Cloudflare. visits.org shows your label instead when one matches.
ALTER TABLE visits ADD COLUMN isp TEXT;
UPDATE visits SET isp = org;
