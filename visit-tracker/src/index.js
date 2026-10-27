import { classifyNetwork, isBot, parseUserAgent, referrerHost, registrableDomain } from "./classify.js";

const MAX_BODY_BYTES = 16384;
const MAX_DURATION_S = 4 * 60 * 60;
const MAP_CACHE_KEY = "public-map";
const MAP_CACHE_TTL_MS = 2 * 60 * 60 * 1000;
const PV_ID = /^[\w-]{8,64}$/;

// Columns the dashboard can filter on with an exact match (never interpolate anything else into SQL).
const FILTER_FIELDS = ["org", "kind", "country", "region", "city", "postal", "path", "ref_host", "host_domain", "device", "os", "browser", "visitor"];
const SEARCH_FIELDS = ["org", "isp", "hostname", "city", "region", "postal", "country", "path", "title", "referrer", "ip"];
const VISIT_COLUMNS =
  "id, ts, visitor, ip, org, isp, asn, kind, hostname, host_domain, city, region, region_code, postal, country, continent, lat, lon, tz, path, title, referrer, ref_host, utm_source, device, os, browser, screen, lang, user_agent, duration_s, active_s, scroll_pct, status, reloads, last_ts";
const LABEL_KINDS = ["academic", "other"];
const LABEL_CACHE_MS = 60 * 1000;
const SESSION_MS = 30 * 86400000;
const RELOAD_WINDOW_MS = 30 * 60000;
// What a visitor can do on a page (see _includes/visit_tracker.liquid). Reading time arrives separately.
const EVENT_TYPES = new Set([
  "scroll",
  "download",
  "outbound",
  "email",
  "copy",
  "custom",
  "away",
  "print",
  "form",
  "video",
  "image",
  "expand",
  "link",
  "error",
  "seen",
  "search",
  "click",
  "rage",
  "dead",
]);
// Activity that is only counted (papers scrolled past, clicks for the click map), not listed with each visit.
const QUIET_EVENTS = "('seen', 'click')";
const MAX_EVENTS = 300;
// Activity shown with each visit in the list; the rest is fetched when the visit is opened.
const LIST_EVENTS = 12;
// A visitor's page views with gaps of less than this form one visit.
const VISIT_GAP_DAYS = 30 / 1440;
// Whole visits sent to the dashboard's insights at most (newest first).
const MAX_INSIGHT_VISITS = 3000;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      switch (url.pathname) {
        case "/hit":
          return await recordHit(request, env, ctx);
        case "/leave":
          return await recordLeave(request, env);
        case "/map":
          return await publicMap(env);
        case "/":
          // The dashboard itself is a page on the website (/visitors/); this Worker only serves its data.
          return dashboardUrl(env) ? Response.redirect(dashboardUrl(env), 302) : new Response("Visit tracker");
        case "/api/login":
        case "/api/summary":
        case "/api/visits":
        case "/api/live":
        case "/api/export.csv":
        case "/api/labels":
        case "/api/events":
        case "/api/visitor":
        case "/api/sessions":
        case "/api/insights":
        case "/api/clicks":
          return await dashboardApi(request, env, url);
        default:
          return new Response("Not found", { status: 404 });
      }
    } catch (err) {
      console.error(err);
      return new Response("Server error", { status: 500 });
    }
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(Promise.all([refreshMapCache(env), eraseOldIps(env), summarizeVisits(env)]));
  },
};

// ---------------------------------------------------------------------------
// Collection

async function recordHit(request, env, ctx) {
  const origins = allowedOrigins(env);
  const rejected = await rejectEvent(request, env, origins);
  if (rejected) return rejected;

  const userAgent = request.headers.get("User-Agent") || "";
  if (!userAgent || isBot(userAgent)) return empty(204);

  const body = await readJson(request);
  if (!body || !PV_ID.test(body.id || "")) return empty(400);

  const cf = request.cf || {};
  const ip = request.headers.get("CF-Connecting-IP") || "";
  const now = new Date();
  const path = str(body.path, 300) || "/";
  const screen = str(body.screen, 20);
  const lang = str(body.lang, 20) || str((request.headers.get("Accept-Language") || "").split(",")[0], 20);
  // One "visitor" = same network + same browser + same screen and language. Screen and language help tell apart
  // people with identical phones behind one shared address (e.g. campus Wi-Fi). Width × height is sorted so
  // turning the phone doesn't make a new visitor.
  const screenKey = (screen || "")
    .split("x")
    .map(Number)
    .sort((a, b) => a - b)
    .join("x");
  const visitor = (await sha256Hex(`${ip}|${userAgent}|${screenKey}|${lang || ""}`)).slice(0, 16);

  // A reload (same visitor, same page, within 30 minutes of their last view of it) updates that visit instead.
  const recent = await env.DB.prepare(
    `SELECT id FROM visits WHERE visitor = ?1 AND path = ?2 AND ts >= ?3 AND COALESCE(last_ts, ts) >= ?4
     ORDER BY id DESC LIMIT 1`
  )
    .bind(visitor, path, new Date(now - 86400000).toISOString(), new Date(now - RELOAD_WINDOW_MS).toISOString())
    .first();
  if (recent) {
    await env.DB.prepare("UPDATE visits SET reloads = reloads + 1, last_ts = ?1, last_pv_id = ?2 WHERE id = ?3")
      .bind(now.toISOString(), body.id, recent.id)
      .run();
    return empty(204);
  }

  const isp = str(cf.asOrganization, 200);
  const label = labelFor(await loadLabels(env), ip);
  const { device, os, browser } = parseUserAgent(userAgent);
  const siteHosts = origins.map((o) => new URL(o).hostname);
  const referrer = str(body.ref, 500);

  await env.DB.prepare(
    `INSERT OR IGNORE INTO visits
       (pv_id, ts, visitor, ip, org, isp, asn, kind, city, region, region_code, postal, country, continent, lat, lon, tz,
        path, title, referrer, ref_host, utm_source, device, os, browser, screen, lang, user_agent, status)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28, ?29)`
  )
    .bind(
      body.id,
      now.toISOString(),
      visitor,
      ip || null,
      label ? label.name : isp,
      isp,
      Number.isInteger(cf.asn) ? cf.asn : null,
      label ? label.kind : classifyNetwork(isp, null),
      str(cf.city, 100),
      str(cf.region, 100),
      str(cf.regionCode, 10),
      str(cf.postalCode, 20),
      str(cf.country, 2),
      str(cf.continent, 2),
      coordinate(cf.latitude),
      coordinate(cf.longitude),
      str(cf.timezone, 64),
      path,
      str(body.title, 200),
      referrer,
      referrerHost(referrer, siteHosts),
      str(body.utm, 100),
      device,
      os,
      browser,
      screen,
      lang,
      userAgent.slice(0, 400),
      body.status === 404 ? 404 : null
    )
    .run();

  // The reverse-DNS lookup runs after the response has been sent.
  ctx.waitUntil(addHostname(env, body.id, ip, isp).catch((err) => console.error("hostname lookup", err)));
  return empty(204);
}

