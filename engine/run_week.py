"""Weekly pipeline: (re)train, backtest, grade last week, predict this week.

Usage (from the project root):
    python engine/run_week.py --week 9                # predict week 9 with the latest model
    python engine/run_week.py --week 9 --retrain      # retrain + backtest first (new model version)
    python engine/run_week.py --week 9 --mock         # same, using synthetic test data

Outputs:
    data/predictions.json                      what the site shows this week
    data/report_card.json                      backtest + live results for the Report Card page
    engine/models/model_vN.json                versioned model (readable weights)
    engine/history/predictions_<season>_w<W>.json   archived predictions, graded next week
    engine/reports/weekly_report_<season>_w<W>.md   THE FILE TO UPLOAD TO CLAUDE ON SUNDAY
"""
import argparse
import datetime as dt
import json
import os
import re
import sys
from pathlib import Path

ENGINE = Path(__file__).resolve().parent
ROOT = ENGINE.parent
sys.path.insert(0, str(ENGINE))

from cfbd_client import CFBDClient, CFBDError  # noqa: E402
from data import load_season  # noqa: E402
from features import SeasonIndex, QBIndex, build_rows  # noqa: E402
from model import Engine, norm_cdf  # noqa: E402
from evaluate import summarize, market_probs, american_to_prob  # noqa: E402

MODELS = ENGINE / "models"
HISTORY = ENGINE / "history"
REPORTS = ENGINE / "reports"
DATA = ROOT / "data"


def load_env():
    env_file = ROOT / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def load_config():
    return json.loads((ENGINE / "config.json").read_text())


def latest_model_path():
    files = sorted(MODELS.glob("model_v*.json"), key=lambda p: int(re.findall(r"v(\d+)", p.name)[0]))
    return files[-1] if files else None


def now_iso():
    return dt.datetime.now().replace(microsecond=0).isoformat()


SNAP_KEYS = ["off_ppa", "def_ppa", "off_sr", "def_sr", "off_expl", "def_expl", "off_rush_ppa",
             "def_rush_ppa", "off_pass_ppa", "def_pass_ppa", "havoc_forced", "havoc_allowed",
             "pts_for", "pts_against", "off_plays", "talent"]


def snap_out(s):
    return {k: (round(s[k], 4) if isinstance(s.get(k), float) else s.get(k)) for k in SNAP_KEYS}


def game_entry(row, pred):
    gm = row["game"]
    return {
        "id": gm["id"], "season": gm["season"], "week": gm["week"], "start": gm["start"],
        "neutral": gm["neutral"],
        "home": {"name": gm["home"], "conf": gm["home_conf"], "elo": gm["home_elo"],
                 "games": row["home_snap"]["games"], "stats": snap_out(row["home_snap"])},
        "away": {"name": gm["away"], "conf": gm["away_conf"], "elo": gm["away_elo"],
                 "games": row["away_snap"]["games"], "stats": snap_out(row["away_snap"])},
        "model": {k: pred[k] for k in ("margin", "model_margin", "total", "sigma", "home_win_prob", "baseline_margin")},
        "market": row["market"],
        "factors": pred["factors"],
        "vol_factors": pred["vol_factors"],
        "qb": {"home": qb_out(row.get("home_qb")), "away": qb_out(row.get("away_qb"))},
    }


def qb_out(q):
    if not q or not q.get("known"):
        return {"known": False, "flag": 0}
    return {k: q.get(k) for k in ("known", "name", "starts", "new", "inexperienced", "flag", "reason")}


def dog_qb_note(entry, home_fav):
    """Text warning if the underdog's QB is flagged (the risk for alt-dog bets)."""
    q = (entry.get("qb") or {}).get("away" if home_fav else "home") or {}
    return f" [QB FLAG: {q.get('name')}, {q.get('reason')}]" if q.get("flag") else ""


def blowout_info(entry, m):
    """Favorite = market favorite (model favorite if no line)."""
    sp = entry["market"].get("spread")
    mu, sig = entry["model"]["margin"], entry["model"]["sigma"]
    home_fav = (sp < 0) if sp is not None else (mu > 0)
    fav_mu = mu if home_fav else -mu
    p = 1 - norm_cdf((m - fav_mu) / sig)
    return home_fav, p


