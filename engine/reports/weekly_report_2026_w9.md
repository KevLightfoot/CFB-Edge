# CFB Edge weekly report: 2026 week 9
Generated 2026-10-29T05:14:57 | model v7 (trained 2026-10-29T05:14:57) | RETRAINED THIS RUN
Training: 5641 games, seasons [2018, 2019, 2021, 2022, 2023, 2024, 2025, 2026], out-of-fold margin MAE 12.17

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
   "home_field",
   "qb_flag_diff"
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
   "abs_talent_gap",
   "qb_flag_sum"
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

## Last week graded (week 8)

### Week 8
- Games: 56
- Margin MAE: model 10.84 vs market 10.76
- Total MAE: model 15.44 vs market 14.75
- Win prob Brier (lower is better): model 0.2334 vs market 0.2338 (56 games)
- Results within 1 sigma: 73.2% (target ~68%), avg sigma 15.14
- Calibration (favorite win %): 50-60%: pred 55.0% / actual 50.0% (n=14); 60-70%: pred 62.7% / actual 75.0% (n=12); 70-80%: pred 74.7% / actual 54.5% (n=22); 80-90%: pred 82.8% / actual 85.7% (n=7); 90-100%: pred 90.6% / actual 100.0% (n=1)
- Spread picks (edge >= 3.0 pts): 0-0-0, win n/a, units 0.0 (52.4% breaks even)
- ML picks (edge >= 4.0%): 3/7 won, units -0.35, ROI -5.0%; favorites only: 3 bets, 0.55 units
- Fav by more than 17.5 (market fav 2.0-7.0, 22 games): predicted 18.5%, actual 18.2%, flat-sigma baseline 19.7%
  - Alt dog +17.5 hit rate: all band games 81.8%, our lowest-risk third 85.7%
  - Lowest risk third: predicted 15.4%, actual 14.3% (n=7)
  - Middle third: predicted 17.8%, actual 0.0% (n=7)
  - Highest risk third: predicted 21.9%, actual 37.5% (n=8)
- Fav by more than 21.5 (market fav 2.0-7.0, 22 games): predicted 12.3%, actual 13.6%, flat-sigma baseline 13.6%
  - Alt dog +21.5 hit rate: all band games 86.4%, our lowest-risk third 85.7%
  - Lowest risk third: predicted 10.0%, actual 14.3% (n=7)
  - Middle third: predicted 11.7%, actual 0.0% (n=7)
  - Highest risk third: predicted 14.9%, actual 25.0% (n=8)

#### Biggest misses
- Hawai'i @ Northern Illinois: predicted home -4.2 (sigma 15.11), market +3.5, final 56-21 (home -35). Top factors: Elo rating gap -8.5, Net success rate gap -4.0, Scoring margin gap +1.6
- Boston College @ Georgia Tech: predicted home +6.7 (sigma 15.26), market -6.0, final 49-27 (home -22). Top factors: Net success rate gap +2.1, Elo rating gap +1.9, Roster talent gap +1.0
- Iowa State @ Arizona: predicted home +9.6 (sigma 15.28), market -10.5, final 3-39 (home +36). Top factors: Net success rate gap +2.9, Elo rating gap +1.9, Net EPA per play gap -1.6
- Texas Tech @ Cincinnati: predicted home -11.6 (sigma 15.11), market +11.5, final 24-37 (home +13). Top factors: Elo rating gap -16.6, Net success rate gap -4.1, Scoring margin gap +2.7
- Colorado @ Oklahoma State: predicted home +10.7 (sigma 15.51), market -13.5, final 24-57 (home +33). Top factors: Roster talent gap -1.4, Net explosiveness gap -0.7, Scoring margin gap -0.6
- UTSA @ Tulane: predicted home -1.5 (sigma 14.87), market +3.0, final 42-19 (home -23). Top factors: Net success rate gap -3.0, Net explosiveness gap +1.2, Elo rating gap +0.4

