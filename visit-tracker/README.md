# Visit tracker

A small, self-hosted visitor log for this website. It runs on Cloudflare's free tier (a Worker plus a D1 database) and records every page view with:

| What                   | Example                                                                         |
| ---------------------- | ------------------------------------------------------------------------------- |
| Exact time             | 18 Oct 2026, 14:03:12, shown in your time and in the visitor's local time       |
| Organization / network | Carnegie Mellon University, Google LLC, Etisalat                                |
| Network hostname       | `eduroam-12.wlan.cam.ac.uk` → domain `cam.ac.uk` (reverse DNS, when it has one) |
| Network type           | University / research, ISP / company, or cloud / VPN / proxy                    |
| Location               | City, region, postcode, country, latitude/longitude                             |
| Page                   | Path and title, how long it stayed on screen                                    |
| Came from              | Referring site (Google Scholar, LinkedIn, …) and `utm_source`                   |
| Device                 | Desktop/mobile/tablet, OS, browser, screen size, language                       |
| IP address             | Erased automatically after 365 days (configurable)                              |

It never records names, emails or anything typed on the site. Location comes from the IP address and is city-level: usually right for universities and offices, sometimes off by a city or two for mobile networks, and wrong for VPN users (those are tagged "Cloud / VPN / proxy").

## Setup (about 5 minutes)

You need Node.js and a free Cloudflare account (sign-up happens in the browser during setup). From the repository root:

```bash
bash visit-tracker/setup.sh
```

The script installs Cloudflare's CLI, logs you in, creates the database, deploys the Worker, asks you to choose the dashboard password, and switches the tracker on in `_config.yml`. Then publish the site:

```bash
git add -A && git commit -m "Enable visit tracker" && git push
```

Finally, open `https://www.atifquamar.com/?notrack` once in every browser you use, so your own visits are not counted (`?track` undoes it).

## The dashboard

Open **https://www.atifquamar.com/visitors/** and enter the password. You stay signed in on that browser for 30 days, or until you click "log out". The page is not linked from the site and tells search engines not to index it.

The password is never stored anywhere: not in this repository, not in Cloudflare. When you set it, only a salted PBKDF2 hash is saved as the Cloudflare secret `DASHBOARD_PASSWORD_HASH`, and signing in checks against that hash. After 5 wrong attempts from one IP address, sign-in is blocked for a minute. To change the password, run `npm run password` in `visit-tracker/`; this also signs out every browser.

- **Filters**: date range, "Universities & research only", "Hide cloud, VPN & proxies", and free-text search over organization, city, postcode, page and IP.
- **Click anything** (an organization, city, country, page, referrer, a circle on the map) to filter the whole dashboard to it. "All pages by this visitor" shows one visitor's path through the site.
- **Export CSV** downloads every visit in the current filter.
- The view is kept in the URL, so you can bookmark a filtered view.

What the columns of "every visit" mean:

| Column       | Meaning                                                                                                                                                                                                              |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page         | The page of your website that was opened, e.g. "publications" (`/publications/`).                                                                                                                                    |
| Came from    | The website where the visitor clicked a link to that page, e.g. `scholar.google.com`. "Direct / bookmark" means a typed address, a bookmark, or an app that hides it; "within the site" means another page of yours. |
| Time on page | How long the page was on screen; filled in when the visitor leaves or switches tabs.                                                                                                                                 |

## Naming networks (e.g. your university's Wi-Fi)

Many institutions don't own their IP addresses; they rent them from their internet provider. Public records then name only the provider. MBZUAI's Wi-Fi, for example, uses Etisalat addresses (`5.195.0.x`) with no public record mentioning MBZUAI, so it shows as "Emirates Telecommunications…".

When you know who a network really is, click **name this network** on any visit, enter a name such as "MBZUAI (campus Wi-Fi)", and choose the type. Every past and future visit from that address shows the name, counts as academic if you picked that, and keeps the provider as "via Etisalat". Named networks are listed at the bottom of the dashboard, where you can remove them.