def pct(x):
    return "n/a" if x is None else f"{x * 100:.1f}%"


def fmt_line(sp):
    return "n/a" if sp is None else (f"{sp:+.1f}" if sp != 0 else "PK")


# ----------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int)
    ap.add_argument("--week", type=int, required=True)
    ap.add_argument("--retrain", action="store_true", help="retrain and backtest before predicting")
    ap.add_argument("--mock", action="store_true", help="use synthetic data (no API key needed)")
    ap.add_argument("--note", default="", help="changelog note describing what you changed this run")
    args = ap.parse_args()

    load_env()
    cfg = load_config()
    today = dt.date.today()
    season = args.season or (2026 if args.mock else (today.year if today.month >= 3 else today.year - 1))
    week = args.week
    global MODELS, HISTORY, REPORTS
    if args.mock:  # keep sample-data runs fully separate from real model history
        MODELS, HISTORY, REPORTS = (ENGINE / "mock" / "models", ENGINE / "mock" / "history", ENGINE / "mock" / "reports")
    for d in (MODELS, HISTORY, REPORTS, DATA):
        d.mkdir(parents=True, exist_ok=True)

    mock = None
    if args.mock:
        from mock_data import MockCFBD
        print("Using MOCK data (fictional teams).")
        mock = MockCFBD()
    client = CFBDClient(os.environ.get("CFBD_API_KEY"), ENGINE / "cache", season,
                        cfg["data"]["current_season_cache_hours"], mock=mock)

    train_seasons = [s for s in cfg["data"]["train_seasons"] if s < season]
    needed = set(train_seasons) | {s - 1 for s in train_seasons} | {season, season - 1}
    print(f"Loading seasons {sorted(needed)} ...")
    seasons, idx = {}, {}
    try:
        for s in sorted(needed):
            sd = load_season(client, s, cfg)
            if not sd["games"]:
                print(f"  {s}: no games returned, skipping")
                continue
            seasons[s] = sd
            idx[s] = SeasonIndex(sd)
            print(f"  {s}: {len(sd['games'])} games, {len(sd['lines'])} lines, {len(sd['adv'])} team-game stat rows, "
                  f"{len(sd.get('qb') or {})} QB starts")
    except CFBDError as e:
        sys.exit(f"\nERROR: {e}")
    if not args.mock:
        print(f"CFBD API calls used this run: {client.calls_made}")
    qcfg = cfg.get("qb", {})
    qbi = QBIndex(seasons, qcfg.get("inexperienced_starts", 3)) if qcfg.get("enabled", True) else None
    if qbi is not None and not qbi.has_data:
        print("  (no QB data returned; QB flag features will be 0)")
    if season not in seasons:
        sys.exit(f"No data for season {season}.")

    card_path = DATA / "report_card.json"
    card = json.loads(card_path.read_text()) if card_path.exists() else {}

    # ---- train / backtest --------------------------------------------------
    mp = latest_model_path()
    retrained = False
    if args.retrain or mp is None:
        retrained = True
        print("Backtesting (walk-forward) ...")
        bt_items, per_season = [], {}
        for T in cfg["data"]["backtest_seasons"]:
            if T not in seasons:
                continue
            tr = build_rows(seasons, idx, cfg, qb=qbi, season_filter={s for s in train_seasons if s < T})
            te = build_rows(seasons, idx, cfg, qb=qbi, season_filter={T})
            if len(tr) < 200 or not te:
                continue
            eng = Engine(cfg).fit(tr)
            items = [{"row": r, "pred": eng.predict_row(r)} for r in te]
            per_season[str(T)] = summarize(items, cfg)
            bt_items += items
            print(f"  {T}: trained on {len(tr)} games, tested on {len(te)}")
        backtest = {"overall": summarize(bt_items, cfg), "by_season": per_season,
                    "seasons": cfg["data"]["backtest_seasons"]}

        print("Training final model ...")
        rows = build_rows(seasons, idx, cfg, qb=qbi, season_filter=set(train_seasons))
        if cfg["data"]["include_current_season_in_training"]:
            cur = build_rows(seasons, idx, cfg, qb=qbi, season_filter={season})
            rows += [r for r in cur if r["game"]["week"] < week]
        eng = Engine(cfg).fit(rows)
        version = (int(re.findall(r"v(\d+)", mp.name)[0]) + 1) if mp else 1
        model_json = eng.to_json(version, now_iso())
        mp = MODELS / f"model_v{version}.json"
        mp.write_text(json.dumps(model_json, indent=2))
        card["backtest"] = backtest
        print(f"Saved {mp.relative_to(ROOT)} (trained on {len(rows)} games)")

        cl = (ENGINE / "mock" / "CHANGELOG.md") if args.mock else (ROOT / "CHANGELOG.md")
        entry = (f"\n## v{version} — {today.isoformat()} (season {season}, before week {week})\n"
                 f"- Trained on {len(rows)} games; backtest margin MAE {backtest['overall'].get('margin_mae_model')} "
                 f"(market {backtest['overall'].get('margin_mae_market')})\n"
                 f"- Note: {args.note or '(no note given)'}\n")
        cl.write_text((cl.read_text() if cl.exists() else "# Model changelog\n") + entry)
    else:
        model_json = json.loads(mp.read_text())
        eng = Engine.from_json(model_json, cfg)
        print(f"Using existing {mp.name} (pass --retrain to rebuild)")

    # ---- grade last week ---------------------------------------------------
    live_path = HISTORY / "live_results.json"
    live = json.loads(live_path.read_text()) if live_path.exists() else {}
    graded_last = []
    prev_file = HISTORY / f"predictions_{season}_w{week - 1}.json"
    if prev_file.exists():
        prev = json.loads(prev_file.read_text())
        results = {gm["id"]: gm for gm in seasons[season]["games"] if gm["completed"]}
        for e in prev["games"]:
            gm = results.get(e["id"])
            if not gm:
                continue
            rec = {"entry": e, "margin": gm["home_pts"] - gm["away_pts"], "total": gm["home_pts"] + gm["away_pts"],
                   "home_pts": gm["home_pts"], "away_pts": gm["away_pts"], "season": season, "week": week - 1,
                   "model_version": prev.get("model_version")}
            live[str(e["id"])] = rec
            graded_last.append(rec)
        live_path.write_text(json.dumps(live))
        print(f"Graded {len(graded_last)} games from week {week - 1}")

    def to_items(recs):
        return [{"row": {"margin": r["margin"], "total": r["total"], "market": r["entry"]["market"]},
                 "pred": r["entry"]["model"]} for r in recs]

    live_season = [r for r in live.values() if r["season"] == season]
    weeks = sorted({r["week"] for r in live_season})
    card["live"] = {
        "season": season,
        "overall": summarize(to_items(live_season), cfg),
        "weeks": [{"week": w, **{k: v for k, v in summarize(to_items([r for r in live_season if r["week"] == w]), cfg).items()
                                  if k in ("games", "margin_mae_model", "margin_mae_market", "within_1_sigma", "ats", "moneyline", "blowout")}}
                  for w in weeks],
    }

    # ---- predict this week ---------------------------------------------------
    rows = build_rows(seasons, idx, cfg, qb=qbi, only_completed=False, week=week, season_filter={season})
    entries = [game_entry(r, eng.predict_row(r)) for r in rows]
    entries.sort(key=lambda e: (e["start"] or "", e["home"]["name"]))

    # League ranks for every stat (1 = best), across all teams with data this season.
    from features import team_snapshot
    k = cfg["features"]["prior_games_weight"]
    all_teams = list(idx[season].logs.keys())
    snaps = {t: team_snapshot(t, idx[season], week, idx.get(season - 1), k) for t in all_teams}
    lower_better = {"def_ppa", "def_sr", "def_expl", "def_rush_ppa", "def_pass_ppa", "havoc_allowed", "pts_against"}
    ranks = {t: {} for t in all_teams}
    for key in SNAP_KEYS:
        if key == "off_plays":
            continue  # pace is style, not good/bad
        order = sorted(all_teams, key=lambda t: snaps[t][key], reverse=key not in lower_better)
        for i, t in enumerate(order):
            ranks[t][key] = i + 1
    for e in entries:
        for side in ("home", "away"):
            e[side]["ranks"] = ranks.get(e[side]["name"], {})

    preds = {"season": season, "week": week, "generated_at": now_iso(), "model_version": model_json["version"],
             "mock": bool(args.mock), "betting": cfg["betting"], "labels": cfg["features"]["labels"],
             "n_teams": len(all_teams), "line_provider_preference": cfg["data"]["line_provider_preference"],
             "games": entries}
    (DATA / "predictions.json").write_text(json.dumps(preds, indent=1))
    (HISTORY / f"predictions_{season}_w{week}.json").write_text(json.dumps(preds))
    print(f"Predicted {len(entries)} games for {season} week {week}")

    # ---- report card -------------------------------------------------------------
    mm = model_json["margin_model"]
    card.update({
        "model_version": model_json["version"], "trained_at": model_json["trained_at"],
        "train_info": model_json["train_info"], "updated_at": now_iso(), "mock": bool(args.mock),
        "feature_weights": sorted(
            [{"key": k, "label": cfg["features"]["labels"].get(k, k), "points_per_sd": round(c, 2)}
             for k, c in zip(mm["features"], mm["coefs_per_sd"])], key=lambda d: -abs(d["points_per_sd"])),
        "settings": {"ridge_alpha": cfg["model"]["ridge_alpha"], "market_blend": cfg["model"]["market_blend"],
                     "prior_games_weight": cfg["features"]["prior_games_weight"],
                     "sigma_range": [cfg["model"]["sigma_min"], cfg["model"]["sigma_max"]]},
    })
    card_path.write_text(json.dumps(card, indent=1))

    report = write_report(season, week, cfg, model_json, card, graded_last, entries, retrained, args)
    print(f"\nWeekly report: {report.relative_to(ROOT)}  <- upload this to Claude on Sunday")


