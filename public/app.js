/* CFB Edge frontend. Vanilla JS, no build step. */
"use strict";

const S = { preds: null, card: null, health: null, err: null, explain: {} };
const $view = document.getElementById("view");

// ---------------------------------------------------------------- math
function ncdf(x) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x / Math.SQRT2));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}
const implied = (o) => (o == null || o === "" || isNaN(o) ? null : o < 0 ? -o / (-o + 100) : 100 / (Number(o) + 100));
const profit = (o) => (o < 0 ? 100 / -o : o / 100);
const ev = (p, o) => (p == null || o == null || isNaN(o) || o === 0 ? null : p * profit(o) - (1 - p));
function fairOdds(p) {
  if (p == null || p <= 0 || p >= 1) return "—";
  return p >= 0.5 ? `${Math.round(-100 * p / (1 - p))}` : `+${Math.round(100 * (1 - p) / p)}`;
}
const pct = (p, d = 1) => (p == null ? "—" : `${(p * 100).toFixed(d)}%`);
const sgn = (x, d = 1) => (x == null ? "—" : `${x > 0 ? "+" : ""}${x.toFixed(d)}`);
const line = (x) => (x == null ? "—" : x === 0 ? "PK" : sgn(x, 1));
const ml = (o) => (o == null ? "—" : o > 0 ? `+${o}` : `${o}`);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Game helpers (home margin ~ Normal(mu, sigma))
function G(g) {
  const mu = g.model.margin, sd = g.model.sigma, mk = g.market || {};
  const homeFav = mk.spread != null ? mk.spread < 0 : mu > 0;
  const fav = homeFav ? g.home : g.away, dog = homeFav ? g.away : g.home;
  const favMu = homeFav ? mu : -mu;
  const ph = implied(mk.home_ml), pa = implied(mk.away_ml);
  const removeVig = S.preds?.betting?.remove_vig !== false;
  let ih = ph, ia = pa;
  if (ph != null && pa != null && removeVig) { ih = ph / (ph + pa); ia = pa / (ph + pa); }
  return {
    mu, sd, mk, homeFav, fav, dog, favMu,
    pHome: ncdf(mu / sd), pAway: 1 - ncdf(mu / sd),
    implHome: ih, implAway: ia,
    ourHomeSpread: -mu,
    spreadEdge: mk.spread != null ? mu + mk.spread : null, // + = home side value
    pFavBy: (m) => 1 - ncdf((m - favMu) / sd),
    // P(team covers line L from that team's perspective), e.g. +17.5
    pCover: (isHome, L) => (isHome ? 1 - ncdf((-L - mu) / sd) : ncdf((L - mu) / sd)),
  };
}