async function recordLeave(request, env) {
  const rejected = await rejectEvent(request, env, allowedOrigins(env));
  if (rejected) return rejected;

  const body = await readJson(request);
  const seconds = Math.round(Number(body?.seconds));
  if (!PV_ID.test(body?.id || "") || !Number.isFinite(seconds) || seconds < 0) return empty(400);
  const scroll = Number.isInteger(body.scroll) && body.scroll >= 0 && body.scroll <= 100 ? body.scroll : null;
  const active = body.active == null ? null : duration(body.active);
  const now = Date.now();
  const events = cleanEvents(body.events, now);
  const reading = cleanReading(body.reading, now);

  // The id may belong to the visit itself or to its latest reload. Time on page, active time and scroll depth
  // keep their highest value.
  const visit = await env.DB.prepare(
    `UPDATE visits SET duration_s = MAX(COALESCE(duration_s, 0), ?1),
            scroll_pct = CASE WHEN ?3 IS NULL THEN scroll_pct ELSE MAX(COALESCE(scroll_pct, 0), ?3) END,
            active_s = CASE WHEN ?4 IS NULL THEN active_s ELSE MAX(COALESCE(active_s, 0), MIN(?4, ?1)) END
     WHERE pv_id = ?2 OR last_pv_id = ?2 RETURNING id`
  )
    .bind(Math.min(seconds, MAX_DURATION_S), body.id, scroll, active)
    .first();
  if (!visit || (!events.length && !reading.length)) return empty(204);

  // At most MAX_EVENTS per visit, so a misbehaving page can't fill the database.
  const room = `(SELECT COUNT(*) FROM events WHERE visit_id = ?1) < ${MAX_EVENTS}`;
  await env.DB.batch([
    ...events.map((e) =>
      env.DB.prepare(`INSERT INTO events (visit_id, at, type, name, detail, seconds) SELECT ?1, ?2, ?3, ?4, ?5, ?6 WHERE ${room}`).bind(
        visit.id,
        e.at,
        e.type,
        e.name,
        e.detail,
        e.seconds
      )
    ),
    // Reading time arrives as a running total per paper or section: one row each, keeping the highest total.
    ...reading.flatMap((r) => [
      env.DB.prepare("UPDATE events SET seconds = ?3 WHERE visit_id = ?1 AND type = 'read' AND name = ?2 AND COALESCE(seconds, 0) < ?3").bind(
        visit.id,
        r.name,
        r.seconds
      ),
      env.DB.prepare(
        `INSERT INTO events (visit_id, at, type, name, seconds) SELECT ?1, ?4, 'read', ?2, ?3
         WHERE NOT EXISTS (SELECT 1 FROM events WHERE visit_id = ?1 AND type = 'read' AND name = ?2) AND ${room}`
      ).bind(visit.id, r.name, r.seconds, r.at),
    ]),
  ]);
  return empty(204);
}

const when = (now, ago) => new Date(now - (Number.isFinite(ago) && ago >= 0 && ago <= 86400000 ? Math.round(ago) : 0)).toISOString();
function duration(value) {
  const seconds = Math.round(Number(value));
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds, MAX_DURATION_S) : null;
}

// Activity sent with a time-on-page report: [{ type, name, detail, seconds, ago: ms before the report }], at most 20.
function cleanEvents(list, now) {
  if (!Array.isArray(list)) return [];
  return list
    .slice(0, 20)
    .map((e) => {
      const name = str(e?.name, 150);
      if (!name || !EVENT_TYPES.has(e.type)) return null;
      return {
        type: e.type,
        name,
        detail: str(e.detail, 300),
        seconds: e.seconds == null ? null : duration(e.seconds),
        at: when(now, Number(e.ago)),
      };
    })
    .filter(Boolean);
}

// What was read and for how long: [{ name: paper or section, seconds, ago: ms since it was first read }], at most 20.
function cleanReading(list, now) {
  if (!Array.isArray(list)) return [];
  return list
    .slice(0, 20)
    .map((r) => {
      const name = str(r?.name, 150);
      const seconds = duration(r?.seconds);
      return name && seconds >= 1 ? { name, seconds, at: when(now, Number(r.ago)) } : null;
    })
    .filter(Boolean);
}

async function rejectEvent(request, env, origins) {
  if (request.method !== "POST") return empty(405);
  if (!origins.includes(request.headers.get("Origin"))) return empty(403);
  if (Number(request.headers.get("Content-Length") || 0) > MAX_BODY_BYTES) return empty(413);
  if (await rateLimited(env.LIMITER, request.headers.get("CF-Connecting-IP") || "unknown")) return empty(429);
  return null;
}

async function addHostname(env, pvId, ip, isp) {
  const hostname = await reverseDns(ip);
  if (!hostname) return;
  // A network you named keeps the type you gave it.
  await env.DB.prepare("UPDATE visits SET hostname = ?1, host_domain = ?2, kind = CASE WHEN org IS isp THEN ?3 ELSE kind END WHERE pv_id = ?4")
    .bind(hostname, registrableDomain(hostname), classifyNetwork(isp, hostname), pvId)
    .run();
}

