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

Command line, no window: `python luckyday_scraper.py results.xlsx`

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
