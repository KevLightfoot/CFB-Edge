# CFB Edge

College football betting research site: our own spreads and win probabilities, per-game blowout risk for alt-spread underdogs, moneyline edges, stat comparisons, AI game reads, a model report card, and a bet log.

## How it fits together

```
your laptop                                   Render (hosting)
-----------                                   ----------------
engine/run_week.py  (Python)                  server/server.js  (Node, no dependencies)
  pulls CFBD data (cached)                      serves the site in public/
  trains + backtests the model                  reads data/predictions.json + data/report_card.json
  writes data/*.json  ---- git push ---->       fetches LIVE lines from CFBD   (CFBD_API_KEY)
  writes weekly report for Claude               calls OpenAI for game reads    (OPENAI_API_KEY)
```

API keys live only in `.env` on your laptop and in Render's environment settings. Neither is ever in GitHub or the browser.

## Project layout

| Path | What it is |
|---|---|
| `engine/config.json` | **Every tunable setting.** Most weekly tweaks happen here. |
| `engine/run_week.py` | The weekly command: train, backtest, grade last week, predict this week. |
| `engine/models/model_vN.json` | Versioned models with readable weights. |
| `engine/history/` | Archived predictions, graded the following week. |
| `engine/reports/weekly_report_<season>_w<N>.md` | **The file to upload to Claude on Sunday.** |
| `data/predictions.json`, `data/report_card.json` | What the site displays. Ships with sample data until your first real run. |
| `server/server.js` | Backend. Keeps keys server-side. |
| `public/` | The site (vanilla HTML/CSS/JS). |
| `CHANGELOG.md` | Auto-appended on every retrain. |

---

# Setup, step by step

## 1. Get your keys
1. **CFBD:** register at https://collegefootballdata.com/key. The key arrives by email. Free tier is 1,000 calls/month; this project uses about 50 for the first full training run and about 5 per week after that (finished seasons are cached forever).
2. **OpenAI:** create a key at https://platform.openai.com/api-keys and add a few dollars of credit. Explanations are cached per game, so each costs a fraction of a cent.

## 2. Unzip and look at it locally
You need **Python 3.10+** and **Node 18+** installed.

```bash
cd cfb-edge
cp .env.example .env          # Windows: copy .env.example .env
# open .env and paste your two keys
npm start
```
Open http://localhost:3000. You'll see the site with **sample data** (fictional teams, yellow banner). Stop it with Ctrl+C.

## 3. First real run (trains the model)
```bash
python -m venv .venv
source .venv/bin/activate       # Windows: .venv\Scripts\activate
pip install -r engine/requirements.txt

python engine/run_week.py --week 10 --retrain --note "first real model"
```
- Use the **upcoming** week number as CFBD labels it (check the schedule on collegefootballdata.com if unsure).
- The first run downloads ~10 seasons, so give it a minute. Later runs are fast.
- It prints the backtest summary and writes `data/predictions.json`, `data/report_card.json`, `engine/models/model_v1.json`, and the weekly report.

Run `npm start` again and the site now shows real games.