// PTR lookup over DNS-over-HTTPS, e.g. 128.2.42.10 -> "wifi-128-2-42-10.wifi.cmu.edu".
async function reverseDns(ip) {
  const name = ptrName(ip);
  if (!name) return null;
  try {
    const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${name}&type=PTR`, {
      headers: { accept: "application/dns-json" },
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const answer = (data.Answer || []).find((a) => a.type === 12 && typeof a.data === "string");
    return answer ? answer.data.replace(/\.$/, "").toLowerCase().slice(0, 253) || null : null;
  } catch {
    return null;
  }
}

function ptrName(ip) {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return `${ip.split(".").reverse().join(".")}.in-addr.arpa`;
  const hex = expandIPv6(ip);
  return hex ? `${hex.split("").reverse().join(".")}.ip6.arpa` : null;
}

function expandIPv6(ip) {
  if (!ip.includes(":") || ip.includes(".")) return null;
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (!groups.every((g) => /^[0-9a-f]{1,4}$/i.test(g))) return null;
  return groups
    .map((g) => g.padStart(4, "0"))
    .join("")
    .toLowerCase();
}

// ---------------------------------------------------------------------------
// Public, aggregated data for the map on the website (city level, no IPs or organizations)

async function publicMap(env) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=900",
  };
  const cached = await env.DB.prepare("SELECT value, updated FROM cache WHERE key = ?1").bind(MAP_CACHE_KEY).first();
  if (cached && Date.now() - Date.parse(cached.updated) < MAP_CACHE_TTL_MS) return new Response(cached.value, { headers });
  return new Response(await refreshMapCache(env), { headers });
}

async function refreshMapCache(env) {
  const [points, totals] = await env.DB.batch([
    env.DB.prepare(
      `SELECT city, country, ROUND(lat, 1) AS lat, ROUND(lon, 1) AS lon, COUNT(*) AS views
       FROM visits WHERE lat IS NOT NULL AND lon IS NOT NULL AND kind IS NOT 'cloud'
       GROUP BY city, country, ROUND(lat, 1), ROUND(lon, 1) ORDER BY views DESC LIMIT 500`
    ),
    env.DB.prepare(
      `SELECT COUNT(*) AS views, COUNT(DISTINCT visitor) AS visitors, COUNT(DISTINCT country) AS countries,
              COUNT(DISTINCT city || '|' || country) AS cities
       FROM visits WHERE kind IS NOT 'cloud'`
    ),
  ]);
  const updated = new Date().toISOString();
  const value = JSON.stringify({ updated, ...totals.results[0], points: points.results });
  await env.DB.prepare(
    "INSERT INTO cache (key, value, updated) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated = excluded.updated"
  )
    .bind(MAP_CACHE_KEY, value, updated)
    .run();
  return value;
}

async function eraseOldIps(env) {
  const days = Number(env.IP_RETENTION_DAYS);
  if (!(days > 0)) return;
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  await env.DB.prepare("UPDATE visits SET ip = NULL WHERE ip IS NOT NULL AND ts < ?1").bind(cutoff).run();
}

// ---------------------------------------------------------------------------
// AI summaries: once a visit is over (30 minutes without activity), an AI model (Gemini, with the GEMINI_API_KEY
// secret) writes in a sentence or two what the visitor was probably trying to do, and guesses who they might be.
// Each visit is sent at most once: after an answer it is never sent again, and visits where nothing happened are
// skipped without a call. When a model can't answer (rate limited, overloaded, too slow), the next one in
// GEMINI_MODELS is asked instead, and the busy one is left out for the rest of the hour's run; when none can,
// nothing is saved and the visit is tried again the next hour. The model sees the network name, city, device, where the
// visitor came from and what they did, never IP addresses, hostnames or visitor ids.

const SUMMARY_DAYS = 30;
const SUMMARY_MODELS = "gemini-3.8-flash,gemini-3.6-flash,gemini-3.5-flash-lite";
const SUMMARY_PROMPT = `You read the log of one visit to a researcher's personal academic website (pages such as home, publications, CV, blog, projects, teaching).

In "summary", say what the visitor was most likely trying to do, in one or two short, plain sentences in the third person ("They ..."), naming the specific papers, pages or files involved. Base it only on the log: long reading means interest, BibTeX means citing, a PDF, arXiv or DOI link means getting the paper, code or GitHub links mean looking for code, the CV and home page mean checking the researcher's background, an email link means trying to get in touch, clicks on things that aren't links or clicks repeated again and again mean they got stuck, and a very short visit is a quick look. Say so when it's unclear. Don't retell the log step by step.

In "who", guess in a few words who the visitor might be (for example a researcher in the same field, a recruiter or hiring manager, a prospective student, a collaborator, a reviewer, someone who knows the researcher, a crawler), from their network, location, where they came from and what they did. In "confidence", say how sure you are of that guess.`;
const SUMMARY_SCHEMA = {
  type: "OBJECT",
  properties: {
    summary: { type: "STRING" },
    who: { type: "STRING" },
    confidence: { type: "STRING", enum: ["low", "medium", "high"] },
  },
  required: ["summary", "who", "confidence"],
};

async function summarizeVisits(env) {
  if (!env.GEMINI_API_KEY) return;
  const calls = clampInt(env.SUMMARIES_PER_RUN, 0, 50, 8);
  if (!calls) return;
  // In order of preference; a model that is busy is dropped from this list for the rest of the run.
  const models = String(env.GEMINI_MODELS || SUMMARY_MODELS)
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  const now = Date.now();
  // Finished visits of the last SUMMARY_DAYS without a summary, newest first.
  const { results: visits } = await env.DB.prepare(
    `WITH pv AS (
       SELECT id, visitor, ts, path, title, duration_s, active_s, scroll_pct, status,
              MAX(julianday(COALESCE(last_ts, ts)), julianday(ts) + COALESCE(duration_s, 0) / 86400.0) AS ends
       FROM visits WHERE ts >= ?1
     ), gaps AS (
       SELECT *, MAX(ends) OVER (PARTITION BY visitor ORDER BY ts, id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS prev_ends FROM pv
     ), numbered AS (
       SELECT *, SUM(CASE WHEN prev_ends IS NULL OR julianday(ts) - prev_ends > ${VISIT_GAP_DAYS} THEN 1 ELSE 0 END)
                   OVER (PARTITION BY visitor ORDER BY ts, id ROWS UNBOUNDED PRECEDING) AS n
       FROM gaps
     ), sessions AS (
       SELECT visitor, n, MIN(id) AS first_id, MAX(ends) AS ends,
              json_group_array(json_object('id', id, 'ts', ts, 'path', path, 'title', title, 'seconds', duration_s, 'active', active_s,
                                           'scroll', scroll_pct, 'status', status)) AS views
       FROM numbered GROUP BY visitor, n
     )
     SELECT s.first_id, s.views, f.ts, f.org, f.kind, f.city, f.region, f.country, f.device, f.os, f.browser, f.lang, f.tz,
            f.referrer, f.ref_host, f.utm_source,
            (SELECT COUNT(DISTINCT date(ts)) FROM visits WHERE visitor = s.visitor AND ts < date(f.ts)) AS earlier_days
     FROM sessions s JOIN visits f ON f.id = s.first_id
     WHERE s.ends < julianday(?2) AND s.first_id NOT IN (SELECT visit_id FROM summaries)
     ORDER BY f.ts DESC LIMIT 100`
  )
    .bind(new Date(now - SUMMARY_DAYS * 86400000).toISOString(), new Date(now - RELOAD_WINDOW_MS).toISOString())
    .all();
  let made = 0;
  for (const visit of visits) {
    if (made >= calls) break;
    const views = JSON.parse(visit.views).sort((a, b) => a.ts.localeCompare(b.ts) || a.id - b.id);
    const { results: events } = await env.DB.prepare(
      `SELECT visit_id, at, type, name, detail, seconds FROM events
       WHERE visit_id IN (${views.map(() => "?").join(",")}) AND type NOT IN ('click', 'scroll') ORDER BY at, id LIMIT 400`
    )
      .bind(...views.map((v) => v.id))
      .all();
    const save = (status, answer = {}) =>
      env.DB.prepare(
        "INSERT OR IGNORE INTO summaries (visit_id, status, summary, who, confidence, model, created) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"
      )
        .bind(
          visit.first_id,
          status,
          answer.summary || null,
          answer.who || null,
          answer.confidence || null,
          answer.model || null,
          new Date().toISOString()
        )
        .run();
    const active = views.reduce((sum, v) => sum + (v.active ?? v.seconds ?? 0), 0);
    // Nothing to say about one page glanced at: no actions, nothing read for more than a few seconds.
    const acted = events.some((e) => e.type !== "seen" && e.type !== "away" && (e.type !== "read" || e.seconds >= 10));
    if (views.length === 1 && active < 10 && !acted) {
      await save("skipped");
      continue;
    }
    made++;
    const log = visitLog(visit, views, events);
    let answer = null;
    while (models.length && !(answer = await askGemini(env, models[0], log))) models.shift();
    if (!answer) return; // every model is busy: tried again next hour
    await save(answer.summary ? "done" : "failed", answer);
  }
}

// One visit as plain text for the model: who, where from, then each page with what happened on it.
function visitLog(visit, views, events) {
  const start = Date.parse(views[0].ts);
  const at = (iso) => {
    const sec = Math.max(0, Math.round((Date.parse(iso) - start) / 1000));
    return `+${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  };
  let local = null;
  try {
    local = visit.tz
      ? new Intl.DateTimeFormat("en-GB", { weekday: "long", hour: "2-digit", minute: "2-digit", timeZone: visit.tz }).format(new Date(start))
      : null;
  } catch {}
  const kind = { academic: " (university / research network)", cloud: " (cloud / VPN / proxy)" }[visit.kind] || "";
  const lines = [
    `Network: ${visit.org || "unknown"}${kind}`,
    `Location: ${[visit.city, visit.region, visit.country].filter(Boolean).join(", ") || "unknown"}`,
    `Device: ${[visit.device, visit.os, visit.browser, visit.lang].filter(Boolean).join(", ")}`,
    `Came from: ${visit.ref_host ? visit.referrer || visit.ref_host : visit.utm_source ? `a link tagged utm_source=${visit.utm_source}` : "nowhere (typed in, a bookmark, or an app)"}`,
    `Visitor's local time: ${local || "unknown"}`,
    `Earlier visits: ${visit.earlier_days ? `on ${visit.earlier_days} earlier day(s)` : "none recorded"}`,
    "Pages, in the order they were opened (times since the visit started):",
  ];
  views.forEach((v, i) => {
    const page = v.status === 404 ? `a page that doesn't exist (${v.path})` : `${v.title || v.path} (${v.path})`;
    const time = v.seconds == null ? "time unknown" : `${v.seconds} s on screen, ${v.active ?? v.seconds} s of it active`;
    lines.push(`${i + 1}. ${at(v.ts)} ${page}: ${time}${v.scroll != null ? `, scrolled ${v.scroll}% down` : ""}`);
    const seen = [];
    for (const e of events) {
      if (e.visit_id !== v.id) continue;
      if (e.type === "seen") seen.push(e.name);
      else {
        const detail = e.detail && e.detail[0] !== "{" ? ` [${e.detail.slice(0, 150)}]` : "";
        const label =
          e.type === "read" ? `read "${e.name}" for ${e.seconds} s` : e.type === "away" ? `switched to another tab for ${e.seconds} s` : e.name;
        lines.push(`   ${at(e.at)} ${e.type}: ${label}${detail}`);
      }
    }
    if (seen.length) lines.push(`   papers that came into view: ${seen.join("; ")}`);
  });
  return lines.join("\n").slice(0, 12000);
}

// { summary, who, confidence, model } from the model; { model } when its answer can't be used; null when it
// couldn't answer at all (rate limited, overloaded, too slow), so another model or a later run can be tried.
async function askGemini(env, model, log) {
  let res;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SUMMARY_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: log }] }],
        // A short summary needs little reasoning: less thinking is faster and uses fewer tokens.
        generationConfig: {
          temperature: 0.3,
          responseMimeType: "application/json",
          responseSchema: SUMMARY_SCHEMA,
          thinkingConfig: { thinkingLevel: "low" },
        },
      }),
      signal: AbortSignal.timeout(60000),
    });
  } catch (err) {
    console.error(`summary: no answer from ${model}`, err);
    return null;
  }
  if (!res.ok) {
    console.error(`summary: ${model} said ${res.status}`, (await res.text()).slice(0, 300));
    return null;
  }
  try {
    const data = await res.json();
    const text = (data.candidates?.[0]?.content?.parts || []).map((part) => part.text || "").join("");
    const answer = JSON.parse(text);
    return {
      summary: str(answer.summary, 700),
      who: str(answer.who, 200),
      confidence: ["low", "medium", "high"].includes(answer.confidence) ? answer.confidence : null,
      model,
    };
  } catch (err) {
    console.error("summary: unusable answer", err);
    return { model };
  }
}