function fmtDate(iso) {
  if (!iso) return "TBD";
  const d = new Date(iso);
  if (isNaN(d)) return "TBD";
  return d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// ---------------------------------------------------------------- storage
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

// ---------------------------------------------------------------- data
async function api(path, opts) {
  const r = await fetch(path, opts);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
  return body;
}

async function loadAll() {
  try { S.preds = await api("/api/predictions"); } catch (e) { S.err = e.message; }
  try { S.card = await api("/api/report-card"); } catch { S.card = null; }
  try { S.health = await api("/api/health"); } catch { S.health = null; }
  const wb = document.getElementById("weekBadge");
  if (S.preds) {
    wb.innerHTML = `<b>${S.preds.season} · Week ${S.preds.week}</b><br>Model v${S.preds.model_version} · lines ${S.preds.lines_source === "live" ? "live" : "snapshot"}`;
  }
  route();
}

function banners() {
  let h = "";
  if (S.preds?.mock) h += `<div class="banner">Showing <b>sample data</b> with fictional teams. Run the engine with your CFBD key to load real games.</div>`;
  if (S.preds && !S.preds.mock && S.preds.lines_source !== "live") {
    h += `<div class="banner">Live lines unavailable${S.preds.lines_error ? ` (${esc(S.preds.lines_error)})` : ""}; showing lines from when predictions were generated.</div>`;
  }
  return h;
}

// ---------------------------------------------------------------- router
window.addEventListener("hashchange", route);
function route() {
  const h = location.hash.replace(/^#\/?/, "") || "slate";
  const [page, arg] = h.split("/");
  document.querySelectorAll("#tabs a").forEach((a) => a.classList.toggle("active", a.dataset.tab === page || (page === "game" && a.dataset.tab === "slate")));
  window.scrollTo(0, 0);
  if (page === "bets") return viewBets();
  if (page === "report") return viewReport();
  if (!S.preds) {
    $view.innerHTML = `<div class="banner err">${esc(S.err || "No predictions loaded.")}</div><p class="sub">Run <code>python engine/run_week.py --week N</code>, commit <code>data/</code>, and push.</p>`;
    return;
  }
  if (page === "altdogs") return viewAltDogs();
  if (page === "moneylines") return viewMoneylines();
  if (page === "game") return viewGame(Number(arg));
  return viewSlate();
}

// ---------------------------------------------------------------- slate
function viewSlate() {
  const st = store.get("slate", { sort: "time", q: "" });
  const games = S.preds.games.map((g) => ({ g, x: G(g) }));
  const m1 = S.preds.betting.blowout_margins[0];
  const sorters = {
    time: (a, b) => (a.g.start || "").localeCompare(b.g.start || ""),
    spread: (a, b) => Math.abs(b.x.spreadEdge ?? -1) - Math.abs(a.x.spreadEdge ?? -1),
    ml: (a, b) => mlEdge(b.x) - mlEdge(a.x),
    blowout: (a, b) => a.x.pFavBy(m1) - b.x.pFavBy(m1),
  };
  const q = st.q.toLowerCase();
  const list = games.filter(({ g }) => !q || (g.home.name + " " + g.away.name + " " + g.home.conf + " " + g.away.conf).toLowerCase().includes(q)).sort(sorters[st.sort] || sorters.time);

  $view.innerHTML = `${banners()}
    <div class="page-head"><div><h1>This Week</h1><div class="sub">${S.preds.games.length} games · tap a game for the full breakdown</div></div></div>
    <div class="controls">
      <label class="field">Search<input id="q" class="wide" placeholder="Team or conference" value="${esc(st.q)}"></label>
      <label class="field">Sort by<select id="sort">
        <option value="time">Kickoff</option><option value="spread">Biggest spread disagreement</option>
        <option value="ml">Best moneyline edge</option><option value="blowout">Lowest blowout risk</option></select></label>
    </div>
    <div class="games">${list.map(({ g, x }) => gameCard(g, x, m1)).join("") || `<div class="empty">No games match.</div>`}</div>`;
  const sel = document.getElementById("sort");
  sel.value = st.sort;
  sel.onchange = () => { store.set("slate", { ...st, sort: sel.value }); viewSlate(); };
  const qi = document.getElementById("q");
  qi.oninput = debounce(() => { store.set("slate", { ...st, q: qi.value }); viewSlate(); document.getElementById("q").focus(); }, 300);
}

function mlEdge(x) {
  const e = [];
  if (x.implHome != null) e.push(x.pHome - x.implHome);
  if (x.implAway != null) e.push(x.pAway - x.implAway);
  return e.length ? Math.max(...e) : -1;
}

function gameCard(g, x, m1) {
  const mk = x.mk;
  const edge = x.spreadEdge;
  const edgeSide = edge == null ? "" : edge > 0 ? g.home.name : g.away.name;
  const thr = S.preds.betting.spread_edge_threshold_pts;
  const favWinOurs = x.homeFav ? x.pHome : x.pAway;
  const favWinImpl = x.homeFav ? x.implHome : x.implAway;
  const blow = x.pFavBy(m1);
  return `<a class="gcard" href="#/game/${g.id}">
    <div class="teams">
      <div class="team-line"><span>${esc(g.away.name)}</span><span class="rec">${line(mk.spread != null ? -mk.spread : null)}</span></div>
      <div class="team-line"><span>${g.neutral ? "vs" : "@"} ${esc(g.home.name)}</span><span class="rec">${line(mk.spread)}</span></div>
      <div class="when">${fmtDate(g.start)}${g.neutral ? " · neutral" : ""}</div>
    </div>
    <div class="stat"><span class="k">Home spread</span><span class="v">${line(mk.spread)}</span><span class="s">ours ${line(round1(x.ourHomeSpread))}</span></div>
    <div class="stat"><span class="k">Spread edge</span><span class="v ${edge != null && Math.abs(edge) >= thr ? "hot" : ""}">${edge == null ? "—" : Math.abs(edge).toFixed(1)}</span><span class="s">${edge == null ? "no line" : esc(shortName(edgeSide))}</span></div>
    <div class="stat"><span class="k">${esc(shortName(x.fav.name))} win</span><span class="v">${pct(favWinOurs, 0)}</span><span class="s">book ${pct(favWinImpl, 0)}</span></div>
    <div class="stat"><span class="k">Fav by ${Math.ceil(m1)}+</span><span class="v ${blow < 0.12 ? "pos" : blow > 0.3 ? "neg" : ""}">${pct(blow, 0)}</span><span class="s">σ ${x.sd.toFixed(1)}</span></div>
  </a>`;
}

// ---------------------------------------------------------------- alt dogs
function viewAltDogs() {
  const b = S.preds.betting;
  const st = store.get("altdogs", { min: b.alt_dog_spread_range[0], max: b.alt_dog_spread_range[1], alt: b.blowout_margins[0], odds: -400, rowOdds: {} });
  const rows = S.preds.games.map((g) => ({ g, x: G(g) }))
    .filter(({ x }) => x.mk.spread != null && Math.abs(x.mk.spread) >= st.min && Math.abs(x.mk.spread) <= st.max)
    .map(({ g, x }) => {
      const dogHome = !x.homeFav;
      const p = x.pCover(dogHome, Number(st.alt));
      const key = `${g.id}:${st.alt}`;
      const odds = st.rowOdds[key] ?? st.odds;
      return { g, x, p, key, odds: Number(odds), e: ev(p, Number(odds)) };
    })
    .sort((a, b2) => b2.p - a.p);

  $view.innerHTML = `${banners()}
    <div class="page-head"><div><h1>Alt-Dog Finder</h1>
      <div class="sub">Small underdogs ranked by how likely they are to stay inside your alt spread. Enter your book's price to see expected value.</div></div></div>
    <div class="controls">
      <label class="field">Fav spread from<input type="number" step="0.5" id="min" value="${st.min}"></label>
      <label class="field">to<input type="number" step="0.5" id="max" value="${st.max}"></label>
      <label class="field">Alt line (dog +)<input type="number" step="0.5" id="alt" value="${st.alt}"></label>
      <label class="field">Default book odds<input type="number" step="5" id="odds" value="${st.odds}"></label>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Underdog</th><th>Book</th><th>Our line</th><th>σ</th><th>Cover +${st.alt}</th><th>Fair odds</th><th>Your odds</th><th>EV / unit</th></tr></thead>
      <tbody>${rows.map((r) => `<tr class="click" data-id="${r.g.id}">
        <td><div class="team">${esc(r.x.dog.name)}</div><div class="opp">${r.x.homeFav ? "at" : "vs"} ${esc(r.x.fav.name)}</div></td>
        <td class="num">${line(Math.abs(r.x.mk.spread))}</td>
        <td class="num">${line(round1(r.x.homeFav ? r.x.mu : -r.x.mu))}</td>
        <td class="num">${r.x.sd.toFixed(1)}</td>
        <td class="num hot">${pct(r.p)}</td>
        <td class="num">${fairOdds(r.p)}</td>
        <td><input type="number" step="5" data-key="${r.key}" value="${r.odds}"></td>
        <td class="num ${r.e == null ? "" : r.e > 0 ? "pos" : "neg"}">${r.e == null ? "—" : sgn(r.e, 3)}</td>
      </tr>`).join("") || `<tr><td colspan="8" class="muted">No games in this spread range.</td></tr>`}</tbody>
    </table></div>
    <p class="sub small">"Our line" is our expected margin for the underdog (negative means we expect them to lose by that much). Cover probability uses each game's own volatility (σ), so low-σ games rank higher.</p>`;

  const save = (patch) => { store.set("altdogs", { ...st, ...patch }); viewAltDogs(); };
  ["min", "max", "alt", "odds"].forEach((id) => {
    document.getElementById(id).onchange = (e) => save({ [id]: Number(e.target.value) });
  });
  $view.querySelectorAll("td input").forEach((inp) => {
    inp.onclick = (e) => e.stopPropagation();
    inp.onchange = () => save({ rowOdds: { ...st.rowOdds, [inp.dataset.key]: Number(inp.value) } });
  });
  $view.querySelectorAll("tr.click").forEach((tr) => (tr.onclick = () => (location.hash = `#/game/${tr.dataset.id}`)));
}

// ---------------------------------------------------------------- moneylines
function viewMoneylines() {
  const st = store.get("ml", { favOnly: false, minWin: 0, sort: "edge" });
  const thr = S.preds.betting.ml_edge_threshold;
  let rows = [];
  for (const g of S.preds.games) {
    const x = G(g);
    if (x.mk.home_ml == null || x.mk.away_ml == null) continue;
    rows.push({ g, x, team: g.home, opp: g.away, isHome: true, o: x.mk.home_ml, p: x.pHome, ip: x.implHome });
    rows.push({ g, x, team: g.away, opp: g.home, isHome: false, o: x.mk.away_ml, p: x.pAway, ip: x.implAway });
  }
  rows = rows.filter((r) => (!st.favOnly || r.o < 0) && r.p * 100 >= st.minWin);
  rows.forEach((r) => { r.edge = r.p - r.ip; r.ev = ev(r.p, r.o); });
  rows.sort(st.sort === "win" ? (a, b) => b.p - a.p : (a, b) => b.edge - a.edge);

  $view.innerHTML = `${banners()}
    <div class="page-head"><div><h1>Moneylines</h1>
      <div class="sub">Our win probability vs the book's no-vig implied probability. Edges of ${pct(thr, 0)}+ are highlighted.</div></div></div>
    <div class="controls">
      <label class="check"><input type="checkbox" id="fav" ${st.favOnly ? "checked" : ""}> Favorites only</label>
      <label class="field">Min our win %<input type="number" id="minWin" value="${st.minWin}" step="5"></label>
      <label class="field">Sort<select id="sort"><option value="edge">Edge</option><option value="win">Win probability</option></select></label>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Team</th><th>ML</th><th>Book (no-vig)</th><th>Ours</th><th>Edge</th><th>Fair</th><th>EV / unit</th><th>Fav by 18+</th></tr></thead>
      <tbody>${rows.map((r) => {
        const blow = r.x.pFavBy(S.preds.betting.blowout_margins[0]);
        return `<tr class="click" data-id="${r.g.id}">
        <td><div class="team">${esc(r.team.name)}</div><div class="opp">${r.isHome ? (r.g.neutral ? "vs" : "vs") : "at"} ${esc(r.opp.name)}</div></td>
        <td class="num">${ml(r.o)}</td><td class="num">${pct(r.ip)}</td><td class="num">${pct(r.p)}</td>
        <td class="num ${r.edge >= thr ? "hot" : r.edge < 0 ? "neg" : ""}">${sgn(r.edge * 100, 1)}</td>
        <td class="num">${fairOdds(r.p)}</td>
        <td class="num ${r.ev > 0 ? "pos" : "neg"}">${sgn(r.ev, 3)}</td>
        <td class="num">${(r.team === r.x.fav) ? pct(blow, 0) : "—"}</td></tr>`;
      }).join("") || `<tr><td colspan="8" class="muted">No moneylines match.</td></tr>`}</tbody>
    </table></div>
    <p class="sub small">Edge is in percentage points. For favorites in parlays, a small negative edge on every leg compounds quickly, so prefer legs at or above zero.</p>`;
  document.getElementById("fav").onchange = (e) => { store.set("ml", { ...st, favOnly: e.target.checked }); viewMoneylines(); };
  document.getElementById("minWin").onchange = (e) => { store.set("ml", { ...st, minWin: Number(e.target.value) }); viewMoneylines(); };
  const so = document.getElementById("sort"); so.value = st.sort;
  so.onchange = () => { store.set("ml", { ...st, sort: so.value }); viewMoneylines(); };
  $view.querySelectorAll("tr.click").forEach((tr) => (tr.onclick = () => (location.hash = `#/game/${tr.dataset.id}`)));
}

// ---------------------------------------------------------------- game page
const CMP = [
  ["off_ppa", "Offense EPA/play", 3, false], ["def_ppa", "Defense EPA/play allowed", 3, true],
  ["off_sr", "Offense success rate", "pct", false], ["def_sr", "Defense success rate allowed", "pct", true],
  ["off_expl", "Offense explosiveness", 2, false], ["def_expl", "Defense explosiveness allowed", 2, true],
  ["off_rush_ppa", "Rush offense EPA", 3, false], ["def_rush_ppa", "Rush defense EPA allowed", 3, true],
  ["off_pass_ppa", "Pass offense EPA", 3, false], ["def_pass_ppa", "Pass defense EPA allowed", 3, true],
  ["havoc_forced", "Havoc forced", "pct", false], ["havoc_allowed", "Havoc allowed", "pct", true],
  ["pts_for", "Points per game", 1, false], ["pts_against", "Points allowed", 1, true],
  ["talent", "Roster talent", 0, false], ["off_plays", "Plays per game (pace)", 1, null],
];

function fmtStat(v, f) {
  if (v == null) return "—";
  if (f === "pct") return `${(v * 100).toFixed(1)}%`;
  return Number(v).toFixed(f);
}
function ord(n) {
  if (n == null) return "";
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function viewGame(id) {
  const g = S.preds.games.find((x) => x.id === id);
  if (!g) { $view.innerHTML = `<a class="back" href="#/slate">← Slate</a><div class="empty">Game not found.</div>`; return; }
  const x = G(g), mk = x.mk, b = S.preds.betting;
  const nT = S.preds.n_teams;
  const ourAwayWin = x.pAway, ourHomeWin = x.pHome;

  const coverHome = mk.spread != null ? x.pCover(true, mk.spread) : null;
  const coverAway = mk.spread != null ? x.pCover(false, -mk.spread) : null;
  const dogIsHome = !x.homeFav;

  const cmpRows = CMP.map(([k, label, f, lowerBetter]) => {
    const av = g.away.stats[k], hv = g.home.stats[k];
    let aBetter = false, hBetter = false, aw = 50;
    if (av != null && hv != null && lowerBetter !== null) {
      aBetter = lowerBetter ? av < hv : av > hv;
      hBetter = lowerBetter ? hv < av : hv > av;
    }
    const ar = g.away.ranks?.[k], hr = g.home.ranks?.[k];
    if (ar && hr) aw = Math.round((nT - ar + 1) / ((nT - ar + 1) + (nT - hr + 1)) * 100);
    else if (av != null && hv != null && av + hv !== 0) aw = Math.round(av / (av + hv) * 100);
    return `<div class="cmp-row">
      <div class="lv ${aBetter ? "better" : ""}">${fmtStat(av, f)} <span class="rk">${ar ? ord(ar) : ""}</span></div>
      <div class="mid"><div class="lab">${label}</div><div class="duel"><div class="a" style="width:${aw}%"></div><div class="h" style="width:${100 - aw}%"></div></div></div>
      <div class="rv ${hBetter ? "better" : ""}"><span class="rk">${hr ? ord(hr) : ""}</span> ${fmtStat(hv, f)}</div></div>`;
  }).join("");

  const maxF = Math.max(1, ...g.factors.map((f) => Math.abs(f.points)));
  const factorRows = g.factors.map((f) => {
    const w = Math.abs(f.points) / maxF * 50;
    const left = f.points >= 0 ? 50 : 50 - w;
    const toward = f.points >= 0 ? g.home.name : g.away.name;
    return `<div class="frow"><span>${esc(f.label)}</span>
      <div class="fbar"><div class="mid"></div><div class="fill" style="left:${left}%;width:${w}%;background:${f.points >= 0 ? "var(--home)" : "var(--away)"}"></div></div>
      <span class="pts" title="toward ${esc(toward)}">${Math.abs(f.points).toFixed(1)}</span></div>`;
  }).join("");
  const maxV = Math.max(0.5, ...g.vol_factors.map((f) => Math.abs(f.sigma_pts)));
  const volRows = g.vol_factors.map((f) => {
    const w = Math.abs(f.sigma_pts) / maxV * 50;
    const left = f.sigma_pts >= 0 ? 50 : 50 - w;
    return `<div class="frow"><span>${esc(f.label)}</span>
      <div class="fbar"><div class="mid"></div><div class="fill" style="left:${left}%;width:${w}%;background:${f.sigma_pts >= 0 ? "var(--bad)" : "var(--good)"}"></div></div>
      <span class="pts">${sgn(f.sigma_pts, 1)}</span></div>`;
  }).join("");

  const pr = store.get("pricer", {})[id] || { team: dogIsHome ? "home" : "away", line: b.blowout_margins[0], odds: -400 };

  $view.innerHTML = `${banners()}
    <a class="back" href="#/slate">← Slate</a>
    <div class="matchup">
      <div class="side"><div class="nm away-c">${esc(g.away.name)}</div><div class="cf">${esc(g.away.conf || "")} · ${g.away.games} games</div></div>
      <div class="at">${g.neutral ? "vs" : "@"}</div>
      <div class="side home"><div class="nm home-c">${esc(g.home.name)}</div><div class="cf">${esc(g.home.conf || "")} · ${g.home.games} games</div></div>
    </div>
    <div class="sub" style="text-align:center;margin-top:-10px">${fmtDate(g.start)}${g.neutral ? " · neutral site" : ""}${mk.provider ? ` · lines: ${esc(mk.provider)}` : ""}</div>

    <div class="big3">
      <div class="tile"><div class="k">Our spread (home)</div><div class="v">${line(round1(x.ourHomeSpread))}</div><div class="s">Book ${line(mk.spread)}${mk.spread_open != null ? ` · opened ${line(mk.spread_open)}` : ""}</div></div>
      <div class="tile"><div class="k">${esc(shortName(x.fav.name))} win</div><div class="v">${pct(x.homeFav ? ourHomeWin : ourAwayWin, 1)}</div><div class="s">Book ${pct(x.homeFav ? x.implHome : x.implAway, 1)}</div></div>
      <div class="tile"><div class="k">Volatility (σ)</div><div class="v">${x.sd.toFixed(1)}</div><div class="s">Total: ours ${g.model.total.toFixed(1)} · book ${mk.total ?? "—"}</div></div>
    </div>

    <div class="grid2">
      <div class="card">
        <h3>Spread evaluator</h3>
        <div class="kv">
          <span class="hd"></span><span class="hd">Line</span><span class="hd">Cover %</span>
          <span class="lbl">${esc(g.away.name)}</span><span class="val">${line(mk.spread != null ? -mk.spread : null)}</span><span class="val ${coverAway > 0.55 ? "pos" : ""}">${pct(coverAway)}</span>
          <span class="lbl">${esc(g.home.name)}</span><span class="val">${line(mk.spread)}</span><span class="val ${coverHome > 0.55 ? "pos" : ""}">${pct(coverHome)}</span>
        </div>
        <p class="small muted" style="margin:10px 0 0">${x.spreadEdge == null ? "No book spread available." :
          `We disagree with the book by <b class="${Math.abs(x.spreadEdge) >= b.spread_edge_threshold_pts ? "hot" : ""}">${Math.abs(x.spreadEdge).toFixed(1)} pts</b>, leaning ${esc(x.spreadEdge > 0 ? g.home.name : g.away.name)}. At -110 you need 52.4% to break even.`}</p>
      </div>
      <div class="card">
        <h3>Moneyline evaluator</h3>
        <div class="kv" style="grid-template-columns:1fr auto auto auto">
          <span class="hd"></span><span class="hd">ML</span><span class="hd">Book</span><span class="hd">Ours</span>
          <span class="lbl">${esc(g.away.name)}</span><span class="val">${ml(mk.away_ml)}</span><span class="val">${pct(x.implAway)}</span><span class="val ${x.implAway != null && ourAwayWin - x.implAway >= b.ml_edge_threshold ? "hot" : ""}">${pct(ourAwayWin)}</span>
          <span class="lbl">${esc(g.home.name)}</span><span class="val">${ml(mk.home_ml)}</span><span class="val">${pct(x.implHome)}</span><span class="val ${x.implHome != null && ourHomeWin - x.implHome >= b.ml_edge_threshold ? "hot" : ""}">${pct(ourHomeWin)}</span>
        </div>
        <p class="small muted" style="margin:10px 0 0">Fair odds: ${esc(shortName(g.away.name))} ${fairOdds(ourAwayWin)} · ${esc(shortName(g.home.name))} ${fairOdds(ourHomeWin)}${mk.home_ml != null ? ` · EV/unit: ${sgn(ev(ourAwayWin, mk.away_ml), 3)} / ${sgn(ev(ourHomeWin, mk.home_ml), 3)}` : ""}</p>
      </div>

      <div class="card">
        <h3>Blowout risk</h3>
        <div class="kv" style="grid-template-columns:1fr auto">
          ${b.blowout_margins.map((m) => `<span class="lbl">${esc(x.fav.name)} wins by more than ${m}</span><span class="val">${pct(x.pFavBy(m))}</span>`).join("")}
          ${b.blowout_margins.map((m) => `<span class="lbl">${esc(x.dog.name)} +${m} covers</span><span class="val hot">${pct(1 - x.pFavBy(m))}</span>`).join("")}
          <span class="lbl">One-score game (within 8)</span><span class="val">${pct(ncdf((8 - x.mu) / x.sd) - ncdf((-8 - x.mu) / x.sd))}</span>
          <span class="lbl">${esc(x.dog.name)} wins outright</span><span class="val">${pct(1 - ncdf(x.favMu / x.sd))}</span>
        </div>
        <div class="dist" style="margin-top:10px">${distSvg(x, b.blowout_margins)}</div>
      </div>

      <div class="card">
        <h3>Alt line pricer</h3>
        <div class="controls" style="margin-bottom:8px">
          <label class="field">Team<select id="prTeam"><option value="away">${esc(g.away.name)}</option><option value="home">${esc(g.home.name)}</option></select></label>
          <label class="field">Line<input type="number" step="0.5" id="prLine" value="${pr.line}"></label>
          <label class="field">Odds<input type="number" step="5" id="prOdds" value="${pr.odds}"></label>
        </div>
        <div id="prOut"></div>
        <button class="btn ghost" id="prLog" style="margin-top:10px">Add to bet log</button>
      </div>

      <div class="card span">
        <h3>Stat comparison</h3>
        <div class="cmp-head"><div class="away-c">${esc(g.away.name)}</div><div></div><div class="home-c">${esc(g.home.name)}</div></div>
        <div class="cmp">${cmpRows}</div>
        <p class="small muted" style="margin:10px 0 0">Season-to-date before this game (blended with last season early on). Ranks out of ${nT}; green value is the better side.</p>
      </div>

      <div class="card">
        <h3>What drives our spread</h3>
        <div class="legend"><span class="away-c">◀ toward ${esc(shortName(g.away.name))}</span><span>points</span><span class="home-c">toward ${esc(shortName(g.home.name))} ▶</span></div>
        <div class="factors">${factorRows}</div>
        <p class="small muted" style="margin:10px 0 0">Baseline home margin before factors: ${sgn(g.model.baseline_margin)}.</p>
      </div>
      <div class="card">
        <h3>What drives volatility</h3>
        <div class="legend"><span style="color:var(--good)">◀ steadier</span><span>σ points</span><span style="color:var(--bad)">wilder ▶</span></div>
        <div class="factors">${volRows}</div>
      </div>

      <div class="card span ai" id="aiCard">
        <h3>Analyst read</h3>
        <div id="aiBody">${renderExplain(id)}</div>
      </div>
    </div>`;

  // pricer
  const tSel = document.getElementById("prTeam"); tSel.value = pr.team;
  const updatePricer = () => {
    const cfg = { team: tSel.value, line: Number(document.getElementById("prLine").value), odds: Number(document.getElementById("prOdds").value) };
    const all = store.get("pricer", {}); all[id] = cfg; store.set("pricer", all);
    const p = x.pCover(cfg.team === "home", cfg.line);
    const e = ev(p, cfg.odds), ip = implied(cfg.odds);
    document.getElementById("prOut").innerHTML = `<div class="kv" style="grid-template-columns:1fr auto">
      <span class="lbl">Cover probability</span><span class="val hot">${pct(p)}</span>
      <span class="lbl">Fair odds</span><span class="val">${fairOdds(p)}</span>
      <span class="lbl">Book implied (${ml(cfg.odds)})</span><span class="val">${pct(ip)}</span>
      <span class="lbl">EV per unit</span><span class="val ${e > 0 ? "pos" : "neg"}">${sgn(e, 3)}</span></div>`;
    return { cfg, p };
  };
  ["prTeam", "prLine", "prOdds"].forEach((i) => (document.getElementById(i).oninput = updatePricer));
  updatePricer();
  document.getElementById("prLog").onclick = () => {
    const { cfg, p } = updatePricer();
    const team = cfg.team === "home" ? g.home.name : g.away.name;
    addBet({ desc: `${team} ${line(cfg.line)} (${g.away.name} @ ${g.home.name})`, type: Math.abs(cfg.line) === Math.abs(mk.spread ?? NaN) ? "Spread" : "Alt spread", odds: cfg.odds, stake: 1, prob: Math.round(p * 1000) / 10 });
    document.getElementById("prLog").textContent = "Added ✓";
  };
  wireExplain(id);
}

function distSvg(x, margins) {
  // favorite-perspective margin distribution
  const W = 320, H = 110, lo = x.favMu - 3.2 * x.sd, hi = x.favMu + 3.2 * x.sd;
  const sx = (v) => ((v - lo) / (hi - lo)) * W;
  const pdf = (v) => Math.exp(-0.5 * ((v - x.favMu) / x.sd) ** 2);
  let d = "", fill = "";
  const m0 = margins[0];
  for (let i = 0; i <= 80; i++) {
    const v = lo + (hi - lo) * i / 80, y = H - 18 - pdf(v) * (H - 28);
    d += `${i ? "L" : "M"}${sx(v).toFixed(1)},${y.toFixed(1)}`;
  }
  for (let i = 0; i <= 40; i++) {
    const v = m0 + (hi - m0) * i / 40, y = H - 18 - pdf(v) * (H - 28);
    fill += `${i ? "L" : `M${sx(m0).toFixed(1)},${H - 18}L`}${sx(v).toFixed(1)},${y.toFixed(1)}`;
  }
  fill += `L${W},${H - 18}Z`;
  const tick = (v, lab, col) => (v >= lo && v <= hi ? `<line x1="${sx(v)}" x2="${sx(v)}" y1="8" y2="${H - 18}" stroke="${col}" stroke-dasharray="3 3"/><text x="${sx(v)}" y="${H - 4}" fill="${col}" font-size="10" text-anchor="middle">${lab}</text>` : "");
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Distribution of the favorite's margin">
    <path d="${fill}" fill="rgba(255,107,107,0.25)"/>
    <path d="${d}" fill="none" stroke="var(--accent)" stroke-width="2"/>
    ${tick(0, "0", "#8a9a91")}${margins.map((m) => tick(m, `${m}`, "#ff6b6b")).join("")}
    <text x="4" y="12" fill="#8a9a91" font-size="10">Favorite's margin · shaded = blowout zone</text></svg>`;
}

// ---------------------------------------------------------------- explanations
function renderExplain(id) {
  const st = S.explain[id];
  const keyOk = S.health?.openai_key;
  if (!st) {
    return `<p class="muted small">Generates a game-specific read from the numbers above (our margin drivers, volatility drivers, ranks, and the market). ${keyOk ? "" : "<br><b>OPENAI_API_KEY is not set on the server yet.</b>"}</p>
      <button class="btn" id="aiBtn" ${keyOk ? "" : "disabled"}>Generate analysis</button>`;
  }
  if (st.loading) return `<p class="muted">Thinking through the matchup…</p>`;
  if (st.error) return `<div class="banner err">${esc(st.error)}</div><button class="btn ghost" id="aiBtn">Try again</button>`;
  const e = st.data.explanation || {};
  const list = (arr) => (Array.isArray(arr) ? arr : []);
  return `<div class="headline">${esc(e.headline)}</div>
    <h4>Spread</h4><p>${esc(e.spread_take)}</p>
    <h4>Moneyline</h4><p>${esc(e.moneyline_take)}</p>
    <h4>Blowout risk</h4><p>${esc(e.blowout_take)}</p>
    <h4>Key matchups</h4><ul>${list(e.key_matchups).map((k) => `<li><b>${esc(k.title)}:</b> ${esc(k.detail)}</li>`).join("")}</ul>
    <h4>What would make us wrong</h4><ul>${list(e.risks).map((r) => `<li>${esc(r)}</li>`).join("")}</ul>
    <p class="small muted">${esc(st.data.model)} · ${st.data.cached ? "cached" : "fresh"} · <button class="link-btn" id="aiRegen">regenerate</button></p>`;
}

function wireExplain(id) {
  const go = async (force) => {
    S.explain[id] = { loading: true };
    document.getElementById("aiBody").innerHTML = renderExplain(id);
    try {
      const data = await api("/api/explain", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ gameId: id, force }) });
      S.explain[id] = { data };
    } catch (e) {
      S.explain[id] = { error: e.message };
    }
    const body = document.getElementById("aiBody");
    if (body) { body.innerHTML = renderExplain(id); wireExplain(id); }
  };
  const btn = document.getElementById("aiBtn");
  if (btn) btn.onclick = () => go(false);
  const re = document.getElementById("aiRegen");
  if (re) re.onclick = () => go(true);
}

