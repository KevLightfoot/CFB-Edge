// CFB Edge backend: serves the site and keeps API keys on the server.
//
// Environment variables (set these in Render, or in .env locally):
//   CFBD_API_KEY      CollegeFootballData key (live lines)
//   OPENAI_API_KEY    OpenAI key (game explanations)
//   OPENAI_MODEL      optional, defaults to gpt-4o-mini
//   APP_PASSWORD      optional, password-protects the whole site
//   PORT              set automatically by Render

// No npm dependencies: uses only Node's built-in modules (Node 18+ for fetch).
const path = require("path");
const fs = require("fs");
const http = require("http");

const ROOT = path.join(__dirname, "..");
loadDotEnv(path.join(ROOT, ".env"));

const PORT = process.env.PORT || 3000;
const CFBD_KEY = process.env.CFBD_API_KEY || "";
const CFBD_BASE = process.env.CFBD_BASE_URL || "https://api.collegefootballdata.com";
const OPENAI_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_BASE = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
const APP_PASSWORD = process.env.APP_PASSWORD || "";
const LINES_CACHE_MIN = Number(process.env.LINES_CACHE_MINUTES || 30);
const EXPLAIN_LIMIT_PER_HOUR = Number(process.env.EXPLAIN_LIMIT_PER_HOUR || 40);

const DATA_DIR = path.join(ROOT, "data");
const PUBLIC_DIR = path.join(ROOT, "public");

// ---------- tiny router (replaces express) ----------
const routes = [];
const app = {
  get: (p, h) => routes.push({ method: "GET", path: p, h }),
  post: (p, h) => routes.push({ method: "POST", path: p, h }),
};

function wrapRes(res) {
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (obj) => {
    const body = JSON.stringify(obj);
    res.writeHead(res.statusCode || 200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(body);
  };
  return res;
}

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json" };

function serveStatic(urlPath, res) {
  const rel = decodeURIComponent(urlPath).replace(/^\/+/, "") || "index.html";
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) return false;
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
  fs.createReadStream(file).pipe(res);
  return true;
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => { data += c; if (data.length > 100000) req.destroy(); });
    req.on("end", () => { try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); } });
    req.on("error", () => resolve({}));
  });
}

function authorized(req) {
  if (!APP_PASSWORD) return true;
  const [scheme, encoded] = (req.headers.authorization || "").split(" ");
  if (scheme !== "Basic" || !encoded) return false;
  const pass = Buffer.from(encoded, "base64").toString().split(":").slice(1).join(":");
  return pass === APP_PASSWORD;
}

// ---------- data files (reloaded when they change on disk) ----------
const fileCache = {};
function readJson(name) {
  const p = path.join(DATA_DIR, name);
  if (!fs.existsSync(p)) return null;
  const mtime = fs.statSync(p).mtimeMs;
  if (!fileCache[name] || fileCache[name].mtime !== mtime) {
    fileCache[name] = { mtime, data: JSON.parse(fs.readFileSync(p, "utf8")) };
  }
  return fileCache[name].data;
}

// ---------- live lines from CFBD ----------
let linesCache = { key: null, at: 0, data: null, error: null };

function num(x) {
  const v = typeof x === "string" ? parseFloat(x) : x;
  return Number.isFinite(v) ? v : undefined;
}

function pickLine(options, prefs) {
  const pref = (prefs || []).map((p) => p.toLowerCase());
  const rank = (ln) => {
    const i = pref.indexOf(String(ln.provider || "").toLowerCase());
    return i === -1 ? pref.length : i;
  };
  const sorted = [...options].sort((a, b) => rank(a) - rank(b));
  const out = {};
  const fields = [
    ["spread", ["spread"]],
    ["spread_open", ["spreadOpen", "spread_open"]],
    ["total", ["overUnder", "over_under"]],
    ["home_ml", ["homeMoneyline", "home_moneyline"]],
    ["away_ml", ["awayMoneyline", "away_moneyline"]],
  ];
  for (const ln of sorted) {
    for (const [key, names] of fields) {
      if (out[key] !== undefined) continue;
      for (const n of names) {
        const v = num(ln[n]);
        if (v !== undefined) {
          out[key] = v;
          if (key === "spread") out.provider = ln.provider;
          break;
        }
      }
    }
  }
  return out;
}

