# Cricket Pressure Explorer

Compare batting and bowling performance in high-pressure T20 situations. The dashboard shows overall and scenario rankings, the evidence behind each score, and head-to-head comparisons.

- [Live dashboard](https://agurum-analyze.vercel.app/dashboard/)
- [Methodology and results report (PDF)](dashboard/report.pdf)
- [Run the notebook on Kaggle](https://www.kaggle.com/code/karthikg2004/rr-hack-version-1)
- [Notebook source](rr-hack-version-1.ipynb)

## Use the dashboard

1. Choose **Batting** or **Bowling**. The dashboard defaults to LightGBM. The ranking category selector also offers CatBoost, XGBoost, and an equal-weight blend of the three models.
2. Search **Pressure scenario** by name, number, or topic. Each role has 50 solo scenarios and 12 combinations. **Overall rankings** returns to the role's top 10.
3. Use **Player pool** to view all players, released players, Indian players, or released Indian players. Minimum matches and attempts narrow the evidence shown.
4. Search a player by name or ID to open their scorecard. In **Compare players**, select two players within the same role. The head-to-head share awards one point for a higher score and half a point for a tie across situations where both players have a score. It is separate from the overall pressure score.
5. **Original CSV** downloads the underlying ranking. **Export view** saves the filtered ranking. The comparison has its own CSV export.

The overall pressure score combines a normalized solo score, a combination adjustment, and a repeat-performance bonus. The report documents the scoring and lists every scenario.

## Run the notebook on Kaggle

1. Open the [Kaggle notebook](https://www.kaggle.com/code/karthikg2004/rr-hack-version-1) and choose **Copy & Edit**. You can also import the notebook file from this repository.
2. Attach the original hackathon dataset under **Add Input**. The notebook searches `/kaggle/input` for the six source tables:

   - `ball_by_ball.csv`
   - `matches.csv`
   - `competitions.csv`
   - `teams.csv`
   - `playing_eleven.csv`
   - `competition_team_player_mapping.csv`

3. Choose a GPU accelerator if available. The notebook defaults to `GPU_MODE = "auto"`. Keep `CACHE_INPUT = None` to use its default input search. The workflow builds the pre-ball features and scenario datasets from the source tables.
4. Select **Save Version → Save & Run All**. After it completes, look for these outputs:

   | Path | Contents |
   | --- | --- |
   | `/kaggle/working/submission.csv` | Top 10 batters and bowlers from the ensemble selected by the notebook |
   | `/kaggle/working/rr_pressure_100/` | Ensemble rankings, scenario scores, and delivery evidence |
   | `/kaggle/working/rr_model_comparison/` | Individual-model rankings and held-out comparisons |

The dashboard opens the archived run with LightGBM selected. The notebook uses the ensemble for its root submission CSV.

## Run the dashboard locally

From the repository root, run:

```sh
python3 -m http.server 8770 --bind 127.0.0.1
```

Open [http://127.0.0.1:8770/dashboard/](http://127.0.0.1:8770/dashboard/). The dashboard uses the bundled results.

For Vercel, import the repository with **Root Directory** set to `./`, choose **Other**, and leave the build command empty and output directory at its default.