// ---------------------------------------------------------------- report card
function viewReport() {
  const c = S.card;
  if (!c) { $view.innerHTML = `<h1>Report Card</h1><div class="empty">No report card yet. Run the engine with --retrain.</div>`; return; }
  const st = store.get("report", { tab: "backtest" });
  const sec = st.tab === "live" ? c.live?.overall : c.backtest?.overall;
  const title = st.tab === "live" ? `${c.live?.season} season, graded weekly` : `Walk-forward backtest ${(c.backtest?.seasons || []).join(", ")}`;

  $view.innerHTML = `${c.mock ? `<div class="banner">Report card built from <b>sample data</b>.</div>` : ""}
    <div class="page-head"><div><h1>Report Card</h1>
      <div class="sub">Model v${c.model_version} · trained ${esc(c.trained_at)} on ${c.train_info?.games ?? "?"} games · updated ${esc(c.updated_at)}</div></div>
      <div class="seg"><button data-t="backtest" class="${st.tab !== "live" ? "on" : ""}">Backtest</button><button data-t="live" class="${st.tab === "live" ? "on" : ""}">This season</button></div>
    </div>
    <h2>${esc(title)}</h2>
    ${!sec || !sec.games ? `<div class="empty">No graded games yet. Results appear after the first week is graded.</div>` : reportBody(sec)}
    ${st.tab === "live" && c.live?.weeks?.length ? weeklyTable(c.live.weeks) : ""}
    <div class="grid2" style="margin-top:12px">
      <div class="card"><h3>Feature weights (points per 1 SD)</h3><div class="factors">${weightRows(c.feature_weights || [])}</div></div>
      <div class="card"><h3>Settings</h3><div class="kv" style="grid-template-columns:1fr auto">
        <span class="lbl">Ridge alpha</span><span class="val">${c.settings?.ridge_alpha}</span>
        <span class="lbl">Market blend</span><span class="val">${c.settings?.market_blend}</span>
        <span class="lbl">Prior-season weight (games)</span><span class="val">${c.settings?.prior_games_weight}</span>
        <span class="lbl">σ range</span><span class="val">${(c.settings?.sigma_range || []).join("–")}</span></div>
        <p class="small muted" style="margin:10px 0 0">Change these in engine/config.json, then run with --retrain.</p></div>
    </div>`;
  $view.querySelectorAll(".seg button").forEach((bt) => (bt.onclick = () => { store.set("report", { tab: bt.dataset.t }); viewReport(); }));
}

