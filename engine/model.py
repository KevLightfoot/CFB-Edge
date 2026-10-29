"""The prediction engine: three small linear models, saved as readable JSON.

  margin model      -> expected home margin (our spread = -margin)
  total model       -> expected total points
  volatility model  -> per-game standard deviation of the margin (sigma)

Win probability, cover probability and blowout risk all come from
Normal(margin, sigma). Linear models are used on purpose: every weight is
visible in the JSON, and each prediction splits cleanly into per-factor
point contributions that feed the explanations.
"""
import math
import numpy as np

SQRT_PI_2 = math.sqrt(math.pi / 2)


def norm_cdf(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


class Ridge:
    def __init__(self, features, alpha):
        self.features = list(features)
        self.alpha = alpha

    def fit(self, X, y):
        X = np.asarray(X, float)
        y = np.asarray(y, float)
        self.means = X.mean(axis=0)
        self.stds = X.std(axis=0)
        self.stds[self.stds < 1e-9] = 1.0  # constant column -> weight ~0
        Z = (X - self.means) / self.stds
        self.intercept = float(y.mean())
        yc = y - self.intercept
        n_feat = Z.shape[1]
        A = Z.T @ Z + self.alpha * np.eye(n_feat)
        self.coefs = np.linalg.solve(A, Z.T @ yc)
        return self

    def contributions(self, x):
        z = (np.asarray(x, float) - self.means) / self.stds
        return self.coefs * z

    def predict_one(self, x):
        return float(self.intercept + self.contributions(x).sum())

    def predict(self, X):
        Z = (np.asarray(X, float) - self.means) / self.stds
        return self.intercept + Z @ self.coefs

    def to_json(self):
        return {
            "features": self.features,
            "intercept": self.intercept,
            "means": [float(v) for v in self.means],
            "stds": [float(v) for v in self.stds],
            "coefs_per_sd": [float(v) for v in self.coefs],
            "alpha": self.alpha,
        }

    @classmethod
    def from_json(cls, d):
        m = cls(d["features"], d["alpha"])
        m.intercept = d["intercept"]
        m.means = np.array(d["means"])
        m.stds = np.array(d["stds"])
        m.coefs = np.array(d["coefs_per_sd"])
        return m


def _matrix(rows, feats):
    return [[r["f"][k] for k in feats] for r in rows]


class Engine:
    def __init__(self, cfg):
        self.cfg = cfg
        fc = cfg["features"]
        self.mfeat = fc["margin_features"]
        self.tfeat = fc["total_features"]
        self.vfeat = fc["volatility_features"]

    # ---- helpers -------------------------------------------------------
    def _expected_total(self, row, model_total):
        mk = row.get("market", {})
        if self.cfg["model"]["use_market_total_for_volatility"] and mk.get("total"):
            return mk["total"]
        return model_total

    def _vol_x(self, row, exp_margin, model_total):
        f = dict(row["f"])
        f["expected_total"] = self._expected_total(row, model_total)
        f["abs_expected_margin"] = abs(exp_margin)
        return [f[k] for k in self.vfeat]

    # ---- training ------------------------------------------------------
    def fit(self, rows):
        mc = self.cfg["model"]
        alpha = mc["ridge_alpha"]
        y_m = [r["margin"] for r in rows]
        y_t = [r["total"] for r in rows]

        # Out-of-fold margin predictions (grouped by season) so the volatility
        # model learns from honest residuals, not in-sample ones.
        seasons = sorted({r["game"]["season"] for r in rows})
        oof_m = np.zeros(len(rows))
        oof_t = np.zeros(len(rows))
        if len(seasons) >= 2:
            groups = [[i for i, r in enumerate(rows) if r["game"]["season"] == s] for s in seasons]
        else:
            idx = np.arange(len(rows))
            groups = [list(idx[i::5]) for i in range(5)]
        for grp in groups:
            gs = set(grp)
            tr = [r for i, r in enumerate(rows) if i not in gs]
            te = [rows[i] for i in grp]
            mm = Ridge(self.mfeat, alpha).fit(_matrix(tr, self.mfeat), [r["margin"] for r in tr])
            tm = Ridge(self.tfeat, alpha).fit(_matrix(tr, self.tfeat), [r["total"] for r in tr])
            oof_m[grp] = mm.predict(_matrix(te, self.mfeat))
            oof_t[grp] = tm.predict(_matrix(te, self.tfeat))

        # Apply the same market blend used at prediction time, so the volatility
        # model learns from the errors of the margin we actually publish.
        b = mc["market_blend"]
        if b > 0:
            for i, r in enumerate(rows):
                sp = r.get("market", {}).get("spread")
                if sp is not None:
                    oof_m[i] = (1 - b) * oof_m[i] + b * (-sp)

        self.margin = Ridge(self.mfeat, alpha).fit(_matrix(rows, self.mfeat), y_m)
        self.total = Ridge(self.tfeat, alpha).fit(_matrix(rows, self.tfeat), y_t)

        resid = np.array(y_m) - oof_m
        Xv = [self._vol_x(r, oof_m[i], oof_t[i]) for i, r in enumerate(rows)]
        yv = np.abs(resid) * SQRT_PI_2  # E|N(0,s)| = s*sqrt(2/pi)
        self.vol = Ridge(self.vfeat, alpha).fit(Xv, yv)
        raw_sig = np.clip(self.vol.predict(Xv), 1.0, None)
        z = resid / raw_sig
        self.vol_scale = float(np.std(z))  # rescale so z-scores have unit variance
        self.train_info = {
            "games": len(rows),
            "seasons": seasons,
            "oof_margin_mae": float(np.mean(np.abs(resid))),
            "oof_margin_rmse": float(np.sqrt(np.mean(resid ** 2))),
        }
        return self

    # ---- prediction ----------------------------------------------------
    def predict_row(self, row):
        mc = self.cfg["model"]
        xm = [row["f"][k] for k in self.mfeat]
        xt = [row["f"][k] for k in self.tfeat]
        contrib = self.margin.contributions(xm)
        model_margin = float(self.margin.intercept + contrib.sum())
        total = self.total.predict_one(xt)

        margin = model_margin
        mk = row.get("market", {})
        b = mc["market_blend"]
        if b > 0 and mk.get("spread") is not None:
            margin = (1 - b) * model_margin + b * (-mk["spread"])

        xv = self._vol_x(row, margin, total)
        sigma = max(self.vol.predict_one(xv), 1.0) * self.vol_scale
        sigma = float(min(max(sigma, mc["sigma_min"]), mc["sigma_max"]))
        vol_contrib = self.vol.contributions(xv) * self.vol_scale

        labels = self.cfg["features"]["labels"]
        factors = sorted(
            [{"key": k, "label": labels.get(k, k), "points": round(float(c), 2)}
             for k, c in zip(self.mfeat, contrib)],
            key=lambda d: -abs(d["points"]),
        )
        vol_factors = sorted(
            [{"key": k, "label": labels.get(k, k), "sigma_pts": round(float(c), 2)}
             for k, c in zip(self.vfeat, vol_contrib)],
            key=lambda d: -abs(d["sigma_pts"]),
        )
        return {
            "margin": round(margin, 2),
            "model_margin": round(model_margin, 2),
            "total": round(total, 1),
            "sigma": round(sigma, 2),
            "home_win_prob": round(norm_cdf(margin / sigma), 4),
            "factors": factors,
            "vol_factors": vol_factors,
            "baseline_margin": round(self.margin.intercept, 2),
        }

    # ---- persistence ---------------------------------------------------
    def to_json(self, version, trained_at):
        return {
            "version": version,
            "trained_at": trained_at,
            "train_info": self.train_info,
            "config_snapshot": self.cfg,
            "margin_model": self.margin.to_json(),
            "total_model": self.total.to_json(),
            "volatility_model": {**self.vol.to_json(), "scale": self.vol_scale},
        }

    @classmethod
    def from_json(cls, d, cfg):
        e = cls(cfg)
        e.mfeat = d["margin_model"]["features"]
        e.tfeat = d["total_model"]["features"]
        e.vfeat = d["volatility_model"]["features"]
        e.margin = Ridge.from_json(d["margin_model"])
        e.total = Ridge.from_json(d["total_model"])
        e.vol = Ridge.from_json(d["volatility_model"])
        e.vol_scale = d["volatility_model"]["scale"]
        e.train_info = d.get("train_info", {})
        return e