# ----------------------------------------------------------------------------

def write_report(season, week, cfg, model_json, card, graded_last, entries, retrained, args):
    bc = cfg["betting"]
    L = []
    L.append(f"# CFB Edge weekly report: {season} week {week}")
    L.append(f"Generated {now_iso()} | model v{model_json['version']} (trained {model_json['trained_at']})"
             f"{' | RETRAINED THIS RUN' if retrained else ''}{' | MOCK DATA' if args.mock else ''}")
    ti = model_json["train_info"]
    L.append(f"Training: {ti.get('games')} games, seasons {ti.get('seasons')}, out-of-fold margin MAE {ti.get('oof_margin_mae'):.2f}")
    L.append("\n## Key settings")
    L.append("```json\n" + json.dumps({"features": {k: cfg["features"][k] for k in ("prior_games_weight", "margin_features", "total_features", "volatility_features")},
                                         "model": {k: v for k, v in cfg["model"].items() if not k.startswith("_")},
                                         "betting": {k: v for k, v in bc.items() if not k.startswith("_")}}, indent=1) + "\n```")

    flags = []

    def metric_block(title, s):
        L.append(f"\n### {title}")
        if not s or not s.get("games"):
            L.append("No graded games.")
            return
        L.append(f"- Games: {s['games']}")
        L.append(f"- Margin MAE: model {s.get('margin_mae_model')} vs market {s.get('margin_mae_market')}")
        L.append(f"- Total MAE: model {s.get('total_mae_model')} vs market {s.get('total_mae_market')}")
        if s.get("brier_model") is not None:
            L.append(f"- Win prob Brier (lower is better): model {s['brier_model']} vs market {s['brier_market']} ({s['brier_games']} games)")
        L.append(f"- Results within 1 sigma: {pct(s.get('within_1_sigma'))} (target ~68%), avg sigma {s.get('avg_sigma')}")
        if s.get("calibration"):
            L.append("- Calibration (favorite win %): " + "; ".join(
                f"{c['bin']}: pred {pct(c['predicted'])} / actual {pct(c['actual'])} (n={c['n']})" for c in s["calibration"]))
        a = s.get("ats", {})
        L.append(f"- Spread picks (edge >= {a.get('threshold_pts')} pts): {a.get('wins')}-{a.get('losses')}-{a.get('pushes')}, "
                 f"win {pct(a.get('win_pct'))}, units {a.get('units')} (52.4% breaks even)")
        m = s.get("moneyline", {})
        L.append(f"- ML picks (edge >= {pct(m.get('threshold'))}): {m.get('wins')}/{m.get('bets')} won, units {m.get('units')}, "
                 f"ROI {pct(m.get('roi'))}; favorites only: {m.get('fav_bets')} bets, {m.get('fav_units')} units")
        for b in s.get("blowout", {}).get("by_margin", []):
            L.append(f"- Fav by more than {b['margin']} (market fav {bc['alt_dog_spread_range'][0]}-{bc['alt_dog_spread_range'][1]}, "
                     f"{s['blowout']['games']} games): predicted {pct(b['predicted_rate'])}, actual {pct(b['actual_rate'])}, "
                     f"flat-sigma baseline {pct(b['flat_sigma_baseline'])}")
            L.append(f"  - Alt dog +{b['margin']} hit rate: all band games {pct(b['alt_dog_hit_rate_all'])}, "
                     f"our lowest-risk third {pct(b['alt_dog_hit_rate_lowest_third'])}")
            for t in b["terciles"]:
                L.append(f"  - {t['group']}: predicted {pct(t['predicted'])}, actual {pct(t['actual'])} (n={t['n']})")
        for q in s.get("blowout", {}).get("qb_split", []):
            L.append(f"- {q['group']} ({q['n']} band games): " + ", ".join(
                f"fav by more than {m}: predicted {pct(q.get(f'pred_{m}'))}, actual {pct(q.get(f'actual_{m}'))}"
                for m in bc["blowout_margins"]))
        # auto flags for tuning
        w1 = s.get("within_1_sigma")
        if w1 is not None and s["games"] >= 40:
            if w1 < 0.62:
                flags.append(f"{title}: only {pct(w1)} of results within 1 sigma, sigma may be too small (raise sigma_min?).")
            if w1 > 0.75:
                flags.append(f"{title}: {pct(w1)} of results within 1 sigma, sigma may be too large.")
        if s.get("margin_mae_market") and s.get("margin_mae_model") and s["games"] >= 40 \
                and s["margin_mae_model"] - s["margin_mae_market"] > 0.75:
            flags.append(f"{title}: model margin error is {s['margin_mae_model'] - s['margin_mae_market']:.2f} pts worse than the market; "
                         "consider market_blend 0.3-0.5 or more conservative ridge_alpha.")
        for c in s.get("calibration", []):
            if c["n"] >= 30 and abs(c["predicted"] - c["actual"]) > 0.06:
                flags.append(f"{title}: calibration off in the {c['bin']} bin (pred {pct(c['predicted'])}, actual {pct(c['actual'])}).")

    L.append(f"\n## Last week graded (week {week - 1})")
    if graded_last:
        metric_block(f"Week {week - 1}", summarize([{"row": {"margin": r["margin"], "total": r["total"], "market": r["entry"]["market"]},
                                                     "pred": r["entry"]["model"]} for r in graded_last], cfg))
        L.append("\n#### Biggest misses")
        misses = sorted(graded_last, key=lambda r: -abs(r["margin"] - r["entry"]["model"]["margin"]))[:6]
        for r in misses:
            e = r["entry"]
            L.append(f"- {e['away']['name']} @ {e['home']['name']}: predicted home {e['model']['margin']:+.1f} "
                     f"(sigma {e['model']['sigma']}), market {fmt_line(e['market'].get('spread'))}, "
                     f"final {r['away_pts']:.0f}-{r['home_pts']:.0f} (home {r['margin']:+.0f}). "
                     f"Top factors: " + ", ".join(f"{f['label']} {f['points']:+.1f}" for f in e["factors"][:3]))
        lo, hi = bc["alt_dog_spread_range"]
        band = [r for r in graded_last if r["entry"]["market"].get("spread") is not None and lo <= abs(r["entry"]["market"]["spread"]) <= hi]
        if band:
            L.append(f"\n#### Alt-dog band games (market fav by {lo}-{hi}), sorted by our blowout risk")
            rows = []
            for r in band:
                e = r["entry"]
                home_fav, p18 = blowout_info(e, bc["blowout_margins"][0])
                fav, dog = (e["home"]["name"], e["away"]["name"]) if home_fav else (e["away"]["name"], e["home"]["name"])
                fav_margin = r["margin"] if home_fav else -r["margin"]
                rows.append((p18, f"- {dog} (+{abs(e['market']['spread'])}) vs {fav}: blowout risk {pct(p18)}; "
                                   f"fav won by {fav_margin:+.0f}; " + dog_qb_note(e, home_fav).strip() + (" " if dog_qb_note(e, home_fav) else "") + ", ".join(
                                       f"+{m} {'HIT' if fav_margin < m else 'MISS'}" for m in bc["blowout_margins"])))
            for _, line in sorted(rows):
                L.append(line)
    else:
        L.append("No archived predictions for last week (first run, or last week was not predicted).")

    metric_block(f"Season {season} live so far", card.get("live", {}).get("overall"))
    if card.get("backtest"):
        metric_block(f"Backtest {card['backtest'].get('seasons')}", card["backtest"].get("overall"))

    L.append("\n## Feature weights (points of home margin per 1 standard deviation)")
    for fw in card.get("feature_weights", []):
        L.append(f"- {fw['label']} ({fw['key']}): {fw['points_per_sd']:+.2f}")

    L.append(f"\n## This week (week {week}) highlights")
    lo, hi = bc["alt_dog_spread_range"]
    band = [e for e in entries if e["market"].get("spread") is not None and lo <= abs(e["market"]["spread"]) <= hi]
    scored = []
    for e in band:
        home_fav, p18 = blowout_info(e, bc["blowout_margins"][0])
        _, p22 = blowout_info(e, bc["blowout_margins"][1])
        dog = e["away"]["name"] if home_fav else e["home"]["name"]
        scored.append((p18, f"- {dog} +{abs(e['market']['spread'])}: P(fav by 18+) {pct(p18)}, P(fav by 22+) {pct(p22)}, sigma {e['model']['sigma']}"
                            + dog_qb_note(e, home_fav)))
    L.append("\n### Lowest blowout risk (alt-dog candidates)")
    L += [s for _, s in sorted(scored)[:10]] or ["None in band."]
    L.append("\n### Largest ML edges (model prob minus no-vig implied)")
    ml = []
    for e in entries:
        ph, pa = market_probs(e["market"], bc["remove_vig"])
        if ph is None:
            continue
        p = e["model"]["home_win_prob"]
        for name, mp_, ip, odds in ((e["home"]["name"], p, ph, e["market"]["home_ml"]), (e["away"]["name"], 1 - p, pa, e["market"]["away_ml"])):
            ml.append((mp_ - ip, f"- {name} {odds:+.0f}: model {pct(mp_)} vs implied {pct(ip)} (edge {(mp_ - ip) * 100:+.1f} pts)"))
    L += [s for _, s in sorted(ml, reverse=True)[:10]] or ["No moneylines available."]
    L.append("\n### Biggest spread disagreements")
    dis = []
    for e in entries:
        sp = e["market"].get("spread")
        if sp is None:
            continue
        dis.append((abs(e["model"]["margin"] + sp), f"- {e['away']['name']} @ {e['home']['name']}: market home {fmt_line(sp)}, model home {fmt_line(-e['model']['margin'])}"))
    L += [s for _, s in sorted(dis, reverse=True)[:8]]

    L.append("\n### QB flags this week (new starter or under the career-start threshold)")
    qrows = []
    for e in entries:
        for side in ("away", "home"):
            q = (e.get("qb") or {}).get(side) or {}
            if q.get("flag"):
                opp = e["home" if side == "away" else "away"]["name"]
                qrows.append(f"- {e[side]['name']} ({'at' if side == 'away' else 'vs'} {opp}): {q.get('name')}, {q.get('reason')}")
    L += qrows or ["- None flagged."]
    L.append("\nQB flags use only completed games, so a starter change announced this week will not show. Always check Saturday's availability report.")

    L.append("\n## Auto-flags for tuning")
    L += [f"- {f}" for f in flags] or ["- Nothing flagged."]
    L.append("\n## Changelog note for this run")
    L.append(args.note or "(none)")

    path = REPORTS / f"weekly_report_{season}_w{week}.md"
    path.write_text("\n".join(L) + "\n")
    return path


if __name__ == "__main__":
    main()