// ---------------------------------------------------------------------------
// Private dashboard API, used by the /visitors/ page on the website.
// The password is never stored: the DASHBOARD_PASSWORD_HASH secret holds only a salted PBKDF2 hash
// (made by `npm run password`). Signing in returns a token that is valid for 30 days.

const PRIVATE_HEADERS = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

function dashboardUrl(env) {
  const site = allowedOrigins(env)[0];
  return env.DASHBOARD_URL || (site ? `${site}/visitors/` : "");
}

async function dashboardApi(request, env, url) {
  // The dashboard page lives on the website's own domain, so its requests are cross-origin.
  const origin = request.headers.get("Origin");
  const cors = allowedOrigins(env).includes(origin)
    ? {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Allow-Methods": "GET, POST, DELETE",
        "Access-Control-Expose-Headers": "Content-Disposition",
        "Access-Control-Max-Age": "86400",
        Vary: "Origin",
      }
    : { Vary: "Origin" };
  let response;
  try {
    response = request.method === "OPTIONS" ? new Response(null, { status: 204 }) : await dashboardResponse(request, env, url);
  } catch (err) {
    // Errors also need the CORS headers, or the browser hides them behind a generic "CORS" failure.
    console.error(err);
    response = json({ error: "Server error" }, 500);
  }
  for (const [name, value] of Object.entries(cors)) response.headers.set(name, value);
  return response;
}

async function dashboardResponse(request, env, url) {
  if (!env.DASHBOARD_PASSWORD_HASH) return json({ error: "No dashboard password is set yet. Run: npm run password (in visit-tracker/)" }, 503);
  if (url.pathname === "/api/login") return login(request, env);
  if (!(await validSession(request, env))) return json({ error: "Please sign in again." }, 401);
  if (url.pathname === "/api/labels") return labelsApi(request, env, url);
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const params = url.searchParams;
  switch (url.pathname) {
    case "/api/summary":
      return json(await summary(env, params));
    case "/api/visits":
      return json(await visitList(env, params));
    case "/api/live":
      return json(await live(env));
    case "/api/export.csv":
      return exportCsv(env, params);
    case "/api/events":
      return json(await visitEvents(env, params));
    case "/api/visitor":
      return json(await visitorHistory(env, params));
    case "/api/sessions":
      return json(await sessionList(env, params));
    case "/api/insights":
      return insights(env, params);
    case "/api/clicks":
      return json(await clickMap(env, params));
  }
  return json({ error: "Not found" }, 404);
}

async function login(request, env) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (await rateLimited(env.LOGIN_LIMITER, request.headers.get("CF-Connecting-IP") || "unknown")) {
    return json({ error: "Too many attempts. Wait a minute and try again." }, 429);
  }
  const body = await readJson(request);
  if (typeof body?.password !== "string" || !(await passwordMatches(body.password, env.DASHBOARD_PASSWORD_HASH))) {
    return json({ error: "Wrong password." }, 401);
  }
  return json({ token: await signSession(env, Date.now() + SESSION_MS) });
}