Name a single address unless you are sure a whole block belongs to the same place. If the address changes from day to day, add each new one, or use a `/24` range such as `5.195.0.0/24` (256 addresses).

## Accuracy notes

- **Organization** is the owner of the visitor's network. On a campus or company network that has its own addresses, that is the institution; at home, and on campuses that rent their addresses from an internet provider, it is the provider (see "Naming networks" above). Some universities route through their national research network (JANET, DFN, RENATER…). These count as academic, and the hostname usually still names the university.
- **Postcode** is the IP's postcode area, not a street address. It is often missing outside the US and Europe.
- Visitors with ad or tracker blockers may not be counted. Bots, crawlers and headless browsers are dropped on purpose.

## Privacy

IP addresses are personal data under GDPR (EU visitors) and the UAE's PDPL. Add a short notice to the site, for example in the footer or on the contact page:

> This site keeps a basic visit log (time, page, approximate location and network, from your IP address) to understand its audience. No cookies are used and nothing is shared with third parties.

The tracker sets no cookies. The `?notrack` opt-out uses the browser's local storage, only in your own browser. IP addresses are erased after `IP_RETENTION_DAYS` (in `wrangler.toml`); everything else is kept.

The map on the contact page reads `/map`, which is public but only contains city-level counts. It has no organizations, IP addresses or timestamps, and leaves out cloud/VPN traffic.

## Day-to-day commands

Run these from `visit-tracker/`:

```bash
npm run password                               # change the dashboard password (typed, never saved)
npm run deploy                                 # deploy after editing src/ or migrations/
npm run logs                                   # live request log
npx wrangler d1 execute visits --remote --command \
  "SELECT ts, org, city, country, path FROM visits ORDER BY ts DESC LIMIT 20"   # raw SQL
```

To try everything on your own computer:

1. In `visit-tracker/`, run `npm run password:local` once. It saves a password hash to `.dev.vars`, which git ignores. Then run `npm run dev`, which starts the tracker at http://localhost:8787.
2. In the repository root, run `docker compose up`, then open http://localhost:8080/visitors/. A local copy of the site uses the local tracker as long as `visit_tracker_url` in `_config.yml` is empty.

To switch tracking off, set `enable_visit_tracker: false` in `_config.yml`. To delete everything, run `npx wrangler delete` and `npx wrangler d1 delete visits`.

## Costs and limits

The Cloudflare free tier allows 100,000 Worker requests and 100,000 database writes per day, plus 5 million rows read and 5 GB of storage. Each page view uses two requests (arrival and leave) and up to three writes. A typical academic site uses well under 5% of that. If you exceed the limit, the extra visits that day are simply not recorded and the website itself is unaffected.

## How it works

```
visitor's browser ──POST /hit, /leave──▶ Cloudflare Worker ──▶ D1 database (visits table)
  (snippet in every page)                   │  adds location + network from Cloudflare,
                                            │  reverse DNS hostname, device, bot filtering
atifquamar.com/visitors/ ──password, then token──▶ Worker /api/*  (dashboard data)
contact page ──GET /map (public, city-level only)
```

| File                                | Purpose                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------ |
| `src/index.js`                      | The Worker: collection, reverse DNS, sign-in, dashboard API, CSV, hourly |
| `src/classify.js`                   | Device/browser parsing, academic/cloud network detection, bot filter     |
| `scripts/set-password.mjs`          | Sets the dashboard password (stores only a salted hash)                  |
| `migrations/`                       | Database schema                                                          |
| `wrangler.toml`                     | Worker configuration (allowed origins, IP retention, rate limits)        |
| `../_pages/visitors.html`           | The dashboard page at /visitors/                                         |
| `../_includes/visit_tracker.liquid` | The snippet added to every page                                          |
| `../_includes/visitor_map.liquid`   | The world map on the contact page                                        |