function reportBody(s) {
  const ats = s.ats || {}, mlr = s.moneyline || {};
  const better = (a, b) => (a != null && b != null ? (a <= b ? "pos" : "neg") : "");
  return `<div class="big3" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr))">
      <div class="tile"><div class="k">Margin error (MAE)</div><div class="v ${better(s.margin_mae_model, s.margin_mae_market)}">${s.margin_mae_model}</div><div class="s">market ${s.margin_mae_market ?? "—"} · ${s.games} games</div></div>
      <div class="tile"><div class="k">Win prob (Brier)</div><div class="v ${better(s.brier_model, s.brier_market)}">${s.brier_model ?? "—"}</div><div class="s">market ${s.brier_market ?? "—"} · lower is better</div></div>
      <div class="tile"><div class="k">Within 1σ</div><div class="v ${Math.abs((s.within_1_sigma ?? 0.68) - 0.68) < 0.04 ? "pos" : "neg"}">${pct(s.within_1_sigma)}</div><div class="s">target ~68% · avg σ ${s.avg_sigma}</div></div>
      <div class="tile"><div class="k">Spread picks (${ats.threshold_pts}+ pts)</div><div class="v ${ats.win_pct > 0.524 ? "pos" : "neg"}">${ats.wins}-${ats.losses}${ats.pushes ? `-${ats.pushes}` : ""}</div><div class="s">${pct(ats.win_pct)} · ${sgn(ats.units, 1)}u at -110</div></div>
      <div class="tile"><div class="k">ML picks (${pct(mlr.threshold, 0)}+ edge)</div><div class="v ${mlr.units > 0 ? "pos" : "neg"}">${sgn(mlr.units, 1)}u</div><div class="s">${mlr.wins}/${mlr.bets} won · ROI ${pct(mlr.roi)} · favs ${sgn(mlr.fav_units, 1)}u</div></div>
    </div>
    <div class="grid2">
      <div class="card"><h3>Calibration: when we say X%, does the favorite win X%?</h3>${calSvg(s.calibration || [])}
        <div class="table-wrap" style="margin-top:8px"><table><thead><tr><th>Bin</th><th>Games</th><th>Predicted</th><th>Actual</th></tr></thead>
        <tbody>${(s.calibration || []).map((c) => `<tr><td>${c.bin}</td><td>${c.n}</td><td class="num">${pct(c.predicted)}</td><td class="num">${pct(c.actual)}</td></tr>`).join("")}</tbody></table></div></div>
      <div class="card"><h3>Blowout risk on the alt-dog band (${s.blowout?.games ?? 0} games)</h3>
        ${(s.blowout?.by_margin || []).map((bm) => `<p class="small" style="margin:6px 0">Fav by more than <b>${bm.margin}</b>: predicted ${pct(bm.predicted_rate)}, actual ${pct(bm.actual_rate)} (flat-σ baseline ${pct(bm.flat_sigma_baseline)}). Alt +${bm.margin} hit rate: all ${pct(bm.alt_dog_hit_rate_all)}, our lowest-risk third <b class="hot">${pct(bm.alt_dog_hit_rate_lowest_third)}</b>.</p>
          <div class="table-wrap"><table><thead><tr><th>Group</th><th>Games</th><th>Predicted</th><th>Actual</th></tr></thead><tbody>
          ${bm.terciles.map((t) => `<tr><td>${t.group}</td><td>${t.n}</td><td class="num">${pct(t.predicted)}</td><td class="num">${pct(t.actual)}</td></tr>`).join("")}</tbody></table></div>`).join("")}
        <p class="small muted">If the ranking works, "Actual" should rise from the lowest-risk third to the highest.</p></div>
    </div>
    <div class="card" style="margin-top:12px"><h3>Totals</h3><p class="small" style="margin:0">Total points MAE: ours ${s.total_mae_model} vs market ${s.total_mae_market ?? "—"}. Log loss ${s.log_loss_model}.</p></div>`;
}

