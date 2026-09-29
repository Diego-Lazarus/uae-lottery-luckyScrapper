# UAE Lottery Lucky Day Results

A simple desktop tool that downloads the official **UAE Lottery Lucky Day** draw results from
[theuaelottery.ae](https://www.theuaelottery.ae/lottery/luckyday/results) and saves them as an Excel
spreadsheet for data analysis.

## Setup

1. Install [Python 3.10+](https://www.python.org/downloads/). On Windows, tick **"Add Python to PATH"**.
2. Download this repository (**Code → Download ZIP**) and unzip it.

## Use

Double-click **`Lucky Day Results.bat`**. The first time, it installs the two packages it needs.

1. Choose **All results**, or **Date range** and enter dates as `YYYY-MM-DD`.
2. Click **Download results…** and choose where to save the file.
3. When it's done, click **Open spreadsheet**.

The results are fetched live every time, and nothing else is stored.

On macOS or Linux, or without the .bat file:

```bash
pip install -r requirements.txt
python luckyday_app.py
```

## Command line (for scripts, other apps and AI agents)

`luckyday_cli.py` gives the same data without the window. It fetches live, never prompts, prints only
the result to stdout (JSON by default), and reports errors on stderr with a meaningful exit code.

```bash
pip install -r requirements.txt

python luckyday_cli.py latest                                   # newest draw (1 request)
python luckyday_cli.py draws --from 2025-06-01 --to 2025-07-31  # draws in a date range
python luckyday_cli.py draws --last 20 --format csv -o last20.csv
python luckyday_cli.py stats --format text                      # how often each number/month was drawn
python luckyday_cli.py export results.xlsx --open               # the full analysis spreadsheet
python luckyday_cli.py <command> --help                         # all options
```

| Option | Meaning |
|---|---|
| `--from` / `--to YYYY-MM-DD` | Date range, UAE dates, inclusive (`draws`, `stats`, `export`) |
| `--last N` | Only the newest N draws |
| `--format` | `json` (default), `csv` or `text` |
| `-o FILE` | Write `draws`/`stats` output to a file instead of stdout |
| `-v` | Show progress on stderr |
| `--save-raw FILE` / `--from-raw FILE` | Save the raw site data, or work offline from it |

**Exit codes:** `0` success · `1` network, site or file error · `2` bad usage · `3` no draws matched.
With `--format json`, errors are one JSON line on stderr: `{"error": "...", "exit_code": 3}`.

**JSON output** (`schema_version` 1). Draws are newest first. The six numbers are sorted ascending,
because the site doesn't publish the order they were drawn in.

```json
{
  "schema_version": 1,
  "source": "https://www.theuaelottery.ae/lottery/luckyday/results",
  "fetched_at": "2026-09-29T10:00:00Z",
  "offline": false,
  "filters": {"from": null, "to": null, "last": 1},
  "count": 1,
  "range": {"from": "2026-09-26", "to": "2026-09-26"},
  "draws": [{
    "draw_no": "260926", "date": "2026-09-26", "time_uae": "21:30", "weekday": "Saturday",
    "numbers": [2, 5, 10, 12, 21, 22], "lucky_month": 1, "rules_version": "1.0.2",
    "total_winners": 4627, "total_paid_aed": 642100,
    "tiers": {"jackpot": {"winners": 0, "prize_aed": 30000000, "paid_aed": 0}, "...": "second, third, fourth, fifth, lucky_chance"},
    "lucky_chance_ids": ["CC5320391", "AZ2412688", "DT9663576"]
  }]
}
```

- `stats` returns the same wrapper with `day_numbers` and `lucky_months` lists. Each entry has
  `value`, `times_drawn`, `pct_of_draws`, `expected`, `deviation`, `z_score`, `by_weekday`,
  `by_rules_version`, `last_drawn`, `draws_since_last_seen`, `longest_gap_draws` and `average_gap_draws`.
- `export` returns the wrapper with `saved` (the file path) and `latest` (the newest draw).

`python luckyday_scraper.py results.xlsx` still works too; it's the same as `export`.

## What's in the spreadsheet

| Sheet | Contents |
|---|---|
| Results | One row per draw: date, weekday, the six numbers (N1–N6), Lucky Month, winners and prizes per tier, rules version |
| Draw Features | Sum, range, odd/even, low/high, consecutive pairs, gaps, repeats from the previous draw |
| Numbers Long | One row per drawn number, the best layout for pivot tables, pandas and R |
| Number Matrix | 0/1 grid of which numbers came up in each draw, for clustering and correlation |
| Day Number Stats / Month Stats | How often each number was drawn vs expected, z-score, last seen, gaps |
| Pair Frequency | How often each pair of numbers was drawn together |
| Lucky Chance | Winning Lucky Chance IDs |
| Data Dictionary | What every column means |

Every sheet is a plain table with no formulas. If you choose a date range, all statistics are
calculated for that range only.

**Worth knowing:**
- The site publishes the six numbers **sorted**, not in the order the balls were drawn.
- The *Prize* columns show the advertised amount per winner, even when nobody won. *Total Paid* is what
  was actually paid.
- The game's schedule, draw time and prizes changed over time. Use the **Rules Version** column when
  comparing periods:

  | Rules version | Schedule | Draw time |
  |---|---|---|
  | 1.0.0 | every other Saturday | 20:30 |
  | 1.0.1 | every Saturday | 20:30 |
  | 1.0.2 | Wednesday and Saturday | 21:30 |

- Dates and times are UAE time.

---

Unofficial tool, not affiliated with The UAE Lottery. Mostly agent coded.