async function liveLines(season, week, prefs) {
  if (!CFBD_KEY) return { data: null, error: "CFBD_API_KEY not set" };
  const key = `${season}-${week}`;
  const fresh = Date.now() - linesCache.at < LINES_CACHE_MIN * 60 * 1000;
  if (linesCache.key === key && fresh && linesCache.data) return linesCache;
  try {
    const url = `${CFBD_BASE}/lines?year=${season}&week=${week}&seasonType=regular`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${CFBD_KEY}`, Accept: "application/json" } });
    if (!r.ok) throw new Error(`CFBD HTTP ${r.status}`);
    const raw = await r.json();
    const byId = {};
    for (const g of raw) {
      if (g.lines && g.lines.length) byId[g.id] = pickLine(g.lines, prefs);
    }
    linesCache = { key, at: Date.now(), data: byId, error: null };
  } catch (e) {
    // keep serving the last good lines if CFBD hiccups
    linesCache = { ...linesCache, error: String(e.message || e) };
  }
  return linesCache;
}

app.get("/api/health", (req, res) => {
  const p = readJson("predictions.json");
  res.json({
    ok: true,
    cfbd_key: Boolean(CFBD_KEY),
    openai_key: Boolean(OPENAI_KEY),
    openai_model: OPENAI_MODEL,
    predictions: p ? { season: p.season, week: p.week, generated_at: p.generated_at, model_version: p.model_version, mock: p.mock } : null,
  });
});

app.get("/api/predictions", async (req, res) => {
  const p = readJson("predictions.json");
  if (!p) return res.status(404).json({ error: "No predictions yet. Run engine/run_week.py and push data/predictions.json." });
  const out = { ...p, lines_source: "snapshot", lines_updated: p.generated_at, lines_error: null };
  if (!p.mock) {
    const lc = await liveLines(p.season, p.week, p.line_provider_preference);
    if (lc.data) {
      out.lines_source = "live";
      out.lines_updated = new Date(lc.at).toISOString();
      out.games = p.games.map((g) => {
        const live = lc.data[g.id];
        return live && Object.keys(live).length ? { ...g, market_snapshot: g.market, market: { ...g.market, ...live } } : g;
      });
    }
    out.lines_error = lc.error;
  }
  res.json(out);
});

app.get("/api/report-card", (req, res) => {
  const c = readJson("report_card.json");
  if (!c) return res.status(404).json({ error: "No report card yet." });
  res.json(c);
});

// ---------- explanations via OpenAI ----------
const explainCache = new Map();
let explainCalls = [];

function ncdf(x) {
  // Abramowitz-Stegun erf approximation
  const t = 1 / (1 + 0.3275911 * Math.abs(x / Math.SQRT2));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}
const implied = (o) => (o == null ? null : o < 0 ? -o / (-o + 100) : 100 / (o + 100));
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
const pc = (x) => (x == null ? null : Math.round(x * 1000) / 10);

const STAT_LABELS = {
  off_ppa: "Offense EPA/play", def_ppa: "Defense EPA/play allowed", off_sr: "Offense success rate",
  def_sr: "Defense success rate allowed", off_expl: "Offense explosiveness", def_expl: "Defense explosiveness allowed",
  off_rush_ppa: "Rush offense EPA/play", def_rush_ppa: "Rush defense EPA/play allowed", off_pass_ppa: "Pass offense EPA/play",
  def_pass_ppa: "Pass defense EPA/play allowed", havoc_forced: "Havoc rate forced (defense)",
  havoc_allowed: "Havoc rate allowed (offense)", pts_for: "Points per game", pts_against: "Points allowed per game",
  off_plays: "Offensive plays per game (pace)", talent: "Roster talent composite",
};

function buildFacts(g, p) {
  const mk = g.market || {};
  const mu = g.model.margin, sig = g.model.sigma;
  const homeFav = mk.spread != null ? mk.spread < 0 : mu > 0;
  const fav = homeFav ? g.home.name : g.away.name, dog = homeFav ? g.away.name : g.home.name;
  const favMu = homeFav ? mu : -mu;
  const blow = {};
  for (const m of p.betting.blowout_margins) blow[`fav_wins_by_more_than_${m}`] = pc(1 - ncdf((m - favMu) / sig));
  const ph = implied(mk.home_ml), pa = implied(mk.away_ml);
  const novig = ph != null && pa != null ? { home: pc(ph / (ph + pa)), away: pc(pa / (ph + pa)) } : null;
  const side = (t) => {
    const stats = {};
    for (const [k, label] of Object.entries(STAT_LABELS)) {
      const v = t.stats[k];
      stats[label] = { value: typeof v === "number" ? Math.round(v * 1000) / 1000 : v, rank: t.ranks?.[k] ?? null };
    }
    return { team: t.name, conference: t.conf, games_this_season: t.games, elo: t.elo, stats };
  };
  return {
    matchup: `${g.away.name} at ${g.home.name}${g.neutral ? " (neutral site)" : ""}`,
    rank_note: `Ranks are out of ${p.n_teams} teams, 1 = best. Early-season numbers blend in last season when games_this_season is small.`,
    market: { home_spread: mk.spread ?? null, total: mk.total ?? null, home_ml: mk.home_ml ?? null, away_ml: mk.away_ml ?? null,
              no_vig_win_pct: novig, provider: mk.provider ?? null },
    model: {
      our_home_spread: r1(-mu), our_total: r1(g.model.total), margin_std_dev: r1(sig),
      home_win_pct: pc(g.model.home_win_prob), away_win_pct: pc(1 - g.model.home_win_prob),
      favorite: fav, underdog: dog, ...blow,
      typical_std_dev_note: "Average college football std dev of margin is about 15-16 points.",
    },
    margin_drivers_points_toward_home: g.factors.map((f) => ({ factor: f.label, points: f.points })),
    volatility_drivers_std_dev_points: g.vol_factors.map((f) => ({ factor: f.label, points: f.sigma_pts })),
    home: side(g.home),
    away: side(g.away),
  };
}

const SYSTEM_PROMPT = `You are a sharp college football betting analyst writing for one experienced bettor.
He bets moneyline favorites in parlays and large alternate spreads on small underdogs (+17.5 to +21.5 when the favorite is -2 to -7).

Rules:
- Use ONLY the numbers in the provided JSON. Never invent injuries, news, records, or stats.
- Every claim must cite a specific number or rank from the data (e.g. "rush defense ranks 104th of 134").
- Explain what drives THIS game. No generic statements like "turnovers matter" or "defense wins games".
- Prioritize the largest margin drivers and volatility drivers. Say why they push the margin or the variance.
- Compare our numbers to the market and say plainly whether the edge looks real or thin.
- Be concise and direct. No disclaimers about gambling.

Return JSON with exactly these keys:
{"headline": one sentence verdict,
 "spread_take": 2-3 sentences on our spread vs the market,
 "moneyline_take": 2-3 sentences on win probability vs implied odds,
 "blowout_take": 2-3 sentences on how likely a lopsided result is and why (for alt-spread underdog bets),
 "key_matchups": [{"title": short label, "detail": 1-2 sentences with numbers}] (3 to 5 items),
 "risks": [1-3 short strings: what would make our read wrong, based only on the data]}`;

app.post("/api/explain", async (req, res) => {
  if (!OPENAI_KEY) return res.status(503).json({ error: "OPENAI_API_KEY is not set on the server." });
  const p = readJson("predictions.json");
  if (!p) return res.status(404).json({ error: "No predictions loaded." });
  const id = Number(req.body?.gameId);
  let g = p.games.find((x) => x.id === id);
  if (!g) return res.status(404).json({ error: "Game not found." });

  if (!p.mock) {
    const lc = await liveLines(p.season, p.week, p.line_provider_preference);
    if (lc.data && lc.data[id]) g = { ...g, market: { ...g.market, ...lc.data[id] } };
  }
  const ck = `${p.model_version}:${p.season}:${p.week}:${id}:${g.market?.spread}:${g.market?.home_ml}`;
  if (!req.body?.force && explainCache.has(ck)) return res.json({ ...explainCache.get(ck), cached: true });

  const hourAgo = Date.now() - 3600 * 1000;
  explainCalls = explainCalls.filter((t) => t > hourAgo);
  if (explainCalls.length >= EXPLAIN_LIMIT_PER_HOUR) {
    return res.status(429).json({ error: "Hourly explanation limit reached. Try again later." });
  }
  explainCalls.push(Date.now());

  try {
    const r = await fetch(`${OPENAI_BASE}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(buildFacts(g, p)) },
        ],
      }),
    });
    const body = await r.json();
    if (!r.ok) throw new Error(body?.error?.message || `OpenAI HTTP ${r.status}`);
    const text = body.choices?.[0]?.message?.content || "{}";
    const parsed = JSON.parse(text);
    const result = { explanation: parsed, model: OPENAI_MODEL, generated_at: new Date().toISOString() };
    explainCache.set(ck, result);
    res.json(result);
  } catch (e) {
    res.status(502).json({ error: `Explanation failed: ${e.message || e}` });
  }
});

const server = http.createServer(async (req, res) => {
  wrapRes(res);
  try {
    if (!authorized(req)) {
      res.writeHead(401, { "WWW-Authenticate": 'Basic realm="CFB Edge"', "Content-Type": "text/plain" });
      return res.end("Password required");
    }
    const url = new URL(req.url, "http://localhost");
    const route = routes.find((r) => r.method === req.method && r.path === url.pathname);
    if (route) {
      if (req.method === "POST") req.body = await readBody(req);
      return await route.h(req, res);
    }
    if (url.pathname.startsWith("/api/")) return res.status(404).json({ error: "Not found" });
    if (req.method === "GET" && serveStatic(url.pathname, res)) return;
    serveStatic("/index.html", res); // SPA fallback
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.status(500).json({ error: "Server error" });
  }
});

server.listen(PORT, () => {
  console.log(`CFB Edge running on http://localhost:${PORT}`);
  console.log(`  CFBD key: ${CFBD_KEY ? "set" : "MISSING"} | OpenAI key: ${OPENAI_KEY ? "set" : "MISSING"} | password: ${APP_PASSWORD ? "on" : "off"}`);
});

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !line.trim().startsWith("#") && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
    }
  }
}