function weeklyTable(weeks) {
  return `<h2 style="margin-top:16px">By week</h2><div class="table-wrap"><table>
    <thead><tr><th>Week</th><th>Games</th><th>Our MAE</th><th>Market MAE</th><th>Within 1σ</th><th>Spread picks</th><th>ML units</th></tr></thead>
    <tbody>${weeks.map((w) => `<tr><td>${w.week}</td><td>${w.games}</td><td class="num">${w.margin_mae_model ?? "—"}</td><td class="num">${w.margin_mae_market ?? "—"}</td><td class="num">${pct(w.within_1_sigma, 0)}</td>
      <td class="num">${w.ats ? `${w.ats.wins}-${w.ats.losses}` : "—"}</td><td class="num">${w.moneyline ? sgn(w.moneyline.units, 1) : "—"}</td></tr>`).join("")}</tbody></table></div>`;
}

function weightRows(ws) {
  const mx = Math.max(0.5, ...ws.map((w) => Math.abs(w.points_per_sd)));
  return ws.map((w) => {
    const wd = Math.abs(w.points_per_sd) / mx * 50, left = w.points_per_sd >= 0 ? 50 : 50 - wd;
    return `<div class="frow"><span>${esc(w.label)}</span><div class="fbar"><div class="mid"></div><div class="fill" style="left:${left}%;width:${wd}%;background:var(--accent)"></div></div><span class="pts">${sgn(w.points_per_sd, 2)}</span></div>`;
  }).join("");
}

