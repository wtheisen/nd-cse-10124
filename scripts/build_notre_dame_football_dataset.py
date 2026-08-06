#!/usr/bin/env python3
"""Build the numeric Notre Dame football dataset used in Homework 01.

The source files are the open cfbfastR schedule archives, which in turn are
derived from ESPN/CollegeFootballData records.  Keeping the transformation in
the repository makes the classroom CSV reproducible and documents every
feature students receive.
"""

from __future__ import annotations

import io
import pathlib
import urllib.request

import pandas as pd


START_SEASON = 2012
END_SEASON = 2022
SOURCE_TEMPLATE = (
    "https://raw.githubusercontent.com/sportsdataverse/cfbfastR-data/main/"
    "cfb/schedules/parquet/cfb_schedule_{season}.parquet"
)
OUTPUT = (
    pathlib.Path(__file__).resolve().parents[1]
    / "static/data/notre_dame_football_games_2012_2022.csv"
)


def read_season(season: int) -> pd.DataFrame:
    with urllib.request.urlopen(SOURCE_TEMPLATE.format(season=season)) as response:
        return pd.read_parquet(io.BytesIO(response.read()))


def notre_dame_rows(frame: pd.DataFrame) -> pd.DataFrame:
    is_home = frame["home_location"].eq("Notre Dame")
    is_away = frame["away_location"].eq("Notre Dame")
    games = frame.loc[is_home | is_away].copy()
    games["nd_home"] = is_home.loc[games.index].astype(int)
    games["neutral_site"] = games["neutral_site"].fillna(False).astype(int)
    games["nd_points"] = games["home_score"].where(
        games["nd_home"].eq(1), games["away_score"]
    )
    games["opponent_points"] = games["away_score"].where(
        games["nd_home"].eq(1), games["home_score"]
    )
    games["nd_points"] = pd.to_numeric(games["nd_points"], errors="coerce")
    games["opponent_points"] = pd.to_numeric(
        games["opponent_points"], errors="coerce"
    )
    games["attendance"] = pd.to_numeric(games["attendance"], errors="coerce")
    games["venue_capacity"] = pd.to_numeric(
        games["venue_capacity"], errors="coerce"
    )
    games["point_margin"] = games["nd_points"] - games["opponent_points"]
    games["win"] = games["point_margin"].gt(0).astype(int)
    games["attendance_rate"] = games["attendance"] / games["venue_capacity"]
    return games


def main() -> None:
    frames = [
        notre_dame_rows(read_season(year))
        for year in range(START_SEASON, END_SEASON + 1)
    ]
    games = pd.concat(frames, ignore_index=True)
    columns = [
        "season",
        "week",
        "nd_home",
        "neutral_site",
        "attendance",
        "venue_capacity",
        "attendance_rate",
        "nd_points",
        "opponent_points",
        "point_margin",
        "win",
    ]
    games = games.loc[games["status_type_completed"].fillna(False), :]
    games = games.loc[:, columns]
    games = games.dropna().sort_values(["season", "week", "nd_home"])

    integer_columns = [
        "season",
        "week",
        "nd_home",
        "neutral_site",
        "attendance",
        "venue_capacity",
        "nd_points",
        "opponent_points",
        "point_margin",
        "win",
    ]
    games[integer_columns] = games[integer_columns].astype(int)
    games["attendance_rate"] = games["attendance_rate"].round(3)

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    games.to_csv(OUTPUT, index=False)
    print(f"Wrote {len(games)} games to {OUTPUT}")


if __name__ == "__main__":
    main()
