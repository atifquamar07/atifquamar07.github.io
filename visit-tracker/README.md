# Visit tracker

A small, self-hosted visitor log for this website. It runs on Cloudflare's free tier (a Worker plus a D1 database) and records every page view with:

| What                   | Example                                                                                                                          |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Exact time             | 18 Oct 2026, 14:03:12, shown in your time and in the visitor's local time                                                        |
| Organization / network | Carnegie Mellon University, Google LLC, Etisalat                                                                                 |
| Network hostname       | `eduroam-12.wlan.cam.ac.uk` → domain `cam.ac.uk` (reverse DNS, when it has one)                                                  |
| Network type           | University / research, ISP / company, or cloud / VPN / proxy                                                                     |
| Location               | City, region, postcode, country, latitude/longitude                                                                              |
| Page                   | Path and title, how long it stayed on screen and how much of that was active                                                     |
| What they did          | Papers and sections read (with time), downloads, links, videos, figures, …                                                       |
| Papers seen            | Which papers were on screen for at least a second, read or not                                                                   |
| Searches               | What was typed into the site's search boxes (e.g. the publications filter)                                                       |
| Clicks                 | Where on the page each click landed, clicks on things that aren't links, and clicks repeated in frustration                      |
| AI summary             | Optional: a sentence or two on what each visit was after, and who the visitor might be, written by Gemini once the visit is over |
| Whole visits           | Each visitor's pages in order, and whether they came on earlier days                                                             |
| Problems               | Broken links (404 pages, with where the link was) and JavaScript errors                                                          |
| Came from              | Referring site (Google Scholar, LinkedIn, …) and `utm_source`                                                                    |
| Device                 | Desktop/mobile/tablet, OS, browser, screen size, language                                                                        |
| IP address             | Erased automatically after 365 days (configurable)                                                                               |

It never records names, emails, mouse movements or what is typed into forms (forms are recorded only by name when sent). What is typed into the site's search boxes is recorded, as it shows what a visitor was looking for. Location comes from the IP address and is city-level: usually right for universities and offices, sometimes off by a city or two for mobile networks, and wrong for VPN users (those are tagged "Cloud / VPN / proxy").

## Setup (about 5 minutes)

You need Node.js and a free Cloudflare account (sign-up happens in the browser during setup). From the repository root:

```bash
bash visit-tracker/setup.sh
```

The script installs Cloudflare's CLI, logs you in, creates the database, deploys the Worker, asks you to choose the dashboard password, and switches the tracker on in `_config.yml`. Then publish the site:

```bash
git add -A && git commit -m "Enable visit tracker" && git push
```

Finally, sign in to the dashboard once in every browser you use (laptop, phone, …). Browsers that have signed in are remembered and their visits are not counted, even after you log out.

## The dashboard

Open **https://www.atifquamar.com/visitors/** and enter the password. You stay signed in on that browser for 30 days, or until you click "log out". The page is not linked from the site and tells search engines not to index it.

The password is never stored anywhere: not in this repository, not in Cloudflare. When you set it, only a salted PBKDF2 hash is saved as the Cloudflare secret `DASHBOARD_PASSWORD_HASH`, and signing in checks against that hash. After 5 wrong attempts from one IP address, sign-in is blocked for a minute. To change the password, run `npm run password` in `visit-tracker/`; this also signs out every browser.