// Stored format: "pbkdf2-sha256:<iterations>:<salt, base64>:<hash, base64>".
async function passwordMatches(password, stored) {
  const [scheme, iterationsText, salt, hash] = String(stored).split(":");
  const iterations = Number(iterationsText);
  if (scheme !== "pbkdf2-sha256" || !(iterations > 0 && iterations <= 100000) || !salt || !hash) return false;
  const expected = base64ToBytes(hash);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: base64ToBytes(salt), iterations }, key, expected.length * 8);
  return crypto.subtle.timingSafeEqual(new Uint8Array(bits), expected);
}

// Session tokens are "<expiry ms>.<HMAC>", keyed on the password hash, so changing the password signs everyone out.
async function sessionKey(env) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`session:${env.DASHBOARD_PASSWORD_HASH}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

async function signSession(env, expires) {
  const signature = await crypto.subtle.sign("HMAC", await sessionKey(env), new TextEncoder().encode(String(expires)));
  return `${expires}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

async function validSession(request, env) {
  const match = /^Bearer (\d{13})\.([\w-]{43})$/.exec(request.headers.get("Authorization") || "");
  if (!match || Number(match[1]) < Date.now()) return false;
  return crypto.subtle.verify("HMAC", await sessionKey(env), base64ToBytes(match[2]), new TextEncoder().encode(match[1]));
}

function buildFilter(params) {
  const now = Date.now();
  const to = parseDate(params.get("to")) || new Date(now + 60000);
  const from = parseDate(params.get("from")) || new Date(now - 30 * 86400000);
  const clauses = ["ts >= ?", "ts < ?"];
  const args = [from.toISOString(), to.toISOString()];

  const network = params.get("network");
  if (network === "academic") clauses.push("kind = 'academic'");
  else if (network === "people") clauses.push("kind IS NOT 'cloud'");

  for (const field of FILTER_FIELDS) {
    if (!params.has(field)) continue;
    const value = params.get(field);
    if (value === "") clauses.push(`${field} IS NULL`);
    else {
      clauses.push(`${field} = ?`);
      args.push(value);
    }
  }

  // Visits during which something happened, e.g. ?event=Downloaded cv.pdf
  if (params.get("event")) {
    clauses.push("id IN (SELECT visit_id FROM events WHERE name = ?)");
    args.push(params.get("event").slice(0, 150));
  }

  const q = (params.get("q") || "").trim().slice(0, 100);
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    clauses.push(`(${SEARCH_FIELDS.map((c) => `${c} LIKE ? ESCAPE '\\'`).join(" OR ")})`);
    args.push(...SEARCH_FIELDS.map(() => like));
  }
  return { where: clauses.join(" AND "), args, from, to };
}

async function summary(env, params) {
  const { where, args, from, to } = buildFilter(params);
  const offset = clampInt(params.get("tz"), -840, 840, 0); // viewer's minutes east of UTC, for day buckets
  const modifier = `${offset >= 0 ? "+" : ""}${offset} minutes`;
  const span = to - from;
  const bucket = span <= 2 * 86400000 ? "hour" : span <= 120 * 86400000 ? "day" : "week";
  const bucketSql = {
    hour: "strftime('%Y-%m-%dT%H:00', ts, ?)",
    day: "date(ts, ?)",
    week: "date(ts, ?, 'weekday 0', '-6 days')",
  }[bucket];
  const stmt = (sql, ...before) => env.DB.prepare(sql).bind(...before, ...args);

  // Events of the visits in the selection.
  const ofVisits = `FROM events e JOIN (SELECT id, visitor, path, title FROM visits WHERE ${where}) v ON v.id = e.visit_id`;
  const [totals, timeline, places, pages, referrers, devices, actions, reading, missing, errors] = await env.DB.batch([
    stmt(
      `SELECT COUNT(*) AS views, COUNT(DISTINCT visitor) AS visitors, COUNT(DISTINCT country) AS countries,
              COUNT(DISTINCT org) AS orgs, COUNT(DISTINCT CASE WHEN kind = 'academic' THEN org END) AS academic_orgs,
              COUNT(CASE WHEN kind = 'academic' THEN 1 END) AS academic_views,
              AVG(duration_s) AS avg_duration, AVG(active_s) AS avg_active, MIN(ts) AS first_ts, MAX(ts) AS last_ts,
              COUNT(scroll_pct) AS scrolled_views, AVG(scroll_pct) AS avg_scroll,
              COUNT(CASE WHEN scroll_pct >= 25 THEN 1 END) AS scroll_25, COUNT(CASE WHEN scroll_pct >= 50 THEN 1 END) AS scroll_50,
              COUNT(CASE WHEN scroll_pct >= 75 THEN 1 END) AS scroll_75, COUNT(CASE WHEN scroll_pct >= 100 THEN 1 END) AS scroll_100,
              COUNT(CASE WHEN status = 404 THEN 1 END) AS missing_views
       FROM visits WHERE ${where}`
    ),
    stmt(
      `SELECT ${bucketSql} AS bucket, COUNT(*) AS views, COUNT(DISTINCT visitor) AS visitors
       FROM visits WHERE ${where} GROUP BY bucket ORDER BY bucket`,
      modifier
    ),
    stmt(
      `SELECT country, region, city, lat, lon, org, kind, MAX(host_domain) AS host_domain,
              COUNT(*) AS views, COUNT(DISTINCT visitor) AS visitors, MAX(ts) AS last_ts
       FROM visits WHERE ${where}
       GROUP BY country, region, city, lat, lon, org, kind ORDER BY views DESC LIMIT 5000`
    ),
    stmt(
      `SELECT path, MAX(title) AS title, COUNT(*) AS views, COUNT(DISTINCT visitor) AS visitors, AVG(duration_s) AS avg_duration,
              AVG(scroll_pct) AS avg_scroll
       FROM visits WHERE ${where} GROUP BY path ORDER BY views DESC LIMIT 50`
    ),
    stmt(
      `SELECT ref_host, COUNT(*) AS views, COUNT(DISTINCT visitor) AS visitors
       FROM visits WHERE ${where} AND ref_host IS NOT NULL GROUP BY ref_host ORDER BY views DESC LIMIT 50`
    ),
    stmt(
      `SELECT device, os, browser, COUNT(*) AS views, COUNT(DISTINCT visitor) AS visitors
       FROM visits WHERE ${where} GROUP BY device, os, browser ORDER BY views DESC LIMIT 50`
    ),
    // What visitors did (downloads, links to other sites, videos, figures, …). Scrolling is in the totals, reading
    // and errors have their own lists, and time away and links within the site stay with each visit.
    stmt(
      `SELECT e.type, e.name, COUNT(*) AS views, COUNT(DISTINCT v.visitor) AS visitors ${ofVisits}
       WHERE e.type NOT IN ('scroll', 'read', 'away', 'link', 'error', 'seen', 'search', 'click', 'rage', 'dead')
       GROUP BY e.type, e.name ORDER BY views DESC LIMIT 100`
    ),
    // What was read: papers and sections, how often and for how long.
    stmt(
      `SELECT e.name, COUNT(*) AS views, COUNT(DISTINCT v.visitor) AS visitors, AVG(e.seconds) AS avg_seconds,
              COUNT(DISTINCT v.path) AS pages, MAX(v.path) AS path, MAX(v.title) AS title ${ofVisits}
       WHERE e.type = 'read' GROUP BY e.name ORDER BY views DESC, avg_seconds DESC LIMIT 100`
    ),
    // Broken links: pages that don't exist, and where people found the link.
    stmt(
      `SELECT path, referrer, ref_host, COUNT(*) AS views, COUNT(DISTINCT visitor) AS visitors
       FROM visits WHERE ${where} AND status = 404 GROUP BY path, referrer ORDER BY views DESC LIMIT 50`
    ),
    // JavaScript errors on the pages.
    stmt(
      `SELECT e.name, MAX(e.detail) AS detail, COUNT(*) AS views, COUNT(DISTINCT v.visitor) AS visitors ${ofVisits}
       WHERE e.type = 'error' GROUP BY e.name ORDER BY views DESC LIMIT 50`
    ),
  ]);

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    bucket,
    totals: totals.results[0],
    timeline: timeline.results,
    places: places.results,
    pages: pages.results,
    referrers: referrers.results,
    devices: devices.results,
    actions: actions.results,
    reading: reading.results,
    missing: missing.results,
    errors: errors.results,
  };
}

