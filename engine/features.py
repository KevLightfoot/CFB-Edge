"""Builds leakage-safe team snapshots and game features.

For a game in week W, every team stat comes ONLY from that team's games in
weeks < W of the same season, blended with last season's final numbers
while the sample is small. Nothing from the game itself or later weeks is used.
"""
from collections import defaultdict

STAT_KEYS = [
    "off_ppa", "off_sr", "off_expl", "off_rush_ppa", "off_pass_ppa", "off_plays",
    "def_ppa", "def_sr", "def_expl", "def_rush_ppa", "def_pass_ppa",
    "havoc_forced", "havoc_allowed", "pts_for", "pts_against",
]

# Used only if a whole season has no data for a stat.
FALLBACK_MEANS = {
    "off_ppa": 0.15, "off_sr": 0.42, "off_expl": 1.25, "off_rush_ppa": 0.12, "off_pass_ppa": 0.2,
    "off_plays": 70.0, "def_ppa": 0.15, "def_sr": 0.42, "def_expl": 1.25, "def_rush_ppa": 0.12,
    "def_pass_ppa": 0.2, "havoc_forced": 0.16, "havoc_allowed": 0.16, "pts_for": 28.0, "pts_against": 28.0,
}


def _mean(vals):
    vals = [v for v in vals if v is not None]
    return sum(vals) / len(vals) if vals else None


class SeasonIndex:
    """Per-team game logs for one season, for fast 'stats before week W' lookups."""

    def __init__(self, season_data):
        self.season = season_data["season"]
        self.talent = season_data["talent"]
        self.logs = defaultdict(list)  # team -> [entry]
        for gm in season_data["games"]:
            if not gm["completed"]:
                continue
            for team, opp, pf, pa in (
                (gm["home"], gm["away"], gm["home_pts"], gm["away_pts"]),
                (gm["away"], gm["home"], gm["away_pts"], gm["home_pts"]),
            ):
                row = dict(season_data["adv"].get((gm["id"], team), {}))
                row["pts_for"] = pf
                row["pts_against"] = pa
                row["week"] = gm["week"]
                self.logs[team].append(row)
        for t in self.logs:
            self.logs[t].sort(key=lambda r: r["week"])

        self.league_mean = {}
        for k in STAT_KEYS:
            m = _mean([r.get(k) for rows in self.logs.values() for r in rows])
            self.league_mean[k] = m if m is not None else FALLBACK_MEANS[k]
        tvals = list(self.talent.values())
        self.league_talent = sum(tvals) / len(tvals) if tvals else 700.0

    def raw_stats(self, team, before_week=None):
        rows = self.logs.get(team, [])
        if before_week is not None:
            rows = [r for r in rows if r["week"] < before_week]
        out = {k: _mean([r.get(k) for r in rows]) for k in STAT_KEYS}
        out["games"] = len(rows)
        return out


def team_snapshot(team, idx, before_week, prior_idx, k):
    """Season-to-date stats blended with last season (or league average)."""
    cur = idx.raw_stats(team, before_week)
    n = cur["games"]
    prior = prior_idx.raw_stats(team) if prior_idx is not None else None
    snap = {"games": n}
    for key in STAT_KEYS:
        lg = idx.league_mean[key]
        p = prior.get(key) if prior and prior["games"] > 0 else None
        if p is None:
            p = lg
        c = cur.get(key)
        if c is None or n == 0:
            snap[key] = p
        else:
            snap[key] = (n * c + k * p) / (n + k)
    snap["talent"] = idx.talent.get(team, idx.league_talent)
    return snap


def game_features(gm, h, a, idx):
    """Raw (unstandardized) features, all oriented from the HOME team's view."""
    if gm.get("home_elo") is not None and gm.get("away_elo") is not None:
        elo_diff = (gm["home_elo"] - gm["away_elo"]) / 100.0
    else:
        elo_diff = 0.0
    f = {
        "elo_diff": elo_diff,
        "talent_diff": (h["talent"] - a["talent"]) / 100.0,
        "net_ppa_diff": (h["off_ppa"] - h["def_ppa"]) - (a["off_ppa"] - a["def_ppa"]),
        "net_success_diff": (h["off_sr"] - h["def_sr"]) - (a["off_sr"] - a["def_sr"]),
        "net_explosiveness_diff": (h["off_expl"] - h["def_expl"]) - (a["off_expl"] - a["def_expl"]),
        "rush_matchup": (h["off_rush_ppa"] - a["def_rush_ppa"]) - (a["off_rush_ppa"] - h["def_rush_ppa"]),
        "pass_matchup": (h["off_pass_ppa"] - a["def_pass_ppa"]) - (a["off_pass_ppa"] - h["def_pass_ppa"]),
        "net_havoc_diff": (h["havoc_forced"] - h["havoc_allowed"]) - (a["havoc_forced"] - a["havoc_allowed"]),
        "net_points_diff": (h["pts_for"] - h["pts_against"]) - (a["pts_for"] - a["pts_against"]),
        "home_field": 0.0 if gm["neutral"] else 1.0,
        "off_ppa_sum": h["off_ppa"] + a["off_ppa"],
        "def_ppa_sum": h["def_ppa"] + a["def_ppa"],
        "pace_sum": h["off_plays"] + a["off_plays"],
        "points_for_sum": h["pts_for"] + a["pts_for"],
        "points_against_sum": h["pts_against"] + a["pts_against"],
        "explosiveness_sum": h["off_expl"] + a["off_expl"] + h["def_expl"] + a["def_expl"],
        "havoc_allowed_sum": h["havoc_allowed"] + a["havoc_allowed"],
        "abs_talent_gap": abs(h["talent"] - a["talent"]) / 100.0,
    }
    return f


def build_rows(seasons, season_idx, cfg, only_completed=True, week=None, season_filter=None):
    """Rows for every game: features + snapshots + market + result."""
    k = cfg["features"]["prior_games_weight"]
    rows = []
    for s, sd in seasons.items():
        if season_filter is not None and s not in season_filter:
            continue
        idx = season_idx[s]
        prior_idx = season_idx.get(s - 1)
        for gm in sd["games"]:
            if week is not None and gm["week"] != week:
                continue
            if only_completed and not gm["completed"]:
                continue
            h = team_snapshot(gm["home"], idx, gm["week"], prior_idx, k)
            a = team_snapshot(gm["away"], idx, gm["week"], prior_idx, k)
            row = {
                "game": gm,
                "home_snap": h,
                "away_snap": a,
                "f": game_features(gm, h, a, idx),
                "market": sd["lines"].get(gm["id"], {}),
            }
            if gm["completed"]:
                row["margin"] = gm["home_pts"] - gm["away_pts"]
                row["total"] = gm["home_pts"] + gm["away_pts"]
            rows.append(row)
    return rows