- **Filters**: date range, "Universities & research only", "Hide cloud, VPN & proxies", and free-text search over organization, city, postcode, page and IP.
- **Click anything** (an organization, city, country, page, referrer, a circle on the map) to filter the whole dashboard to it. "All pages by this visitor" shows one visitor's path through the site.
- **Why people came**: each visit's likely reason (citing a paper, getting a paper, looking for code, trying to reach you, checking your background, reading your research, …), guessed from what the visitor did. Hover a reason for the evidence; click one to see those visits, each told in one line ("Came from Google Scholar to publications → read “…” (1m 20s) → opened its BibTeX → left after 3m").
- **Papers**: for each paper, how many people it came into view for, read it (and for how long), opened its abstract or video, its BibTeX, its PDF, its paper links and code, and clicked its title expecting a link.
- **How visitors moved through the site**: first pages (and how many left right away), where they went from each page, last pages, and whole paths.
- **Worth a closer look**: universities, labs and companies whose network names them (internet providers, clouds and VPNs are left out, as they don't say who the visitor is) and who did more than glance: cited, downloaded, got in touch, checked your CV, read seriously or came back. Strongest interest first, with what they did and when; click one for their visits.
- **Came from** groups where visits started by kind of site: search engine, research site (Scholar, arXiv, Semantic Scholar, …), AI assistant (ChatGPT, Perplexity, …), code, social, email, direct.
- **What visitors did**: _actions_ (downloads, links to other sites, videos, figures, BibTeX opened, …), _reading_ (each paper and section, with the average time spent on it), _searches_, _engagement_ (active time and pages per visit, scrolling), and _problems_ (broken links to the site, JavaScript errors, and clicks that didn't respond). Click a row to see the visits where it happened.
- **Click map**: where visitors clicked on a page, drawn over the page as it looks now, for computers or phones.
- **Show the whole visit** under a row opens that visit step by step: its likely reason and one-line story, who and where from, then each page in order with what was done on it and when (time since the visit started), the papers that came into view, and whether the visitor came before. **Whole visits** at the top of "every visit" lists visits instead of single page views.
- **Export CSV** downloads every visit in the current filter.
- The view is kept in the URL, so you can bookmark a filtered view.

What the columns of "every visit" mean:

| Column       | Meaning                                                                                                                                                                                                              |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page         | The page of your website that was opened, e.g. "publications" (`/publications/`).                                                                                                                                    |
| Came from    | The website where the visitor clicked a link to that page, e.g. `scholar.google.com`. "Direct / bookmark" means a typed address, a bookmark, or an app that hides it; "within the site" means another page of yours. |
| Time on page | How long the page was on screen; filled in when the visitor leaves or switches tabs.                                                                                                                                 |

## AI summaries (optional)

With a Gemini API key, the Worker asks Gemini (the first of `GEMINI_MODELS` in `wrangler.toml` that isn't busy: `gemini-3.8-flash`, then `gemini-3.6-flash`, then `gemini-3.5-flash-lite`) to write, for each finished visit, what the visitor was probably trying to do and who they might be. They appear marked "AI" in the dashboard: in "why people came", "worth a closer look", the list of whole visits, and at the top of each opened visit.

- Each visit is sent **once**, after it is over (30 minutes without activity), and never again; visits where nothing happened (one page, under 10 seconds, no actions) are skipped without a call.
- It runs with the hourly cron, at most `SUMMARIES_PER_RUN` visits an hour (8, so at most 192 calls a day). When a model can't answer (rate limited, overloaded, or no answer within a minute), the next one is asked, and the busy one is left out for the rest of that hour. When none can, nothing is saved and the visit is tried again the next hour. The dashboard shows which model wrote each summary.
- Gemini sees each visit's network name, city, device, where the visitor came from, and their pages and actions; never IP addresses, hostnames or visitor ids. On Gemini's free tier, Google may use what it is sent to improve its products.

To switch it on, save the key as a Worker secret (it is never stored in the repository or sent to the dashboard):

```bash
cd visit-tracker && npx wrangler secret put GEMINI_API_KEY
```

To switch it off, delete the secret (`npx wrangler secret delete GEMINI_API_KEY`). For local testing, pass the key to `wrangler dev` with `--env-file ../.env` (git ignores `.env`).

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

> This site keeps a visit log (time, page, approximate location and network from your IP address, and what you click, read or search for on the site) to understand its audience. No cookies are used and nothing is shared with third parties.

The tracker sets no cookies. To leave out your own visits, the dashboard stores a flag in the local storage of browsers that have signed in. IP addresses are erased after `IP_RETENTION_DAYS` (in `wrangler.toml`); everything else is kept.

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
