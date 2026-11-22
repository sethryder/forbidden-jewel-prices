// Forbidden jewel price proxy + page. Run: node server.js  (env or .env: CONTACT, PORT, USER_AGENT)
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
try { process.loadEnvFile(path.join(__dirname, ".env")); } catch {} // optional; real env vars win

const NOTABLES = require("./notables.json");
const OPTS = new Set(Object.values(NOTABLES).map(n => n.id));
// Flame carries the "...on Forbidden Flesh" stat and vice versa.
const JEWELS = { "Forbidden Flame": "explicit.stat_1190333629", "Forbidden Flesh": "explicit.stat_2460506030" };
const TRADE = "https://www.pathofexile.com";
// GGG and poe.ninja both ask API clients to name the app and give a contact.
const CONTACT = process.env.CONTACT;
const UA = process.env.USER_AGENT || `forbidden-jewel-prices/0.1${CONTACT ? ` (contact: ${CONTACT})` : ""}`;
const TTL = 24 * 3600e3;
const NINJA_TTL = 30 * 60e3; // matches poe.ninja's own Cache-Control max-age

// ponytail: in-memory, lost on restart. Bounded because keys are validated against known leagues x notables.
// Caches the promise so concurrent requests for the same key share one upstream fetch.
const cache = new Map();
function cached(key, fn, ttl = TTL) {
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  const value = fn();
  cache.set(key, { value, until: Date.now() + ttl });
  value.catch(() => cache.get(key)?.value === value && cache.delete(key)); // never cache failures
  return value;
}

async function json(url, body) {
  const res = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: { "User-Agent": UA, "Content-Type": "application/json" },
    body: body && JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`);
  return res.json();
}
const trade = (pathname, body) => json(TRADE + pathname, body);

// One request prices every Forbidden jewel in the league. Reshaped to { notable: { "Forbidden Flame": {...}, ... } }.
const ninja = league => cached(`ninja|${league}`, async () => {
  const { lines } = await json(`https://poe.ninja/poe1/api/economy/stash/current/item/overview?league=${encodeURIComponent(league)}&type=ForbiddenJewel`);
  const notables = {};
  for (const l of lines) {
    (notables[l.metadata?.passiveName] ??= {})[l.variant] = {
      chaos: l.chaosValue, divine: l.divineValue, listings: l.listingCount,
      trend: l.sparkLine?.data ?? [], change: l.sparkLine?.totalChange ?? null, // 7 daily samples, % vs first day
    };
  }
  return { fetchedAt: new Date().toISOString(), notables };
}, NINJA_TTL);

// /api/trade/data/leagues sometimes comes back empty; this one lists everything. SSF can't trade, so drop it.
// Challenge leagues first, so the page's default is the current one. Hourly, so new leagues show up on their own.
const leagues = () => cached("leagues", async () => {
  const all = (await trade("/api/leagues?type=main&realm=pc")).filter(l => !l.rules?.some(r => r.id === "NoParties"));
  if (!all.length) throw new Error("no leagues listed");
  const std = l => l.category?.id === "Standard";
  return [...all.filter(l => !std(l)), ...all.filter(std)].map(l => l.id);
}, 3600e3);

async function price(league, opt) {
  const out = { fetchedAt: new Date().toISOString() };
  for (const [name, stat] of Object.entries(JEWELS)) { // sequential, to go easy on GGG's rate limits
    const s = await trade(`/api/trade/search/${encodeURIComponent(league)}`, {
      query: { status: { option: "available" }, name, stats: [{ type: "and", filters: [{ id: `${stat}|${opt}` }] }] },
      sort: { price: "asc" },
    });
    const ids = s.result.slice(0, 10); // 10 = max ids per fetch call
    const f = ids.length ? await trade(`/api/trade/fetch/${ids.join(",")}?query=${s.id}`) : { result: [] };
    const prices = f.result.filter(r => r?.listing?.price).map(r => `${r.listing.price.amount} ${r.listing.price.currency}`);
    // Results arrive sorted by price across currencies, so the median is just the middle one, no div/chaos rate needed.
    out[name] = { total: s.total, median: prices[Math.floor((prices.length - 1) / 2)], prices };
  }
  return out;
}

const STATIC = {
  "/": ["index.html", "text/html"],
  "/notables.json": ["notables.json", "application/json"],
  "/flame.png": ["flame.png", "image/png"],
  "/flesh.png": ["flesh.png", "image/png"],
  "/robots.txt": ["robots.txt", "text/plain"],
};

function send(res, status, body, type = "application/json") {
  res.writeHead(status, { "Content-Type": type });
  res.end(Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://localhost");
  try {
    if (u.pathname === "/leagues") return send(res, 200, await leagues());
    if (u.pathname === "/price") {
      const league = u.searchParams.get("league"), opt = Number(u.searchParams.get("opt"));
      if (!OPTS.has(opt) || !(await leagues()).includes(league)) return send(res, 400, { error: "unknown league or notable" });
      return send(res, 200, await cached(`${league}|${opt}`, () => price(league, opt)));
    }
    if (u.pathname === "/ninja") {
      const league = u.searchParams.get("league");
      if (!(await leagues()).includes(league)) return send(res, 400, { error: "unknown league" });
      return send(res, 200, await ninja(league));
    }
    const file = STATIC[u.pathname];
    if (file) return send(res, 200, fs.readFileSync(path.join(__dirname, file[0])), file[1]);
    send(res, 404, { error: "not found" });
  } catch (e) {
    send(res, 502, { error: e.message });
  }
});

if (require.main === module) {
  if (!CONTACT && !process.env.USER_AGENT) console.warn("warning: set CONTACT (email or URL) so GGG and poe.ninja can reach you; see .env.example");
  server.listen(process.env.PORT || 8080, () => console.log(`listening on ${server.address().port}, User-Agent: ${UA}`));
}
module.exports = { cached, server };
