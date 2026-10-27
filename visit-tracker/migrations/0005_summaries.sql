-- What each whole visit was about, written by an AI model once the visit is over (see summarizeVisits in
-- src/index.js). One row per visit, keyed by its first page view, written once and never redone.
CREATE TABLE IF NOT EXISTS summaries (
  visit_id INTEGER PRIMARY KEY REFERENCES visits (id) ON DELETE CASCADE,
  status TEXT NOT NULL,         -- done | skipped (too little happened to need one) | failed (the answer was unusable)
  summary TEXT,                 -- e.g. "Read the abstract of “…” and copied its BibTeX, most likely to cite it."
  who TEXT,                     -- who the visitor might be, e.g. "a researcher working on multi-agent LLMs"
  confidence TEXT,              -- low | medium | high
  model TEXT,
  created TEXT NOT NULL
);