function calSvg(cal) {
  const W = 300, H = 200, p = 28;
  const sx = (v) => p + (v - 0.5) / 0.5 * (W - p - 8), sy = (v) => H - p - (v - 0.5) / 0.5 * (H - p - 8);
  const dots = cal.map((c) => `<circle cx="${sx(c.predicted)}" cy="${sy(Math.max(0.5, c.actual))}" r="${Math.min(9, 3 + Math.sqrt(c.n) / 3)}" fill="var(--accent)" opacity="0.85"><title>${c.bin}: predicted ${pct(c.predicted)}, actual ${pct(c.actual)}, n=${c.n}</title></circle>`).join("");
  const ticks = [0.5, 0.6, 0.7, 0.8, 0.9, 1].map((v) => `<text x="${sx(v)}" y="${H - 10}" font-size="10" fill="#8a9a91" text-anchor="middle">${v * 100}</text><text x="${p - 6}" y="${sy(v) + 3}" font-size="10" fill="#8a9a91" text-anchor="end">${v * 100}</text>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:420px;display:block">
    <line x1="${sx(0.5)}" y1="${sy(0.5)}" x2="${sx(1)}" y2="${sy(1)}" stroke="#3d4d45" stroke-dasharray="4 4"/>${ticks}${dots}
    <text x="${W / 2}" y="${H}" font-size="10" fill="#8a9a91" text-anchor="middle">predicted %</text></svg>`;
}

// ---------------------------------------------------------------- bet log
function addBet(b) {
  const bets = store.get("bets", []);
  bets.unshift({ id: Date.now(), date: new Date().toISOString().slice(0, 10), status: "pending", ...b });
  store.set("bets", bets);
}

function viewBets() {
  const bets = store.get("bets", []);
  const settled = bets.filter((b) => b.status === "won" || b.status === "lost" || b.status === "push");
  let staked = 0, net = 0, w = 0, l = 0, expSum = 0, expN = 0;
  for (const b of settled) {
    const st = Number(b.stake) || 0;
    if (b.status === "push") continue;
    staked += st;
    if (b.status === "won") { w++; net += st * profit(Number(b.odds)); } else { l++; net -= st; }
    if (b.prob) { expSum += (b.prob / 100) * profit(Number(b.odds)) * st - (1 - b.prob / 100) * st; expN++; }
  }
  $view.innerHTML = `<div class="page-head"><div><h1>Bet Log</h1>
      <div class="sub">Saved in this browser only. Use Export/Import to move it between your phone and laptop.</div></div>
      <div style="display:flex;gap:8px"><button class="btn ghost" id="exp">Export</button><label class="btn ghost" style="cursor:pointer">Import<input type="file" id="imp" accept="application/json" hidden></label></div></div>
    <div class="big3">
      <div class="tile"><div class="k">Record</div><div class="v">${w}-${l}</div><div class="s">${bets.length - settled.length} pending</div></div>
      <div class="tile"><div class="k">Profit</div><div class="v ${net >= 0 ? "pos" : "neg"}">${sgn(net, 2)}u</div><div class="s">ROI ${staked ? pct(net / staked) : "—"}</div></div>
      <div class="tile"><div class="k">Expected (from our %)</div><div class="v">${expN ? sgn(expSum, 2) + "u" : "—"}</div><div class="s">compare to actual profit over time</div></div>
    </div>
    <div class="card" style="margin-bottom:12px"><h3>Add a bet</h3>
      <form class="bet-form" id="bf">
        <label class="field" style="grid-column:span 2">Description<input name="desc" required placeholder="e.g. Team +17.5 or 3-leg ML parlay"></label>
        <label class="field">Type<select name="type"><option>Moneyline</option><option>Spread</option><option>Alt spread</option><option>Parlay</option><option>Total</option></select></label>
        <label class="field">Odds (American)<input name="odds" type="number" required value="-110"></label>
        <label class="field">Stake (units)<input name="stake" type="number" step="0.1" value="1"></label>
        <label class="field">Our win % (optional)<input name="prob" type="number" step="0.1" placeholder="e.g. 84.2"></label>
        <button class="btn" type="submit">Add</button>
      </form></div>
    <div class="table-wrap"><table><thead><tr><th>Bet</th><th>Date</th><th>Odds</th><th>Stake</th><th>Our %</th><th>Result</th><th></th></tr></thead>
    <tbody>${bets.map((b) => `<tr><td><div class="team">${esc(b.desc)}</div><div class="opp">${esc(b.type)}</div></td><td>${esc(b.date)}</td>
      <td class="num">${ml(Number(b.odds))}</td><td class="num">${b.stake}</td><td class="num">${b.prob ? b.prob + "%" : "—"}</td>
      <td><select class="status-sel" data-id="${b.id}">${["pending", "won", "lost", "push"].map((s) => `<option ${b.status === s ? "selected" : ""}>${s}</option>`).join("")}</select></td>
      <td><button class="link-btn" data-del="${b.id}">delete</button></td></tr>`).join("") || `<tr><td colspan="7" class="muted">No bets yet. Add one above or use "Add to bet log" on a game page.</td></tr>`}</tbody></table></div>`;

  document.getElementById("bf").onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    addBet({ desc: f.get("desc"), type: f.get("type"), odds: Number(f.get("odds")), stake: Number(f.get("stake")) || 1, prob: f.get("prob") ? Number(f.get("prob")) : null });
    viewBets();
  };
  $view.querySelectorAll(".status-sel").forEach((s) => (s.onchange = () => {
    const all = store.get("bets", []); const b = all.find((x) => String(x.id) === s.dataset.id);
    if (b) { b.status = s.value; store.set("bets", all); viewBets(); }
  }));
  $view.querySelectorAll("[data-del]").forEach((d) => (d.onclick = () => {
    if (!confirm("Delete this bet?")) return;
    store.set("bets", store.get("bets", []).filter((x) => String(x.id) !== d.dataset.del)); viewBets();
  }));
  document.getElementById("exp").onclick = () => {
    const blob = new Blob([JSON.stringify(store.get("bets", []), null, 1)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `cfb-edge-bets-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  };
  document.getElementById("imp").onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const incoming = JSON.parse(await file.text());
      if (!Array.isArray(incoming)) throw new Error("bad file");
      const cur = store.get("bets", []); const ids = new Set(cur.map((b) => b.id));
      store.set("bets", [...incoming.filter((b) => !ids.has(b.id)), ...cur].sort((a, b) => b.id - a.id));
      viewBets();
    } catch { alert("That file isn't a CFB Edge bet export."); }
  };
}

// ---------------------------------------------------------------- utils
function round1(x) { return x == null ? null : Math.round(x * 2) / 2; }
function shortName(n) { return String(n || ""); }
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

loadAll();
