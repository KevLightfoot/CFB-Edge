# CFB Edge weekly report: 2026 week 8
Generated 2026-10-24T01:55:42 | model v5 (trained 2026-10-24T01:55:42) | RETRAINED THIS RUN
Training: 5585 games, seasons [2018, 2019, 2021, 2022, 2023, 2024, 2025, 2026], out-of-fold margin MAE 12.19

## Key settings
```json
{
 "features": {
  "prior_games_weight": 3,
  "margin_features": [
   "elo_diff",
   "talent_diff",
   "net_ppa_diff",
   "net_success_diff",
   "net_explosiveness_diff",
   "rush_matchup",
   "pass_matchup",
   "net_havoc_diff",
   "net_points_diff",
   "home_field"
  ],
  "total_features": [
   "off_ppa_sum",
   "def_ppa_sum",
   "pace_sum",
   "points_for_sum",
   "points_against_sum",
   "explosiveness_sum"
  ],
  "volatility_features": [
   "expected_total",
   "pace_sum",
   "havoc_allowed_sum",
   "abs_expected_margin",
   "abs_talent_gap"
  ]
 },
 "model": {
  "ridge_alpha": 10.0,
  "market_blend": 0.75,
  "use_market_total_for_volatility": true,
  "sigma_min": 11.0,
  "sigma_max": 22.0,
  "default_sigma": 16.0
 },
 "betting": {
  "blowout_margins": [
   17.5,
   21.5
  ],
  "alt_dog_spread_range": [
   2.0,
   7.0
  ],
  "spread_edge_threshold_pts": 3.0,
  "ml_edge_threshold": 0.04,
  "remove_vig": true
 }
}
```

## Last week graded (week 7)
No archived predictions for last week (first run, or last week was not predicted).

### Season 2026 live so far
No graded games.

### Backtest [2023, 2024, 2025]
- Games: 2264
- Margin MAE: model 12.1 vs market 12.03
- Total MAE: model 12.9 vs market 12.66
- Win prob Brier (lower is better): model 0.1794 vs market 0.1776 (2209 games)
- Results within 1 sigma: 68.7% (target ~68%), avg sigma 15.26
- Calibration (favorite win %): 50-60%: pred 55.5% / actual 53.2% (n=551); 60-70%: pred 64.8% / actual 67.0% (n=573); 70-80%: pred 74.7% / actual 73.2% (n=440); 80-90%: pred 84.6% / actual 90.8% (n=381); 90-100%: pred 94.7% / actual 96.2% (n=319)
- Spread picks (edge >= 3.0 pts): 38-45-1, win 45.8%, units -10.45 (52.4% breaks even)
- ML picks (edge >= 4.0%): 189/479 won, units -33.7, ROI -7.0%; favorites only: 140 bets, 1.49 units
- Fav by more than 17.5 (market fav 2.0-7.0, 932 games): predicted 19.2%, actual 20.4%, flat-sigma baseline 20.7%
  - Alt dog +17.5 hit rate: all band games 79.6%, our lowest-risk third 84.8%
  - Lowest risk third: predicted 15.0%, actual 15.2% (n=310)
  - Middle third: predicted 18.9%, actual 21.0% (n=310)
  - Highest risk third: predicted 23.6%, actual 25.0% (n=312)
- Fav by more than 21.5 (market fav 2.0-7.0, 932 games): predicted 12.8%, actual 13.7%, flat-sigma baseline 14.3%
  - Alt dog +21.5 hit rate: all band games 86.3%, our lowest-risk third 89.7%
  - Lowest risk third: predicted 9.6%, actual 10.3% (n=310)
  - Middle third: predicted 12.6%, actual 13.9% (n=310)
  - Highest risk third: predicted 16.3%, actual 17.0% (n=312)

## Feature weights (points of home margin per 1 standard deviation)
- Elo rating gap (elo_diff): +10.95
- Net success rate gap (net_success_diff): +3.42
- Roster talent gap (talent_diff): +2.86
- Net EPA per play gap (net_ppa_diff): -1.99
- Scoring margin gap (net_points_diff): -1.70
- Havoc (disruption) gap (net_havoc_diff): +1.00
- Net explosiveness gap (net_explosiveness_diff): +0.69
- Home field (home_field): +0.42
- Pass game matchup (pass_matchup): +0.40
- Run game matchup (rush_matchup): +0.14

## This week (week 8) highlights

### Lowest blowout risk (alt-dog candidates)
- Tulane +3.0: P(fav by 18+) 14.2%, P(fav by 22+) 9.0%, sigma 14.87
- Central Michigan +3.5: P(fav by 18+) 14.7%, P(fav by 22+) 9.2%, sigma 14.25
- Tennessee +2.5: P(fav by 18+) 14.7%, P(fav by 22+) 9.5%, sigma 15.29
- Arkansas State +2.5: P(fav by 18+) 15.1%, P(fav by 22+) 9.8%, sigma 15.2
- Duke +2.5: P(fav by 18+) 15.8%, P(fav by 22+) 10.2%, sigma 14.95
- Virginia Tech +2.5: P(fav by 18+) 16.7%, P(fav by 22+) 11.0%, sigma 15.27
- Sam Houston +3.0: P(fav by 18+) 16.8%, P(fav by 22+) 11.1%, sigma 15.51
- Mississippi State +2.5: P(fav by 18+) 16.9%, P(fav by 22+) 11.1%, sigma 15.35
- Ole Miss +3.0: P(fav by 18+) 16.9%, P(fav by 22+) 11.1%, sigma 15.14
- Wisconsin +3.0: P(fav by 18+) 17.4%, P(fav by 22+) 11.3%, sigma 14.55

### Largest ML edges (model prob minus no-vig implied)
- Vanderbilt +340: model 27.6% vs implied 21.8% (edge +5.8 pts)
- Colorado +410: model 24.5% vs implied 18.8% (edge +5.6 pts)
- Wyoming +210: model 36.3% vs implied 30.9% (edge +5.4 pts)
- Toledo -142: model 60.8% vs implied 56.3% (edge +4.4 pts)
- Sacramento State +440: model 22.0% vs implied 17.8% (edge +4.3 pts)
- Kansas State -120: model 56.3% vs implied 52.2% (edge +4.1 pts)
- Army -118: model 55.8% vs implied 51.7% (edge +4.1 pts)
- North Texas -155: model 62.1% vs implied 58.3% (edge +3.8 pts)
- Syracuse +275: model 29.2% vs implied 25.6% (edge +3.7 pts)
- Rice +270: model 29.4% vs implied 25.9% (edge +3.5 pts)

### Biggest spread disagreements
- Colorado @ Oklahoma State: market home -13.5, model home -10.7
- Sacramento State @ Ball State: market home -14.5, model home -11.9
- Liberty @ Kennesaw State: market home +8.5, model home +10.6
- Air Force @ Wyoming: market home +7.0, model home +5.1
- Boise State @ Washington State: market home +14.5, model home +12.9
- Vanderbilt @ Kentucky: market home -10.5, model home -8.9
- Houston @ Utah: market home -6.5, model home -8.1
- North Texas @ Navy: market home +3.0, model home +4.5

## Auto-flags for tuning
- Backtest [2023, 2024, 2025]: calibration off in the 80-90% bin (pred 84.6%, actual 90.8%).

## Changelog note for this run
market_blend 0.75 final
