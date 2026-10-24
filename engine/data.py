"""Loads one season from CFBD and normalizes it.

Endpoints used per season (5 calls, cached):
  /games                 schedule, scores, pregame Elo
  /lines                 betting lines (spread, total, moneylines)
  /stats/game/advanced   per-game EPA, success rate, explosiveness, rush/pass splits, plays
  /stats/game/havoc      per-game havoc rates (optional; skipped if unavailable)
  /talent                247 roster talent composite (preseason, no leakage)

Field names are read defensively (camelCase or snake_case) so small API
changes don't break the pipeline.
"""


def g(obj, *keys, default=None):
    """Get the first present key (supports camelCase/snake_case variants)."""
    if obj is None:
        return default
    for k in keys:
        if isinstance(obj, dict) and k in obj and obj[k] is not None:
            return obj[k]
    return default


def fnum(x, default=None):
    try:
        if x is None or x == "":
            return default
        return float(x)
    except (TypeError, ValueError):
        return default


def load_season(client, season, cfg):
    st = cfg["data"]["season_type"]
    raw_games = client.get("/games", {"year": season, "seasonType": st}, season=season) or []
    raw_lines = client.get("/lines", {"year": season, "seasonType": st}, season=season) or []
    raw_adv = client.get("/stats/game/advanced", {"year": season, "seasonType": st}, season=season) or []
    raw_havoc = client.get("/stats/game/havoc", {"year": season, "seasonType": st}, season=season, optional=True) or []
    raw_talent = client.get("/talent", {"year": season}, season=season, optional=True) or []

    games = []
    for r in raw_games:
        gm = {
            "id": g(r, "id"),
            "season": int(g(r, "season", default=season)),
            "week": int(g(r, "week", default=0)),
            "start": g(r, "startDate", "start_date"),
            "neutral": bool(g(r, "neutralSite", "neutral_site", default=False)),
            "completed": bool(g(r, "completed", default=False)),
            "home": g(r, "homeTeam", "home_team"),
            "away": g(r, "awayTeam", "away_team"),
            "home_conf": g(r, "homeConference", "home_conference"),
            "away_conf": g(r, "awayConference", "away_conference"),
            "home_div": (g(r, "homeClassification", "homeDivision", "home_division") or "").lower(),
            "away_div": (g(r, "awayClassification", "awayDivision", "away_division") or "").lower(),
            "home_pts": fnum(g(r, "homePoints", "home_points")),
            "away_pts": fnum(g(r, "awayPoints", "away_points")),
            "home_elo": fnum(g(r, "homePregameElo", "home_pregame_elo")),
            "away_elo": fnum(g(r, "awayPregameElo", "away_pregame_elo")),
        }
        if gm["home_pts"] is not None and gm["away_pts"] is not None:
            gm["completed"] = True
        if gm["id"] is not None and gm["home"] and gm["away"]:
            games.append(gm)

    if cfg["data"]["fbs_only"]:
        has_div = any(x["home_div"] for x in games)
        if has_div:
            games = [x for x in games if x["home_div"] == "fbs" and x["away_div"] == "fbs"]

    prefs = [p.lower() for p in cfg["data"]["line_provider_preference"]]
    lines = {}
    for r in raw_lines:
        gid = g(r, "id")
        options = g(r, "lines", default=[]) or []
        if not options:
            continue

        def rank(ln):
            p = (g(ln, "provider", default="") or "").lower()
            return prefs.index(p) if p in prefs else len(prefs)

        options = sorted(options, key=rank)
        best = {}
        for ln in options:  # take each field from the best provider that has it
            for out_key, keys in (
                ("spread", ("spread",)),
                ("spread_open", ("spreadOpen", "spread_open")),
                ("total", ("overUnder", "over_under")),
                ("home_ml", ("homeMoneyline", "home_moneyline")),
                ("away_ml", ("awayMoneyline", "away_moneyline")),
            ):
                if out_key not in best:
                    v = fnum(g(ln, *keys))
                    if v is not None:
                        best[out_key] = v
                        if out_key == "spread":
                            best["provider"] = g(ln, "provider")
        if "spread" in best or "home_ml" in best:
            lines[gid] = best

    adv = {}  # (gameId, team) -> flat stat dict
    for r in raw_adv:
        gid = g(r, "gameId", "game_id")
        team = g(r, "team")
        off = g(r, "offense", default={}) or {}
        de = g(r, "defense", default={}) or {}
        adv[(gid, team)] = {
            "off_ppa": fnum(g(off, "ppa")),
            "off_sr": fnum(g(off, "successRate", "success_rate")),
            "off_expl": fnum(g(off, "explosiveness")),
            "off_rush_ppa": fnum(g(g(off, "rushingPlays", "rushing_plays", default={}), "ppa")),
            "off_pass_ppa": fnum(g(g(off, "passingPlays", "passing_plays", default={}), "ppa")),
            "off_plays": fnum(g(off, "plays")),
            "def_ppa": fnum(g(de, "ppa")),
            "def_sr": fnum(g(de, "successRate", "success_rate")),
            "def_expl": fnum(g(de, "explosiveness")),
            "def_rush_ppa": fnum(g(g(de, "rushingPlays", "rushing_plays", default={}), "ppa")),
            "def_pass_ppa": fnum(g(g(de, "passingPlays", "passing_plays", default={}), "ppa")),
        }

    havoc_keys = ("havocRate", "totalHavocRate", "havoc_rate", "total_havoc_rate", "rate", "total")
    for r in raw_havoc:
        gid = g(r, "gameId", "game_id")
        team = g(r, "team")
        row = adv.setdefault((gid, team), {})
        off = g(r, "offense", default=None)
        de = g(r, "defense", default=None)
        if isinstance(off, dict) or isinstance(de, dict):
            row["havoc_allowed"] = fnum(g(off, *havoc_keys))
            row["havoc_forced"] = fnum(g(de, *havoc_keys))
        else:  # flat shape
            row["havoc_allowed"] = fnum(g(r, "offHavocRate", "off_havoc_rate"))
            row["havoc_forced"] = fnum(g(r, "defHavocRate", "def_havoc_rate"))

    talent = {}
    for r in raw_talent:
        t = g(r, "team", "school")
        v = fnum(g(r, "talent"))
        if t and v is not None:
            talent[t] = v

    return {"season": season, "games": games, "lines": lines, "adv": adv, "talent": talent}
