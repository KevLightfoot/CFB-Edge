"""Odds math and report-card metrics (backtest and live weeks)."""
import math
from model import norm_cdf


def american_to_prob(o):
    if o is None:
        return None
    return (-o) / (-o + 100.0) if o < 0 else 100.0 / (o + 100.0)


def payout(o):
    """Profit per 1 unit staked."""
    return 100.0 / (-o) if o < 0 else o / 100.0


def market_probs(mk, remove_vig=True):
    ph, pa = american_to_prob(mk.get("home_ml")), american_to_prob(mk.get("away_ml"))
    if ph is None or pa is None:
        return None, None
    if remove_vig:
        s = ph + pa
        return ph / s, pa / s
    return ph, pa


def p_fav_by_more_than(fav_margin_mu, sigma, m):
    return 1 - norm_cdf((m - fav_margin_mu) / sigma)


def summarize(items, cfg):
    """items: list of {row, pred} for completed games. Returns metrics dict."""
    bc = cfg["betting"]
    out = {"games": len(items)}
    if not items:
        return out

    def mae(pairs):
        pairs = [p for p in pairs if p[0] is not None]
        return round(sum(abs(a - b) for a, b in pairs) / len(pairs), 2) if pairs else None

    out["margin_mae_model"] = mae([(it["pred"]["margin"], it["row"]["margin"]) for it in items])
    out["margin_mae_market"] = mae([
        (-it["row"]["market"]["spread"] if it["row"]["market"].get("spread") is not None else None,
         it["row"]["margin"]) for it in items])
    out["total_mae_model"] = mae([(it["pred"]["total"], it["row"]["total"]) for it in items])
    out["total_mae_market"] = mae([(it["row"]["market"].get("total"), it["row"]["total"]) for it in items])

    # --- win probability quality
    bm, bk, n_both = 0.0, 0.0, 0
    ll = 0.0
    for it in items:
        p = it["pred"]["home_win_prob"]
        won = 1.0 if it["row"]["margin"] > 0 else 0.0
        if it["row"]["margin"] == 0:
            continue
        ll += -math.log(max(1e-6, p if won else 1 - p))
        ph, _ = market_probs(it["row"]["market"], bc["remove_vig"])
        if ph is not None:
            bm += (p - won) ** 2
            bk += (ph - won) ** 2
            n_both += 1
    out["log_loss_model"] = round(ll / len(items), 4)
    if n_both:
        out["brier_model"] = round(bm / n_both, 4)
        out["brier_market"] = round(bk / n_both, 4)
        out["brier_games"] = n_both

    # --- calibration (favorite's perspective)
    bins = [(0.5, 0.6), (0.6, 0.7), (0.7, 0.8), (0.8, 0.9), (0.9, 1.01)]
    cal = []
    for lo, hi in bins:
        sel = []
        for it in items:
            p = it["pred"]["home_win_prob"]
            m = it["row"]["margin"]
            if m == 0:
                continue
            pf, fav_won = (p, m > 0) if p >= 0.5 else (1 - p, m < 0)
            if lo <= pf < hi:
                sel.append((pf, 1.0 if fav_won else 0.0))
        if sel:
            cal.append({"bin": f"{int(lo*100)}-{min(int(hi*100),100)}%", "n": len(sel),
                        "predicted": round(sum(s[0] for s in sel) / len(sel), 3),
                        "actual": round(sum(s[1] for s in sel) / len(sel), 3)})
    out["calibration"] = cal

    # --- sigma sanity: ~68% of results should land within 1 sigma
    inside = [abs(it["row"]["margin"] - it["pred"]["margin"]) <= it["pred"]["sigma"] for it in items]
    out["within_1_sigma"] = round(sum(inside) / len(inside), 3)
    out["avg_sigma"] = round(sum(it["pred"]["sigma"] for it in items) / len(items), 2)

    # --- blowout risk on the alt-dog band (market favorite by 2-7)
    lo, hi = bc["alt_dog_spread_range"]
    band = [it for it in items if it["row"]["market"].get("spread") is not None
            and lo <= abs(it["row"]["market"]["spread"]) <= hi]
    blow = {"games": len(band), "by_margin": []}
    for m in bc["blowout_margins"]:
        recs = []
        for it in band:
            sp = it["row"]["market"]["spread"]
            home_fav = sp < 0
            fav_mu = it["pred"]["margin"] if home_fav else -it["pred"]["margin"]
            fav_actual = it["row"]["margin"] if home_fav else -it["row"]["margin"]
            p = p_fav_by_more_than(fav_mu, it["pred"]["sigma"], m)
            base = p_fav_by_more_than(abs(sp), cfg["model"]["default_sigma"], m)
            recs.append((p, 1.0 if fav_actual > m else 0.0, base))
        if not recs:
            continue
        recs.sort(key=lambda r: r[0])
        k = len(recs) // 3 or 1
        terciles = []
        for name, chunk in (("Lowest risk third", recs[:k]), ("Middle third", recs[k:2 * k]), ("Highest risk third", recs[2 * k:])):
            if chunk:
                terciles.append({"group": name, "n": len(chunk),
                                 "predicted": round(sum(c[0] for c in chunk) / len(chunk), 3),
                                 "actual": round(sum(c[1] for c in chunk) / len(chunk), 3)})
        blow["by_margin"].append({
            "margin": m,
            "predicted_rate": round(sum(r[0] for r in recs) / len(recs), 3),
            "actual_rate": round(sum(r[1] for r in recs) / len(recs), 3),
            "flat_sigma_baseline": round(sum(r[2] for r in recs) / len(recs), 3),
            "alt_dog_hit_rate_all": round(1 - sum(r[1] for r in recs) / len(recs), 3),
            "alt_dog_hit_rate_lowest_third": round(1 - terciles[0]["actual"], 3) if terciles else None,
            "terciles": terciles,
        })
    # QB flag check: do games where the UNDERDOG's QB is flagged blow out more often?
    split = {}
    for name in ("dog_qb_flagged", "dog_qb_ok"):
        split[name] = {"n": 0, "blowouts": {str(m): 0 for m in bc["blowout_margins"]}, "pred": {str(m): 0.0 for m in bc["blowout_margins"]}}
    for it in band:
        r = it["row"]
        if "home_qb" not in r:
            continue
        home_fav = r["market"]["spread"] < 0
        dq = r["away_qb" if home_fav else "home_qb"]
        if not dq.get("known"):
            continue
        key = "dog_qb_flagged" if dq.get("flag") else "dog_qb_ok"
        fav_actual = r["margin"] if home_fav else -r["margin"]
        fav_mu = it["pred"]["margin"] if home_fav else -it["pred"]["margin"]
        split[key]["n"] += 1
        for m in bc["blowout_margins"]:
            split[key]["blowouts"][str(m)] += 1 if fav_actual > m else 0
            split[key]["pred"][str(m)] += p_fav_by_more_than(fav_mu, it["pred"]["sigma"], m)
    if split["dog_qb_flagged"]["n"] or split["dog_qb_ok"]["n"]:
        blow["qb_split"] = []
        for name, label in (("dog_qb_flagged", "Underdog QB flagged"), ("dog_qb_ok", "Underdog QB normal")):
            d = split[name]
            if d["n"]:
                blow["qb_split"].append({"group": label, "n": d["n"], **{
                    f"actual_{m}": round(d["blowouts"][str(m)] / d["n"], 3) for m in bc["blowout_margins"]}, **{
                    f"pred_{m}": round(d["pred"][str(m)] / d["n"], 3) for m in bc["blowout_margins"]}})
    out["blowout"] = blow

    # --- simulated spread bets vs the market line (-110)
    thr = bc["spread_edge_threshold_pts"]
    w = l = p = 0
    for it in items:
        sp = it["row"]["market"].get("spread")
        if sp is None:
            continue
        edge = it["pred"]["margin"] + sp
        if abs(edge) < thr:
            continue
        res = it["row"]["margin"] + sp
        res = res if edge > 0 else -res
        if res > 0:
            w += 1
        elif res < 0:
            l += 1
        else:
            p += 1
    units = w * (100 / 110) - l
    out["ats"] = {"threshold_pts": thr, "wins": w, "losses": l, "pushes": p,
                  "win_pct": round(w / (w + l), 3) if w + l else None, "units": round(units, 2)}

    # --- simulated moneyline bets where our prob beats the implied prob
    mthr = bc["ml_edge_threshold"]
    ml = {"threshold": mthr, "bets": 0, "wins": 0, "units": 0.0, "fav_bets": 0, "fav_units": 0.0}
    for it in items:
        mk = it["row"]["market"]
        ph, pa = market_probs(mk, bc["remove_vig"])
        if ph is None or it["row"]["margin"] == 0:
            continue
        p_home = it["pred"]["home_win_prob"]
        for side_p, mkt_p, odds, won in ((p_home, ph, mk["home_ml"], it["row"]["margin"] > 0),
                                         (1 - p_home, pa, mk["away_ml"], it["row"]["margin"] < 0)):
            if side_p - mkt_p >= mthr:
                ml["bets"] += 1
                gain = payout(odds) if won else -1.0
                ml["units"] += gain
                ml["wins"] += 1 if won else 0
                if odds < 0:
                    ml["fav_bets"] += 1
                    ml["fav_units"] += gain
    ml["units"] = round(ml["units"], 2)
    ml["fav_units"] = round(ml["fav_units"], 2)
    ml["roi"] = round(ml["units"] / ml["bets"], 3) if ml["bets"] else None
    out["moneyline"] = ml
    return out