async function visitList(env, params) {
  const { where, args } = buildFilter(params);
  const limit = clampInt(params.get("limit"), 1, 200, 50);
  const offset = clampInt(params.get("offset"), 0, 1e7, 0);
  const { results } = await env.DB.prepare(`SELECT ${VISIT_COLUMNS} FROM visits WHERE ${where} ORDER BY ts DESC, id DESC LIMIT ? OFFSET ?`)
    .bind(...args, limit + 1, offset)
    .all();
  const visits = results.slice(0, limit);
  await Promise.all([addEvents(env, visits), addReturning(env, visits)]);
  return { visits, more: results.length > limit };
}

// The first LIST_EVENTS things each visitor did on the page, and how many there were in all.
async function addEvents(env, visits) {
  if (!visits.length) return;
  const byVisit = new Map(visits.map((v) => [v.id, []]));
  const ids = [...byVisit.keys()];
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    const { results } = await env.DB.prepare(
      `SELECT visit_id, at, type, name, detail, seconds FROM events
       WHERE visit_id IN (${chunk.map(() => "?").join(",")}) AND type NOT IN ${QUIET_EVENTS} ORDER BY at, id`
    )
      .bind(...chunk)
      .all();
    for (const e of results) byVisit.get(e.visit_id).push(e);
  }
  for (const v of visits) {
    const events = byVisit.get(v.id);
    v.events = events.slice(0, LIST_EVENTS);
    v.event_count = events.length;
  }
}

// For each visitor: on how many days they came, and when they first came (to mark returning visitors).
async function addReturning(env, rows) {
  const visitors = [...new Set(rows.map((v) => v.visitor).filter(Boolean))];
  const byVisitor = new Map();
  for (let i = 0; i < visitors.length; i += 90) {
    const chunk = visitors.slice(i, i + 90);
    const { results } = await env.DB.prepare(
      `SELECT visitor, COUNT(DISTINCT date(ts)) AS days, MIN(ts) AS first_ts FROM visits
       WHERE visitor IN (${chunk.map(() => "?").join(",")}) GROUP BY visitor`
    )
      .bind(...chunk)
      .all();
    for (const r of results) byVisitor.set(r.visitor, r);
  }
  for (const v of rows) {
    const r = byVisitor.get(v.visitor);
    v.visitor_days = r ? r.days : 1;
    v.visitor_first = r ? r.first_ts : v.ts;
  }
}

// Everything a visitor did on one page: ?visit=<visit id>
async function visitEvents(env, params) {
  const id = clampInt(params.get("visit"), 1, Number.MAX_SAFE_INTEGER, 0);
  const { results } = await env.DB.prepare(
    "SELECT at, type, name, detail, seconds FROM events WHERE visit_id = ?1 AND type <> 'click' ORDER BY at, id LIMIT 500"
  )
    .bind(id)
    .all();
  return { events: results };
}

// A visitor's history around one visit: ?visitor=<id>&around=<ISO time>. Their page views within 12 hours either
// side (the dashboard joins them into visits) with everything they did on each, how often they came overall, and
// their last page view before that.
async function visitorHistory(env, params) {
  const visitor = params.get("visitor") || "";
  if (!/^[0-9a-f]{16}$/.test(visitor)) return { history: null, views: [] };
  const around = parseDate(params.get("around")) || new Date();
  const from = new Date(around - 43200000).toISOString();
  const to = new Date(+around + 43200000).toISOString();
  const [history, views, events, summaries] = await env.DB.batch([
    env.DB.prepare(
      `SELECT COUNT(*) AS views, COUNT(DISTINCT date(ts)) AS days, MIN(ts) AS first_ts, MAX(ts) AS last_ts,
              (SELECT MAX(ts) FROM visits WHERE visitor = ?1 AND ts < ?2) AS earlier_ts
       FROM visits WHERE visitor = ?1`
    ).bind(visitor, from),
    env.DB.prepare(
      `SELECT id, ts, last_ts, path, title, duration_s, active_s, scroll_pct, reloads, status, referrer, ref_host
       FROM visits WHERE visitor = ?1 AND ts >= ?2 AND ts <= ?3 ORDER BY ts, id LIMIT 300`
    ).bind(visitor, from, to),
    env.DB.prepare(
      `SELECT e.visit_id, e.at, e.type, e.name, e.detail, e.seconds FROM events e JOIN visits v ON v.id = e.visit_id
       WHERE v.visitor = ?1 AND v.ts >= ?2 AND v.ts <= ?3 AND e.type <> 'click' ORDER BY e.at, e.id LIMIT 3000`
    ).bind(visitor, from, to),
    env.DB.prepare(
      `SELECT a.visit_id, a.summary, a.who, a.confidence, a.model FROM summaries a JOIN visits v ON v.id = a.visit_id
       WHERE v.visitor = ?1 AND v.ts >= ?2 AND v.ts <= ?3 AND a.status = 'done'`
    ).bind(visitor, from, to),
  ]);
  return { history: history.results[0], views: views.results, events: events.results, summaries: summaries.results };
}

