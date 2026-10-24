"""Synthetic CFBD-shaped data for testing the pipeline without an API key.

Run any command with --mock. Teams are fictional. The data has realistic
structure (team strength carries over between seasons, pace and turnover
proneness change how volatile a game is) so the backtest exercises every
part of the engine, but the numbers mean nothing for real betting.
"""
import math
import random

PLACES = ["Riverside", "Granite", "Lakeview", "Prairie", "Summit", "Bayou", "Canyon", "Harbor",
          "Ironwood", "Mesa", "Northfield", "Oakridge", "Pinecrest", "Redrock", "Silverton",
          "Timber", "Valley", "Westbrook", "Coastal", "Frontier", "Highland", "Delta", "Badlands",
          "Cedar", "Gulf", "Plains"]
MASCOTS = ["Hawks", "Rams", "Wolves", "Gators", "Comets"]
MOCK_CURRENT_SEASON = 2026
MOCK_CURRENT_WEEK = 9
FIRST_SEASON = 2016


def _ncdf(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def _to_american(p):
    p = min(max(p, 0.01), 0.99)
    return round(-100 * p / (1 - p)) if p >= 0.5 else round(100 * (1 - p) / p)


class MockCFBD:
    def __init__(self, seed=7):
        self.rng = random.Random(seed)
        self.teams = [f"{p} {m}" for p in PLACES for m in MASCOTS][:130]
        self.conf = {t: f"Conference {i // 13 + 1}" for i, t in enumerate(self.teams)}
        r = self.rng
        self.lat = {t: {"off": r.gauss(0, 7), "def": r.gauss(0, 7), "pace": r.gauss(70, 5),
                        "tov": r.gauss(0.16, 0.025), "hav": r.gauss(0.16, 0.025), "rush": r.gauss(0, 0.05)}
                    for t in self.teams}
        self.elo = {t: 1500 + 12 * (self.lat[t]["off"] + self.lat[t]["def"]) for t in self.teams}
        self.data = {}
        self.next_id = 400000000
        for s in range(FIRST_SEASON, MOCK_CURRENT_SEASON + 1):
            self._season(s)

    def _season(self, s):
        r = self.rng
        if s > FIRST_SEASON:  # strength carries over with regression + noise
            for t, L in self.lat.items():
                L["off"] = 0.65 * L["off"] + r.gauss(0, 4.5)
                L["def"] = 0.65 * L["def"] + r.gauss(0, 4.5)
                L["pace"] = 0.7 * L["pace"] + 0.3 * 70 + r.gauss(0, 3)
                L["tov"] = 0.5 * L["tov"] + 0.5 * 0.16 + r.gauss(0, 0.02)
                L["hav"] = 0.5 * L["hav"] + 0.5 * 0.16 + r.gauss(0, 0.02)
            for t in self.teams:
                self.elo[t] = 0.7 * self.elo[t] + 0.3 * 1500
        talent = [{"year": s, "team": t, "talent": round(650 + 9 * (L["off"] + L["def"]) + r.gauss(0, 25), 2)}
                  for t, L in self.lat.items()]
        games, lines, adv, havoc = [], [], [], []
        last_week = MOCK_CURRENT_WEEK if s == MOCK_CURRENT_SEASON else 12
        for week in range(1, last_week + 1):
            order = self.teams[:]
            r.shuffle(order)
            for i in range(0, len(order) - 1, 2):
                home, away = order[i], order[i + 1]
                H, A = self.lat[home], self.lat[away]
                neutral = r.random() < 0.03
                hfa = 0 if neutral else 2.6
                pace = (H["pace"] + A["pace"]) / 2
                pf = pace / 70.0
                eh = (27 + H["off"] - A["def"] + hfa / 2) * pf
                ea = (27 + A["off"] - H["def"] - hfa / 2) * pf
                exp_margin, exp_total = eh - ea, eh + ea
                sd = 8 + 0.12 * exp_total + 60 * (H["tov"] + A["tov"] - 0.32) + 0.05 * abs(exp_margin)
                gid = self.next_id
                self.next_id += 1
                completed = not (s == MOCK_CURRENT_SEASON and week == MOCK_CURRENT_WEEK)
                game = {"id": gid, "season": s, "week": week, "seasonType": "regular",
                        "startDate": f"{s}-{9 + (week + 1) // 5:02d}-{(week * 7) % 28 + 1:02d}T19:00:00.000Z",
                        "completed": completed, "neutralSite": neutral,
                        "homeTeam": home, "homeConference": self.conf[home], "homeClassification": "fbs",
                        "awayTeam": away, "awayConference": self.conf[away], "awayClassification": "fbs",
                        "homePregameElo": round(self.elo[home]), "awayPregameElo": round(self.elo[away]),
                        "homePoints": None, "awayPoints": None}
                spread = round(2 * -(exp_margin + r.gauss(0, 2.5))) / 2
                total = round(2 * (exp_total + r.gauss(0, 3))) / 2
                ph = _ncdf(-spread / 15.5)
                lines.append({"id": gid, "season": s, "week": week, "homeTeam": home, "awayTeam": away,
                              "lines": [{"provider": "DraftKings", "spread": spread, "spreadOpen": spread + r.choice([-1, -0.5, 0, 0.5, 1]),
                                         "overUnder": total, "homeMoneyline": _to_american(ph * 1.045),
                                         "awayMoneyline": _to_american((1 - ph) * 1.045)}]})
                if completed:
                    margin = exp_margin + r.gauss(0, sd)
                    tot = exp_total + r.gauss(0, 9)
                    hp = max(0, round((tot + margin) / 2))
                    ap = max(0, round((tot - margin) / 2))
                    if hp == ap:
                        hp += 3 if r.random() < 0.5 + exp_margin / 60 else 0
                        ap += 0 if hp != ap else 3
                    game["homePoints"], game["awayPoints"] = hp, ap
                    exp_h = 1 / (1 + 10 ** ((self.elo[away] - self.elo[home] - 55) / 400))
                    k = 25 * math.log(abs(hp - ap) + 1)
                    self.elo[home] += k * ((1 if hp > ap else 0) - exp_h)
                    self.elo[away] -= k * ((1 if hp > ap else 0) - exp_h)
                    sides = {}
                    for team, T, pts in ((home, H, hp), (away, A, ap)):
                        dev = pts - 27 * pf
                        ppa = 0.15 + 0.009 * dev + r.gauss(0, 0.05)
                        sides[team] = {"plays": round(T["pace"] + r.gauss(0, 6)),
                                       "ppa": round(ppa, 3),
                                       "successRate": round(0.42 + 0.004 * dev + r.gauss(0, 0.03), 3),
                                       "explosiveness": round(1.25 + 0.006 * dev + r.gauss(0, 0.12), 3),
                                       "rushingPlays": {"ppa": round(ppa + T["rush"] + r.gauss(0, 0.06), 3)},
                                       "passingPlays": {"ppa": round(ppa - T["rush"] + r.gauss(0, 0.08), 3)}}
                    for team, opp, T, O in ((home, away, H, A), (away, home, A, H)):
                        adv.append({"gameId": gid, "season": s, "week": week, "team": team, "opponent": opp,
                                    "offense": sides[team], "defense": sides[opp]})
                        havoc.append({"gameId": gid, "team": team,
                                      "offense": {"havocRate": round(max(0.02, T["tov"] + r.gauss(0, 0.04)), 3)},
                                      "defense": {"havocRate": round(max(0.02, T["hav"] + r.gauss(0, 0.04)), 3)}})
                games.append(game)
        self.data[s] = {"/games": games, "/lines": lines, "/stats/game/advanced": adv,
                        "/stats/game/havoc": havoc, "/talent": talent}

    def get(self, path, params):
        s = int(params.get("year"))
        return self.data.get(s, {}).get(path, [])