#### Alt-dog band games (market fav by 2.0-7.0), sorted by our blowout risk
- Tulane (+3.0) vs UTSA: blowout risk 14.2%; fav won by +23; +17.5 MISS, +21.5 MISS
- Central Michigan (+3.5) vs Miami (OH): blowout risk 14.7%; fav won by +1; +17.5 HIT, +21.5 HIT
- Tennessee (+2.5) vs South Carolina: blowout risk 14.7%; fav won by +3; +17.5 HIT, +21.5 HIT
- Arkansas State (+2.5) vs Georgia State: blowout risk 15.1%; fav won by -6; +17.5 HIT, +21.5 HIT
- Duke (+2.5) vs Virginia: blowout risk 15.8%; fav won by -3; +17.5 HIT, +21.5 HIT
- Virginia Tech (+2.5) vs Clemson: blowout risk 16.7%; fav won by -4; +17.5 HIT, +21.5 HIT
- Sam Houston (+3.0) vs New Mexico State: blowout risk 16.8%; fav won by +6; +17.5 HIT, +21.5 HIT
- Mississippi State (+2.5) vs Oklahoma: blowout risk 16.9%; fav won by +8; +17.5 HIT, +21.5 HIT
- Ole Miss (+3.0) vs Texas: blowout risk 16.9%; fav won by +7; +17.5 HIT, +21.5 HIT
- Wisconsin (+3.0) vs USC: blowout risk 17.4%; fav won by -17; +17.5 HIT, +21.5 HIT
- Western Michigan (+3.0) vs Toledo: blowout risk 17.8%; fav won by +7; +17.5 HIT, +21.5 HIT
- Akron (+3.0) vs Kent State: blowout risk 18.5%; fav won by +15; +17.5 HIT, +21.5 HIT
- Bowling Green (+3.0) vs Buffalo: blowout risk 18.7%; fav won by +7; +17.5 HIT, +21.5 HIT
- Navy (+3.0) vs North Texas: blowout risk 18.7%; fav won by +10; +17.5 HIT, +21.5 HIT
- Northern Illinois (+3.5) vs Hawai'i: blowout risk 19.0%; fav won by +35; +17.5 MISS, +21.5 MISS
- North Dakota State (+4.5) vs New Mexico: blowout risk 19.2%; fav won by +5; +17.5 HIT, +21.5 HIT
- Missouri State (+3.0) vs Delaware: blowout risk 19.2%; fav won by +23; +17.5 MISS, +21.5 MISS
- Wyoming (+7.0) vs Air Force: blowout risk 19.6%; fav won by -14; +17.5 HIT, +21.5 HIT
- San José State (+6.5) vs Nevada: blowout risk 22.0%; fav won by +15; +17.5 HIT, +21.5 HIT
- Boston College (+6.0) vs Georgia Tech: blowout risk 23.9%; fav won by -22; +17.5 HIT, +21.5 HIT
- Auburn (+7.0) vs LSU: blowout risk 25.2%; fav won by +21; +17.5 MISS, +21.5 HIT
- Houston (+6.5) vs Utah: blowout risk 26.9%; fav won by +8; +17.5 HIT, +21.5 HIT

### Season 2026 live so far
- Games: 56
- Margin MAE: model 10.84 vs market 10.76
- Total MAE: model 15.44 vs market 14.75
- Win prob Brier (lower is better): model 0.2334 vs market 0.2338 (56 games)
- Results within 1 sigma: 73.2% (target ~68%), avg sigma 15.14
- Calibration (favorite win %): 50-60%: pred 55.0% / actual 50.0% (n=14); 60-70%: pred 62.7% / actual 75.0% (n=12); 70-80%: pred 74.7% / actual 54.5% (n=22); 80-90%: pred 82.8% / actual 85.7% (n=7); 90-100%: pred 90.6% / actual 100.0% (n=1)
- Spread picks (edge >= 3.0 pts): 0-0-0, win n/a, units 0.0 (52.4% breaks even)
- ML picks (edge >= 4.0%): 3/7 won, units -0.35, ROI -5.0%; favorites only: 3 bets, 0.55 units
- Fav by more than 17.5 (market fav 2.0-7.0, 22 games): predicted 18.5%, actual 18.2%, flat-sigma baseline 19.7%
  - Alt dog +17.5 hit rate: all band games 81.8%, our lowest-risk third 85.7%
  - Lowest risk third: predicted 15.4%, actual 14.3% (n=7)
  - Middle third: predicted 17.8%, actual 0.0% (n=7)
  - Highest risk third: predicted 21.9%, actual 37.5% (n=8)