## 4. Push to GitHub
Create an **empty private repo** on GitHub (no README), then:
```bash
git init
git add .
git commit -m "CFB Edge initial"
git branch -M main
git remote add origin https://github.com/KevLightfoot/cfb-edge.git
git push -u origin main
```
Check on GitHub that **`.env` is NOT in the repo** (it's gitignored).

## 5. Deploy on Render
1. https://render.com → **New +** → **Web Service** → connect GitHub → pick the `cfb-edge` repo.
2. Settings:
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance type:** Free is fine
3. **Environment** → add variables:
   - `CFBD_API_KEY` = your CFBD key
   - `OPENAI_API_KEY` = your OpenAI key
   - `OPENAI_MODEL` = optional (defaults to `gpt-4o-mini`; set it to whichever current model you prefer)
   - `APP_PASSWORD` = optional but **recommended**: password-protects the site so strangers can't burn your OpenAI credit. The browser asks for a username (anything) and this password.
4. **Create Web Service.** When the log shows `CFB Edge running`, open your `https://<name>.onrender.com` URL.
5. Sanity check: visit `/api/health`. It should show `"cfbd_key": true, "openai_key": true`.

Render free instances sleep after ~15 minutes idle, so the first load after a break takes up to a minute.

---

# Weekly routine (Sunday or Monday, after the games)

```bash
source .venv/bin/activate
python engine/run_week.py --week 11              # predicts week 11, grades week 10
git add -A && git commit -m "Week 11" && git push  # Render redeploys automatically
```
- Lines on the site refresh live from CFBD every 30 minutes. Predictions only change when you run the engine (team stats don't change mid-week).
- **Then upload `engine/reports/weekly_report_2026_w11.md` to Claude.** It contains last week's grades, biggest misses, the alt-dog band results, the live and backtest report card, feature weights, and auto-flags. Include `engine/config.json` if you've edited it.

## When Claude suggests a tweak
1. Edit `engine/config.json` (or the code Claude gives you).
2. Retrain with a note:
   ```bash
   python engine/run_week.py --week 11 --retrain --note "raised sigma_min to 12"
   ```
3. Compare the new report card to the old one. Models are versioned (`model_v2.json`, ...), and `CHANGELOG.md` records each change.
4. To roll back: delete the newest `engine/models/model_vN.json` and rerun **without** `--retrain`.

## Config cheat sheet (`engine/config.json`)
| Setting | What it does |
|---|---|
| `features.margin_features` | Which stat gaps drive our spread. Remove one to test it. |
| `features.volatility_features` | What makes a game wild or steady (drives blowout risk). |
| `features.prior_games_weight` | How long last season's numbers linger. 3 = after 3 games, 50/50. |
| `model.ridge_alpha` | Higher = more conservative weights. |
| `model.market_blend` | 0 = pure model. 0.3–0.5 leans on Vegas if our margins drift. |
| `model.sigma_min` / `sigma_max` | Clamp on per-game volatility. |
| `betting.alt_dog_spread_range` | The favorite range your Alt-Dog Finder targets (default 2–7). |
| `betting.blowout_margins` | The alt lines you play (default 17.5 and 21.5). |
| `betting.spread_edge_threshold_pts`, `ml_edge_threshold` | When the report card counts a game as a "pick". |

---

# What each page does
- **Slate:** every game with book vs our spread, spread edge, favorite win % vs book, and blowout risk. Sort by edge or by lowest blowout risk.
- **Alt Dogs:** favorites in your spread range, underdogs ranked by chance to cover your alt line. Enter your book's price per game to see expected value.
- **Moneylines:** our win % vs no-vig implied %, edge, fair odds, EV. Filter to favorites for parlay legs.
- **Game page:** spread and ML evaluators, blowout panel with the margin distribution, an alt-line pricer for any line/odds, stat comparison with national ranks, what drives our spread, what drives volatility, and the AI analyst read.
- **Report Card:** backtest and this-season results: margin error vs the market, calibration, whether the blowout ranking actually separates games, simulated spread and ML picks, feature weights.
- **Bet Log:** saved in your browser. Use Export/Import to move it between phone and laptop.

# How the model works (short version)
- For a game in week W, each team's stats come only from its games before week W, blended with last season early on. No future data leaks in.
- Three linear models: expected margin, expected total, and per-game volatility (σ). The volatility model is trained on honest out-of-fold errors.
- Win %, cover %, and blowout % all come from Normal(margin, σ). It treats margins as continuous, so it doesn't account for key numbers like 3 and 7.
- Every prediction splits into per-factor point contributions. Those, plus national ranks, are the only facts sent to OpenAI, which is told to cite them and avoid generic filler.

# Troubleshooting
- **`CFBD_API_KEY is not set`:** `.env` is missing or not in the project root.
- **`CFBD ... HTTP 401`:** key typo, or the key hasn't been activated yet (check your email).
- **Mac: `CERTIFICATE_VERIFY_FAILED`:** run "Install Certificates.command" from your Python folder in Applications.
- **A stat looks empty or flat:** CFBD sometimes renames a field. Run with the real key, then send Claude the weekly report and the console output.
- **Site shows "Live lines unavailable":** it falls back to the lines saved when you ran the engine. Check `/api/health` and the Render logs.
- **Explanations fail:** check `OPENAI_API_KEY`, your OpenAI credit, and that `OPENAI_MODEL` is a model your account can use.
- **Test without keys:** `python engine/run_week.py --week 9 --mock --retrain` uses fictional data and writes to `engine/mock/`, never touching your real model history.
