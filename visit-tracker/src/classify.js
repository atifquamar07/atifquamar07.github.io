// Heuristics that turn raw request data into readable labels.

const BOT_UA =
  /bot\b|bot\/|crawl|spider|slurp|scrape|headless|lighthouse|pagespeed|gtmetrix|pingdom|uptime|python|curl\/|wget|httpclient|okhttp|java\/|go-http|axios|node-fetch|phantomjs|selenium|puppeteer|playwright|facebookexternalhit|embedly|whatsapp|bingpreview|google-inspectiontool/i;

export function isBot(userAgent) {
  return BOT_UA.test(userAgent);
}

export function parseUserAgent(ua) {
  const device = /iPad|Tablet|PlayBook|Silk|Android(?!.*Mobile)/i.test(ua)
    ? "tablet"
    : /Mobi|iPhone|iPod|Android|Windows Phone/i.test(ua)
      ? "mobile"
      : "desktop";
  const os = /Windows NT|Windows Phone/i.test(ua)
    ? "Windows"
    : /iPhone|iPad|iPod/i.test(ua)
      ? "iOS"
      : /Mac OS X|Macintosh/i.test(ua)
        ? "macOS"
        : /Android/i.test(ua)
          ? "Android"
          : /CrOS/i.test(ua)
            ? "ChromeOS"
            : /Linux/i.test(ua)
              ? "Linux"
              : "Other";
  const browser = /Edg(e|A|iOS)?\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /SamsungBrowser/.test(ua)
        ? "Samsung Internet"
        : /Firefox\/|FxiOS/.test(ua)
          ? "Firefox"
          : /Chrome\/|CriOS/.test(ua)
            ? "Chrome"
            : /Safari\//.test(ua)
              ? "Safari"
              : "Other";
  return { device, os, browser };
}

// Universities, research institutes and national research & education networks (NRENs).
const ACADEMIC_ORG = new RegExp(
  [
    "universit",
    "univ\\.",
    "college",
    "institut",
    "istituto",
    "politecnic",
    "polytechn",
    "hochschule",
    "[eé]cole",
    "school of",
    "academy of",
    "academia",
    "research (center|centre|institute|council|organi[sz]ation)",
    "laborator",
    "national lab",
    "max[- ]planck",
    "fraunhofer",
    "helmholtz",
    "\\bcnrs\\b",
    "\\binria\\b",
    "\\bcsiro\\b",
    "\\briken\\b",
    "a\\*star",
    "\\bcern\\b",
    "\\bnasa\\b",
    "\\bkaust\\b",
    "\\bmbzuai\\b",
    "education and research",
    "research and education",
    "educational (and research )?network",
    "\\b(renater|janet|jisc|dfn|g[eé]ant|internet2|aarnet|cernet|garr|rediris|sinet|kreonet|uninett|sikt|nordunet|funet|belnet|ankabut|esnet|canarie|heanet|cesnet|grnet|sunet|surfnet|arnes|ernet|redclara|tein)\\b",
    "^switch$",
    "^surf( b\\.?v\\.?)?$",
  ].join("|"),
  "i"
);

const ACADEMIC_HOST = /(^|\.)(edu|ac\.[a-z]{2}|edu\.[a-z]{2})$|eduroam|(^|\.)uni-[a-z-]+\.de$/i;

// Data centres, CDNs, VPNs and proxies: the location is the server's, not the person's.
const CLOUD_ORG =
  /amazon|\baws\b|google cloud|azure|digitalocean|linode|akamai|\bovh|hetzner|vultr|choopa|constant company|contabo|leaseweb|scaleway|online s\.a\.s|\bm247\b|datacamp|cdn77|oracle|alibaba|tencent|huawei cloud|hostinger|\bionos\b|hostwinds|colocrossing|psychz|quadranet|zenlayer|g-core|gcore|cloudflare|fastly|data ?cent(er|re)|hosting|\bvps\b|kamatera|clouvider|datapacket|zscaler|private internet access|nordvpn|expressvpn|surfshark|proton ?ag|mullvad|tefincom|packethub/i;

export function classifyNetwork(org, hostname) {
  if ((org && ACADEMIC_ORG.test(org)) || (hostname && ACADEMIC_HOST.test(hostname))) return "academic";
  if (org && CLOUD_ORG.test(org)) return "cloud";
  return "other";
}

// Second-level labels that sit under a country code, as in cam.ac.uk or unimelb.edu.au.
const SECOND_LEVEL = new Set(["ac", "edu", "co", "com", "net", "org", "gov", "go", "or", "ne", "mil", "res", "sch", "gob", "gouv"]);

export function registrableDomain(hostname) {
  const labels = hostname.toLowerCase().split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".");
  const tld = labels[labels.length - 1];
  const sld = labels[labels.length - 2];
  return labels.slice(tld.length === 2 && SECOND_LEVEL.has(sld) ? -3 : -2).join(".");
}

// External referrer host, or null for direct visits and navigation within the site.
export function referrerHost(referrer, siteHosts) {
  if (!referrer) return null;
  try {
    const host = new URL(referrer).hostname.toLowerCase().replace(/^www\./, "");
    if (!host || siteHosts.some((h) => h.replace(/^www\./, "") === host)) return null;
    return host;
  } catch {
    return null;
  }
}