- Fav by more than 21.5 (market fav 2.0-7.0, 22 games): predicted 12.3%, actual 13.6%, flat-sigma baseline 13.6%
  - Alt dog +21.5 hit rate: all band games 86.4%, our lowest-risk third 85.7%
  - Lowest risk third: predicted 10.0%, actual 14.3% (n=7)
  - Middle third: predicted 11.7%, actual 0.0% (n=7)
  - Highest risk third: predicted 14.9%, actual 25.0% (n=8)

### Backtest [2023, 2024, 2025]
- Games: 2264
- Margin MAE: model 12.09 vs market 12.03
- Total MAE: model 12.9 vs market 12.66
- Win prob Brier (lower is better): model 0.1794 vs market 0.1776 (2209 games)
- Results within 1 sigma: 68.7% (target ~68%), avg sigma 15.26
- Calibration (favorite win %): 50-60%: pred 55.6% / actual 53.1% (n=557); 60-70%: pred 64.8% / actual 66.6% (n=563); 70-80%: pred 74.7% / actual 73.7% (n=445); 80-90%: pred 84.6% / actual 90.7% (n=378); 90-100%: pred 94.7% / actual 96.0% (n=321)
- Spread picks (edge >= 3.0 pts): 37-37-2, win 50.0%, units -3.36 (52.4% breaks even)
- ML picks (edge >= 4.0%): 182/471 won, units -43.35, ROI -9.2%; favorites only: 133 bets, 2.34 units
- Fav by more than 17.5 (market fav 2.0-7.0, 932 games): predicted 19.2%, actual 20.4%, flat-sigma baseline 20.7%
  - Alt dog +17.5 hit rate: all band games 79.6%, our lowest-risk third 84.5%
  - Lowest risk third: predicted 15.0%, actual 15.5% (n=310)
  - Middle third: predicted 18.9%, actual 20.0% (n=310)
  - Highest risk third: predicted 23.6%, actual 25.6% (n=312)
- Fav by more than 21.5 (market fav 2.0-7.0, 932 games): predicted 12.8%, actual 13.7%, flat-sigma baseline 14.3%
  - Alt dog +21.5 hit rate: all band games 86.3%, our lowest-risk third 90.0%
  - Lowest risk third: predicted 9.6%, actual 10.0% (n=310)
  - Middle third: predicted 12.6%, actual 13.9% (n=310)
  - Highest risk third: predicted 16.3%, actual 17.3% (n=312)
- Underdog QB flagged (103 band games): fav by more than 17.5: predicted 20.2%, actual 23.3%, fav by more than 21.5: predicted 13.7%, actual 15.5%
- Underdog QB normal (798 band games): fav by more than 17.5: predicted 19.1%, actual 19.7%, fav by more than 21.5: predicted 12.8%, actual 13.2%

## Feature weights (points of home margin per 1 standard deviation)
- Elo rating gap (elo_diff): +10.82
- Net success rate gap (net_success_diff): +3.44
- Roster talent gap (talent_diff): +2.86
- Net EPA per play gap (net_ppa_diff): -2.12
- Scoring margin gap (net_points_diff): -1.65
- Havoc (disruption) gap (net_havoc_diff): +1.05
- QB situation (new/inexperienced starter) (qb_flag_diff): +0.76
- Net explosiveness gap (net_explosiveness_diff): +0.72
- Home field (home_field): +0.43
- Pass game matchup (pass_matchup): +0.38
- Run game matchup (rush_matchup): +0.15

## This week (week 9) highlights