// Whole visits: a visitor's page views with gaps of less than 30 minutes form one visit. A visit is listed when
// any of its pages matches the filters, so ?path=/cv/ lists whole visits that included the CV. Newest first.
async function sessionList(env, params) {
  const { where, args, from, to } = buildFilter(params);
  const limit = clampInt(params.get("limit"), 1, 90, 50);
  const offset = clampInt(params.get("offset"), 0, 1e7, 0);
  const { results } = await env.DB.prepare(
    `WITH pv AS (
       SELECT id, visitor, ts, path, title, duration_s, status, CASE WHEN ${where} THEN 1 ELSE 0 END AS matched,
              MAX(julianday(COALESCE(last_ts, ts)), julianday(ts) + COALESCE(duration_s, 0) / 86400.0) AS ends
       FROM visits WHERE ts >= ? AND ts < ?
     ), gaps AS (
       SELECT *, MAX(ends) OVER (PARTITION BY visitor ORDER BY ts, id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS prev_ends FROM pv
     ), numbered AS (
       SELECT *, SUM(CASE WHEN prev_ends IS NULL OR julianday(ts) - prev_ends > ${VISIT_GAP_DAYS} THEN 1 ELSE 0 END)
                   OVER (PARTITION BY visitor ORDER BY ts, id ROWS UNBOUNDED PRECEDING) AS n
       FROM gaps
     ), sessions AS (
       SELECT visitor, n, MIN(ts) AS start, MIN(id) AS first_id, COUNT(*) AS pages, SUM(duration_s) AS seconds,
              json_group_array(json_object('id', id, 'ts', ts, 'path', path, 'title', title, 'seconds', duration_s, 'status', status)) AS views
       FROM numbered GROUP BY visitor, n HAVING MAX(matched) = 1
     )
     SELECT s.start, s.first_id, s.pages, s.seconds, s.views, f.visitor, f.org, f.isp, f.asn, f.kind, f.hostname, f.host_domain,
            f.city, f.region, f.postal, f.country, f.tz, f.referrer, f.ref_host, f.utm_source, f.device, f.os, f.browser, f.screen, f.lang,
            a.summary AS ai_summary, a.who AS ai_who, a.confidence AS ai_confidence, a.model AS ai_model
     FROM sessions s JOIN visits f ON f.id = s.first_id LEFT JOIN summaries a ON a.visit_id = s.first_id AND a.status = 'done'
     ORDER BY s.start DESC, s.first_id DESC LIMIT ? OFFSET ?`
  )
    .bind(...args, from.toISOString(), to.toISOString(), limit + 1, offset)
    .all();
  const sessions = results.slice(0, limit).map((s) => ({ ...s, views: JSON.parse(s.views).sort((a, b) => a.ts.localeCompare(b.ts) || a.id - b.id) }));
  await addReturning(env, sessions);
  return { sessions, more: results.length > limit };
}

// What visitors were after, worked out by the dashboard from their whole visits: each visit with its pages and
// everything done on them (papers scrolled past and clicks are only counted). Newest first, at most
// MAX_INSIGHT_VISITS. The database builds the JSON, so the Worker only joins it.
async function insights(env, params) {
  const { where, args, from, to } = buildFilter(params);
  const [visits, seen] = await env.DB.batch([
    env.DB.prepare(
      `WITH pv AS (
         SELECT id, visitor, ts, path, title, duration_s, active_s, scroll_pct, status, CASE WHEN ${where} THEN 1 ELSE 0 END AS matched,
                MAX(julianday(COALESCE(last_ts, ts)), julianday(ts) + COALESCE(duration_s, 0) / 86400.0) AS ends
         FROM visits WHERE ts >= ? AND ts < ?
       ), gaps AS (
         SELECT *, MAX(ends) OVER (PARTITION BY visitor ORDER BY ts, id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS prev_ends FROM pv
       ), numbered AS (
         SELECT *, SUM(CASE WHEN prev_ends IS NULL OR julianday(ts) - prev_ends > ${VISIT_GAP_DAYS} THEN 1 ELSE 0 END)
                     OVER (PARTITION BY visitor ORDER BY ts, id ROWS UNBOUNDED PRECEDING) AS n
         FROM gaps
       ), ev AS (
         SELECT visit_id, json_group_array(json_array(type, name, detail, seconds, at)) AS list
         FROM (SELECT visit_id, type, name, detail, seconds, at FROM events
               WHERE visit_id IN (SELECT id FROM numbered) AND type NOT IN ${QUIET_EVENTS} ORDER BY at, id)
         GROUP BY visit_id
       ), sessions AS (
         SELECT visitor, n, MIN(ts) AS start, MIN(id) AS first_id,
                json_group_array(json_array(id, ts, path, title, duration_s, active_s, scroll_pct, status, json(COALESCE(ev.list, '[]')))) AS views
         FROM numbered LEFT JOIN ev ON ev.visit_id = numbered.id
         GROUP BY visitor, n HAVING MAX(matched) = 1
       )
       SELECT json_object('start', s.start, 'visitor', s.visitor, 'views', json(s.views), 'org', f.org, 'isp', f.isp, 'kind', f.kind,
                          'hostname', f.hostname, 'city', f.city, 'region', f.region, 'country', f.country, 'referrer', f.referrer,
                          'ref_host', f.ref_host, 'utm', f.utm_source, 'device', f.device, 'os', f.os, 'browser', f.browser,
                          'screen', f.screen, 'lang', f.lang, 'tz', f.tz,
                          'ai', json((SELECT json_object('summary', summary, 'who', who, 'confidence', confidence, 'model', model) FROM summaries
                                      WHERE visit_id = s.first_id AND status = 'done'))) AS visit
       FROM sessions s JOIN visits f ON f.id = s.first_id
       ORDER BY s.start DESC, s.first_id DESC LIMIT ${MAX_INSIGHT_VISITS + 1}`
    ).bind(...args, from.toISOString(), to.toISOString()),
    // Papers and sections that scrolled into view, and by how many visitors.
    env.DB.prepare(
      `SELECT e.name, COUNT(*) AS views, COUNT(DISTINCT v.visitor) AS visitors
       FROM events e JOIN (SELECT id, visitor FROM visits WHERE ${where}) v ON v.id = e.visit_id
       WHERE e.type = 'seen' GROUP BY e.name`
    ).bind(...args),
  ]);
  const rows = visits.results.slice(0, MAX_INSIGHT_VISITS).map((r) => r.visit);
  return new Response(`{"visits":[${rows.join(",")}],"more":${visits.results.length > MAX_INSIGHT_VISITS},"seen":${JSON.stringify(seen.results)}}`, {
    headers: { ...PRIVATE_HEADERS, "Content-Type": "application/json; charset=utf-8" },
  });
}

// Where visitors clicked, for the click map: ?path=<page> (with the usual filters) gives that page's clicks, and
// without a page, the pages that have any.
async function clickMap(env, params) {
  const { where, args } = buildFilter(params);
  const of = `FROM events e JOIN (SELECT id, path, device FROM visits WHERE ${where}) v ON v.id = e.visit_id WHERE e.type IN ('click', 'rage', 'dead')`;
  if (!params.has("path")) {
    const { results } = await env.DB.prepare(`SELECT v.path, COUNT(*) AS clicks ${of} GROUP BY v.path ORDER BY clicks DESC LIMIT 100`)
      .bind(...args)
      .all();
    return { pages: results };
  }
  const { results } = await env.DB.prepare(`SELECT e.type, e.name, e.detail, v.device ${of} ORDER BY e.id DESC LIMIT 5000`)
    .bind(...args)
    .all();
  return { clicks: results };
}

