#!/usr/bin/env bash
# One-command setup for the visit tracker. Safe to re-run: every step skips work that is already done.
#   1. installs wrangler (Cloudflare's CLI)      4. creates the tables
#   2. logs you in to Cloudflare                 5. deploys the Worker
#   3. creates the D1 database "visits"          6. sets a dashboard password and enables the tracker in _config.yml
set -euo pipefail
cd "$(dirname "$0")"

step() { printf '\n\033[1m%s\033[0m\n' "$*"; }

step "1/6  Installing wrangler…"
npm install --no-fund --no-audit --silent

step "2/6  Checking your Cloudflare login…"
if ! npx wrangler whoami 2>/dev/null | grep -q "You are logged in"; then
  echo "A browser window will open; log in to (or sign up for) a free Cloudflare account."
  npx wrangler login
fi

step "3/6  Creating the database…"
db_id() {
  npx wrangler d1 list --json 2>/dev/null |
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const db=JSON.parse(s).find(d=>d.name==="visits");process.stdout.write(db?(db.uuid||db.database_id||""):"")}catch{}})'
}
DB_ID="$(db_id)"
if [ -z "$DB_ID" ]; then
  npx wrangler d1 create visits </dev/null
  DB_ID="$(db_id)"
else
  echo "Database already exists ($DB_ID)."
fi
if [ -z "$DB_ID" ]; then
  echo "Could not find the database id. Run 'npx wrangler d1 list' and paste the id for 'visits' into wrangler.toml." >&2
  exit 1
fi
node -e 'const fs=require("fs");const f="wrangler.toml";fs.writeFileSync(f,fs.readFileSync(f,"utf8").replace(/database_id = "[^"]*"/,`database_id = "${process.argv[1]}"`))' "$DB_ID"

step "4/6  Creating the tables…"
npx wrangler d1 migrations apply visits --remote

step "5/6  Deploying the Worker…"
echo "A new Cloudflare account is asked to pick a workers.dev subdomain once (e.g. your name); answer yes."
DEPLOY_LOG="$(mktemp)"
# `script` keeps the terminal interactive (so wrangler can ask questions) while saving its output.
if [ "$(uname)" = "Darwin" ]; then
  script -q "$DEPLOY_LOG" npx wrangler deploy || true
else
  script -q -c "npx wrangler deploy" "$DEPLOY_LOG" || true
fi
URL="$(grep -oE 'https://[A-Za-z0-9.-]+\.workers\.dev' "$DEPLOY_LOG" | grep -v 'dash\.cloudflare' | head -1 || true)"
rm -f "$DEPLOY_LOG"
if [ -z "$URL" ]; then
  echo
  echo "The Worker was not deployed. If it asked for a workers.dev subdomain and you said no, run this"
  echo "script again and answer yes (or register one at https://dash.cloudflare.com → Workers & Pages)."
  exit 1
fi
URL="${URL%/}"

step "6/6  Dashboard password and site config…"
if npx wrangler secret list --format json 2>/dev/null | grep -q '"DASHBOARD_PASSWORD_HASH"'; then
  echo "A dashboard password is already set. Change it any time with: npm run password (in visit-tracker/)"
else
  echo "Choose the password for your /visitors page. It is never written to a file; Cloudflare only keeps a salted hash."
  node scripts/set-password.mjs
fi

node -e '
const fs = require("fs");
const file = "../_config.yml";
const url = process.argv[1];
let s = fs.readFileSync(file, "utf8");
s = s
  .replace(/^visit_tracker_url:.*$/m, `visit_tracker_url: ${url} # your visit-tracker Worker URL (see visit-tracker/README.md)`)
  .replace(/^enable_visit_tracker: false/m, "enable_visit_tracker: true");
fs.writeFileSync(file, s);
' "$URL"
echo "Updated _config.yml: visit_tracker_url = $URL, enable_visit_tracker = true"

SITE="$(grep -m1 '^ALLOWED_ORIGINS' wrangler.toml | sed -E 's/^[^"]*"([^,"]+).*/\1/')"

step "Done."
cat <<EOF

Next:
  1. Commit and push the website so GitHub Pages rebuilds it (takes a few minutes):
       git add -A && git commit -m "Enable visit tracker" && git push
  2. Your dashboard will be at  $SITE/visitors/  (sign in with the password you just chose).
  3. Open $SITE/?notrack once in every browser you use, so your own visits are not counted.
EOF