### Lowest blowout risk (alt-dog candidates)
- Washington State +2.5: P(fav by 18+) 14.3%, P(fav by 22+) 9.2%, sigma 15.42 [QB FLAG: Owen Eshelman, new starter vs. the QB the team's stats came from; only 2 career starts]
- Delaware +2.5: P(fav by 18+) 16.3%, P(fav by 22+) 10.7%, sigma 15.41
- Maryland +2.5: P(fav by 18+) 17.6%, P(fav by 22+) 11.6%, sigma 14.94
- UL Monroe +3.5: P(fav by 18+) 17.7%, P(fav by 22+) 11.7%, sigma 15.05
- New Mexico State +3.0: P(fav by 18+) 18.0%, P(fav by 22+) 11.9%, sigma 14.98
- Arizona +3.5: P(fav by 18+) 18.2%, P(fav by 22+) 12.2%, sigma 15.38
- Fresno State +5.5: P(fav by 18+) 18.3%, P(fav by 22+) 12.0%, sigma 14.85
- South Alabama +5.5: P(fav by 18+) 18.8%, P(fav by 22+) 12.5%, sigma 15.19
- Wisconsin +3.5: P(fav by 18+) 19.0%, P(fav by 22+) 12.3%, sigma 14.23
- Old Dominion +3.0: P(fav by 18+) 19.3%, P(fav by 22+) 13.0%, sigma 15.52

### Largest ML edges (model prob minus no-vig implied)
- Sacramento State +260: model 36.1% vs implied 26.6% (edge +9.4 pts)
- Iowa State +280: model 34.2% vs implied 25.2% (edge +9.0 pts)
- Fresno State +185: model 39.2% vs implied 33.6% (edge +5.6 pts)
- South Alabama +180: model 39.5% vs implied 34.3% (edge +5.2 pts)
- Texas State +340: model 26.5% vs implied 21.8% (edge +4.7 pts)
- Georgia Tech +245: model 32.4% vs implied 27.8% (edge +4.6 pts)
- Illinois -135: model 59.6% vs implied 55.1% (edge +4.4 pts)
- Memphis -218: model 70.1% vs implied 65.7% (edge +4.3 pts)
- Washington +250: model 31.6% vs implied 27.4% (edge +4.2 pts)
- Marshall -142: model 60.3% vs implied 56.3% (edge +4.0 pts)

### Biggest spread disagreements
- Kent State @ Sacramento State: market home +8.5, model home +5.3
- Oklahoma State @ Iowa State: market home +9.5, model home +6.3
- Kansas State @ Colorado: market home -1.5, model home +0.6
- Purdue @ Penn State: market home -9.5, model home -11.6
- Minnesota @ Indiana: market home -20.5, model home -22.5
- Northwestern @ Oregon: market home -3.5, model home -5.2
- UConn @ Air Force: market home -1.5, model home +0.2
- Army @ Memphis: market home -6.0, model home -7.6

### QB flags this week (new starter or under the career-start threshold)
- Tulane (at Charlotte): Trace Johnson, new starter vs. the QB the team's stats came from; only 2 career starts
- Illinois (at Maryland): Michael Clayton II, new starter vs. the QB the team's stats came from; only 1 career start
- Michigan (at Rutgers): Tommy Carr, new starter vs. the QB the team's stats came from; only 1 career start
- Kansas State (at Colorado): Jacob Knuth, new starter vs. the QB the team's stats came from; only 1 career start
- Air Force (vs UConn): Howard Fisher IV, new starter vs. the QB the team's stats came from; only 1 career start
- Florida (at Georgia): Tramell Jones Jr., new starter vs. the QB the team's stats came from; only 2 career starts
- San José State (vs New Mexico): Robert McDaniel, new starter vs. the QB the team's stats came from; only 1 career start
- Nevada (at UCLA): Luke Duncan, new starter vs. the QB the team's stats came from; only 2 career starts
- Georgia Southern (vs App State): Turner Helton, new starter vs. the QB the team's stats came from; only 1 career start
- Iowa State (vs Oklahoma State): Connor Moberly, new starter vs. the QB the team's stats came from; only 1 career start
- Washington State (at San Diego State): Owen Eshelman, new starter vs. the QB the team's stats came from; only 2 career starts
- San Diego State (vs Washington State): Stone Saunders, new starter vs. the QB the team's stats came from; only 2 career starts
- Pittsburgh (vs Georgia Tech): Holden Geriner, new starter vs. the QB the team's stats came from; only 2 career starts
- Mississippi State (at Texas): Parker Puckett, new starter vs. the QB the team's stats came from; only 2 career starts

QB flags use only completed games, so a starter change announced this week will not show. Always check Saturday's availability report.

## Auto-flags for tuning
- Backtest [2023, 2024, 2025]: calibration off in the 80-90% bin (pred 84.6%, actual 90.7%).

## Changelog note for this run
QB flag: inexperienced only