async function live(env) {
  const since = new Date(Date.now() - 5 * 60000).toISOString();
  const dayAgo = new Date(Date.now() - 86400000).toISOString();
  const [now, last] = await env.DB.batch([
    // A reload only updates last_ts, so count visits opened *or reloaded* in the last 5 minutes.
    env.DB.prepare("SELECT COUNT(DISTINCT visitor) AS visitors FROM visits WHERE ts >= ?2 AND COALESCE(last_ts, ts) >= ?1").bind(since, dayAgo),
    env.DB.prepare("SELECT MAX(id) AS last_id FROM visits"),
  ]);
  return { visitors: now.results[0].visitors, last_id: last.results[0].last_id };
}

async function exportCsv(env, params) {
  const { where, args } = buildFilter(params);
  const { results } = await env.DB.prepare(`SELECT ${VISIT_COLUMNS} FROM visits WHERE ${where} ORDER BY ts DESC LIMIT 100000`)
    .bind(...args)
    .all();
  const columns = VISIT_COLUMNS.split(", ");
  const lines = [columns.join(","), ...results.map((row) => columns.map((c) => csvCell(row[c])).join(","))];
  return new Response(lines.join("\r\n"), {
    headers: {
      ...PRIVATE_HEADERS,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="visits-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}

// ---------------------------------------------------------------------------
// Network labels: your own names for networks that public records only list under their
// internet provider (e.g. a campus whose addresses are registered to Etisalat).

let labelCache = { at: 0, labels: [] };

async function loadLabels(env, fresh = false) {
  if (fresh || Date.now() - labelCache.at > LABEL_CACHE_MS) {
    const { results } = await env.DB.prepare("SELECT prefix, name, kind, created FROM network_labels").all();
    const labels = results.map((l) => ({ ...l, range: parsePrefix(l.prefix) })).filter((l) => l.range);
    // Most specific first, so a single address wins over the range around it.
    labels.sort((a, b) => b.range.bits - a.range.bits);
    labelCache = { at: Date.now(), labels };
  }
  return labelCache.labels;
}

function labelFor(labels, ip) {
  const addr = parseIp(ip);
  return addr ? labels.find((l) => inRange(addr, l.range)) || null : null;
}

async function labelsApi(request, env, url) {
  if (request.method === "GET") return json({ labels: (await loadLabels(env, true)).map(({ range, ...label }) => label) });

  if (request.method === "POST") {
    const body = await readJson(request);
    const range = parsePrefix(body?.prefix);
    const name = str(body?.name, 120);
    if (!range || !name) {
      return json({ error: "Give a name and an IP address or range, e.g. 5.195.0.145 or 5.195.0.0/24 (at most a /16)." }, 400);
    }
    const kind = LABEL_KINDS.includes(body.kind) ? body.kind : "other";
    await env.DB.prepare(
      "INSERT INTO network_labels (prefix, name, kind, created) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(prefix) DO UPDATE SET name = excluded.name, kind = excluded.kind"
    )
      .bind(range.text, name, kind, new Date().toISOString())
      .run();
    return json({ prefix: range.text, updated: await relabel(env, range) });
  }

  if (request.method === "DELETE") {
    const range = parsePrefix(url.searchParams.get("prefix"));
    if (!range) return json({ error: "Unknown range" }, 400);
    await env.DB.prepare("DELETE FROM network_labels WHERE prefix = ?1").bind(range.text).run();
    return json({ updated: await relabel(env, range) });
  }
  return json({ error: "Method not allowed" }, 405);
}

// After a label is added or removed, re-applies the best matching label to stored visits inside `range`.
async function relabel(env, range) {
  const labels = await loadLabels(env, true);
  const { results } = await env.DB.prepare("SELECT id, ip, isp, org, kind, hostname FROM visits WHERE ip IS NOT NULL").all();
  const updates = [];
  for (const v of results) {
    const addr = parseIp(v.ip);
    if (!addr || !inRange(addr, range)) continue;
    const label = labelFor(labels, v.ip);
    const org = label ? label.name : v.isp;
    const kind = label ? label.kind : classifyNetwork(v.isp, v.hostname);
    if (org !== v.org || kind !== v.kind) {
      updates.push(env.DB.prepare("UPDATE visits SET org = ?1, kind = ?2 WHERE id = ?3").bind(org, kind, v.id));
    }
  }
  for (let i = 0; i < updates.length; i += 100) await env.DB.batch(updates.slice(i, i + 100));
  return updates.length;
}

function parseIp(ip) {
  if (typeof ip !== "string") return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    const parts = ip.split(".").map(Number);
    if (parts.some((n) => n > 255)) return null;
    return { v: 4, n: parts.reduce((acc, n) => (acc << 8n) | BigInt(n), 0n) };
  }
  const hex = expandIPv6(ip);
  return hex ? { v: 6, n: BigInt(`0x${hex}`) } : null;
}

// "5.195.0.145" or "5.195.0.0/24" (IPv4 down to /16, IPv6 down to /32).
function parsePrefix(prefix) {
  if (typeof prefix !== "string") return null;
  const [base, bitsText, extra] = prefix.trim().toLowerCase().split("/");
  const addr = parseIp(base);
  if (!addr || extra !== undefined) return null;
  const size = addr.v === 4 ? 32 : 128;
  const bits = bitsText === undefined ? size : /^\d{1,3}$/.test(bitsText) ? Number(bitsText) : NaN;
  if (!(bits >= (addr.v === 4 ? 16 : 32) && bits <= size)) return null;
  const shift = BigInt(size - bits);
  const network = (addr.n >> shift) << shift;
  // Store IPv4 ranges by their first address, so 5.195.0.145/24 and 5.195.0.0/24 are the same label.
  const start = addr.v === 4 ? [24n, 16n, 8n, 0n].map((s) => Number((network >> s) & 255n)).join(".") : base;
  return { v: addr.v, n: network, bits, size, text: bits === size ? base : `${start}/${bits}` };
}

function inRange(addr, range) {
  if (addr.v !== range.v) return false;
  const shift = BigInt(range.size - range.bits);
  return addr.n >> shift === range.n >> shift;
}

// ---------------------------------------------------------------------------
// Helpers

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim().replace(/\/$/, ""))
    .filter((s) => URL.canParse(s));
}

async function rateLimited(limiter, key) {
  if (!limiter) return false;
  try {
    const { success } = await limiter.limit({ key });
    return !success;
  } catch {
    return false;
  }
}

function base64ToBytes(text) {
  return Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
}

function bytesToBase64Url(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function readJson(request) {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

function str(value, max) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

function coordinate(value) {
  const n = Number(value);
  return value != null && value !== "" && Number.isFinite(n) ? n : null;
}

function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function csvCell(value) {
  if (value == null) return "";
  let s = String(value);
  // Stop spreadsheet apps from treating visitor-supplied text (titles, referrers) as formulas.
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function sha256(text) {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
}

async function sha256Hex(text) {
  return [...new Uint8Array(await sha256(text))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function empty(status) {
  return new Response(null, { status });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...PRIVATE_HEADERS, "Content-Type": "application/json; charset=utf-8" },
  });
}
