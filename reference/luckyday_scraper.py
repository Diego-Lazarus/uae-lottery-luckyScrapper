"""
UAE Lottery "Lucky Day" results scraper.

The results page (https://www.theuaelottery.ae/lottery/luckyday/results) is a
JavaScript app, so instead of parsing HTML this script calls the same JSON API
the page uses:

    GET /qapi/command/execute?command=660301&lotteryType=61&...

The API returns at most 10 draws per call. Older draws are fetched by passing
the oldest draw number seen so far (phase=...) with alreadyDrawn=0 and
includeSelf=0, just as the page's infinite scroll does.

Requirements:  pip install requests openpyxl
Usage:         python luckyday_scraper.py [output.xlsx]
               python luckyday_scraper.py --from-raw luckyday_raw.json [output.xlsx]
"""

import json
import sys
import time
from datetime import datetime, timedelta, timezone

import requests
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

API = "https://www.theuaelottery.ae/qapi/command/execute"
LOTTERY_TYPE = 61  # Lucky Day
UAE_TZ = timezone(timedelta(hours=4))  # UAE has no DST
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/128.0 Safari/537.36",
    "Referer": "https://www.theuaelottery.ae/lottery/luckyday/results",
    "Accept": "application/json",
}


def fetch_page(session, before_phase=None):
    params = {"command": "660301", "lang": "en-US", "lotteryType": LOTTERY_TYPE,
              "isDesc": 1, "prePhases": 10}
    if before_phase:
        params.update(phase=before_phase, alreadyDrawn=0, includeSelf=0)
    else:
        params.update(alreadyDrawn=1, includeSelf=1)

    for attempt in range(4):
        try:
            r = session.get(API, params=params, headers=HEADERS, timeout=30)
            r.raise_for_status()
            data = r.json()
            if data.get("code") != 0:
                raise RuntimeError(f"API error {data.get('code')}: {data.get('message')}")
            return (data.get("data") or {}).get("phaseList") or []
        except Exception as e:
            if attempt == 3:
                raise
            print(f"  retrying after error: {e}")
            time.sleep(2 * (attempt + 1))


def fetch_all_draws():
    draws, seen = [], set()
    with requests.Session() as s:
        before = None
        while True:
            batch = fetch_page(s, before)
            new = [d for d in batch if d["phase"] not in seen]
            if not new:
                break
            for d in new:
                seen.add(d["phase"])
                draws.append(d)
            before = new[-1]["phase"]
            print(f"  fetched {len(draws)} draws (oldest so far: {before})")
            if len(batch) < 10:
                break
            time.sleep(0.5)  # be polite
    return draws


# --------------------------------------------------------------------------
# Normalisation
# --------------------------------------------------------------------------

# (API key, column label, Data Dictionary match rule)
TIERS = [
    ("prize1", "Jackpot", "6 numbers + Lucky Month (6+1); shared prize"),
    ("prize2", "Second", "6 numbers, month wrong (6+0)"),
    ("prize3", "Third", "5 numbers + month (5+1)"),
    ("prize4", "Fourth", "5+0 or 4+1"),
    ("prize5", "Fifth", "3+1, 2+1, 1+1 or 0+1"),
    ("rafflePrize", "Lucky Chance", "Lucky Chance ID raffle"),
]
DAY_MAX, MONTH_MAX, PICKS = 31, 12, 6
LOW_MAX = 15  # "Low" = 1-15, "High" = 16-31
WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def parse_draw(d):
    result = {r["key"]: r.get("data") or [] for r in d.get("result") or []}
    detail = {r["key"]: r for r in d.get("resultDetail") or []}
    # Convert to UAE wall-clock time (UTC+4) regardless of this machine's timezone.
    when = datetime.fromtimestamp(int(d["expectedPrizeTimestamp"]) / 1000, UAE_TZ).replace(tzinfo=None)
    numbers = sorted(int(x) for x in result.get("day", []))
    month = int(result["month"][0]) if result.get("month") else None
    if len(numbers) != PICKS or not all(1 <= n <= DAY_MAX for n in numbers):
        raise ValueError(f"draw {d['phase']}: invalid day numbers {result.get('day')}")
    if month is not None and not 1 <= month <= MONTH_MAX:
        raise ValueError(f"draw {d['phase']}: invalid Lucky Month {month}")

    def num(v):
        return int(v) if v not in (None, "") else None

    tiers = {}
    for key, _, _ in TIERS:
        t = detail.get(key, {})
        tiers[key] = {"winners": num(t.get("bet")), "prize": t.get("prize"), "paid": t.get("totalPrize")}
    return {
        "draw_no": str(d["phase"]),
        "when": when,
        "numbers": numbers,
        "month": month,
        "raffle": list(result.get("raffle", [])),
        "tiers": tiers,
        "total_winners": d.get("totalWinningBetCount"),
        "rules_version": d.get("configVersion"),
    }


# --------------------------------------------------------------------------
# Derived statistics (all computed from the full dataset, oldest -> newest)
# --------------------------------------------------------------------------

def draw_features(p, prev):
    n = p["numbers"]
    gaps = [b - a for a, b in zip(n, n[1:])]
    return {
        "Sum": sum(n),
        "Mean": round(sum(n) / len(n), 2),
        "Min": n[0],
        "Max": n[-1],
        "Range": n[-1] - n[0],
        "Odd Count": sum(x % 2 for x in n),
        "Even Count": sum(1 - x % 2 for x in n),
        "Low Count 1 to 15": sum(x <= LOW_MAX for x in n),
        "High Count 16 to 31": sum(x > LOW_MAX for x in n),
        "Count 1 to 10": sum(1 <= x <= 10 for x in n),
        "Count 11 to 20": sum(11 <= x <= 20 for x in n),
        "Count 21 to 31": sum(21 <= x <= 31 for x in n),
        "Consecutive Pairs": sum(g == 1 for g in gaps),
        "Max Gap": max(gaps),
        "Repeats From Previous Draw": len(set(n) & set(prev["numbers"])) if prev else None,
        "Contains Draw Day": int(p["when"].day in n),
        "Lucky Month Equals Draw Month": int(p["month"] == p["when"].month) if p["month"] else None,
    }


def number_stats(chrono, values_of, universe, p_hit):
    """Frequency / expectation / recency stats for each value in `universe`.

    chrono     draws oldest -> newest
    values_of  function(draw) -> list of values drawn for this ball type
    p_hit      probability a given value appears in one draw (6/31 or 1/12)
    """
    n_draws = len(chrono)
    weekdays = sorted({p["when"].isoweekday() for p in chrono})
    versions = sorted({p["rules_version"] for p in chrono if p["rules_version"]})
    rows = []
    for v in universe:
        seqs = [i + 1 for i, p in enumerate(chrono) if v in values_of(p)]
        hits = len(seqs)
        expected = n_draws * p_hit
        sd = (n_draws * p_hit * (1 - p_hit)) ** 0.5
        gaps = [b - a for a, b in zip(seqs, seqs[1:])]
        row = {
            "Times Drawn": hits,
            "Pct Of Draws": hits / n_draws if n_draws else None,
            "Expected": round(expected, 3),
            "Deviation": round(hits - expected, 3),
            "Z Score": round((hits - expected) / sd, 3) if sd else None,
        }
        for wd in weekdays:
            row[f"{WEEKDAYS[wd - 1]} Count"] = sum(1 for s in seqs if chrono[s - 1]["when"].isoweekday() == wd)
        for ver in versions:
            row[f"Rules {ver} Count"] = sum(1 for s in seqs if chrono[s - 1]["rules_version"] == ver)
        row.update({
            "Last Drawn Date": chrono[seqs[-1] - 1]["when"].date() if seqs else None,
            "Draws Since Last Seen": n_draws - seqs[-1] if seqs else None,
            "Longest Gap Draws": max(gaps) if gaps else None,
            "Average Gap Draws": round(sum(gaps) / len(gaps), 3) if gaps else None,
        })
        rows.append((v, row))
    return rows


# --------------------------------------------------------------------------
# Workbook
# --------------------------------------------------------------------------

HEADER_FILL = PatternFill("solid", fgColor="1F4E78")
HEADER_FONT = Font(bold=True, color="FFFFFF")
FMT_DATE, FMT_INT, FMT_PCT, FMT_DEC = "yyyy-mm-dd", "#,##0", "0.00%", "0.000"


def write_table(wb, title, header, rows, formats=None, freeze="A2", width=None, hidden=False):
    """One rectangular table per sheet: header in row 1, data from row 2, no formulas."""
    ws = wb.create_sheet(title)
    ws.append(header)
    for r in rows:
        ws.append(r)
    for c in range(1, len(header) + 1):
        cell = ws.cell(row=1, column=c)
        cell.fill, cell.font = HEADER_FILL, HEADER_FONT
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    for col_name, fmt in (formats or {}).items():
        c = header.index(col_name) + 1
        for r in range(2, ws.max_row + 1):
            ws.cell(row=r, column=c).number_format = fmt
    ws.freeze_panes = freeze
    ws.auto_filter.ref = ws.dimensions
    for i, h in enumerate(header, 1):
        if width:
            w = width
        else:
            longest = max((len(str(ws.cell(row=r, column=i).value or "")) for r in range(2, min(ws.max_row, 200) + 1)), default=0)
            w = max(8, min(40, max(longest + 2, len(str(h)) // 2 + 3)))
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.row_dimensions[1].height = 32
    if hidden:
        ws.sheet_state = "hidden"
    return ws


def build_workbook(draws, path):
    """draws: parsed draws, any order. Every sheet is derived from the full set."""
    chrono = sorted(draws, key=lambda p: (p["when"], p["draw_no"]))
    seq = {p["draw_no"]: i + 1 for i, p in enumerate(chrono)}
    prev = {p["draw_no"]: (chrono[i - 1] if i else None) for i, p in enumerate(chrono)}
    newest_first = list(reversed(chrono))
    n_draws = len(chrono)

    wb = Workbook()
    wb.remove(wb.active)
    dictionary = []  # (sheet, column, type, description)

    def doc(sheet, cols):
        dictionary.extend((sheet, c, t, d) for c, t, d in cols)

    # 1. Results --------------------------------------------------------------
    header = ["Draw No", "Draw Seq", "Draw Date", "Draw Time UAE", "Year", "Month", "Day",
              "Weekday", "Weekday Num", "N1", "N2", "N3", "N4", "N5", "N6", "Lucky Month"]
    for _, label, _ in TIERS:
        header += [f"{label} Winners", f"{label} Prize AED"]
    header += ["Total Winners", "Total Paid AED", "Lucky Chance IDs", "Rules Version"]
    rows = []
    for p in newest_first:
        w = p["when"]
        row = [p["draw_no"], seq[p["draw_no"]], w.date(), w.strftime("%H:%M"), w.year, w.month, w.day,
               w.strftime("%A"), w.isoweekday(), *p["numbers"], p["month"]]
        for key, _, _ in TIERS:
            row += [p["tiers"][key]["winners"], p["tiers"][key]["prize"]]
        paid = [t["paid"] for t in p["tiers"].values() if t["paid"] is not None]
        row += [p["total_winners"], sum(paid) if paid else None, ", ".join(p["raffle"]), p["rules_version"]]
        rows.append(row)
    money = {f"{label} Prize AED": FMT_INT for _, label, _ in TIERS}
    money.update({f"{label} Winners": FMT_INT for _, label, _ in TIERS})
    write_table(wb, "Results", header, rows, {"Draw Date": FMT_DATE, "Total Winners": FMT_INT,
                                             "Total Paid AED": FMT_INT, **money}, freeze="B2")
    doc("Results", [
        ("Draw No", "text", "Official draw identifier (series number, YYMMDD). Stored as text."),
        ("Draw Seq", "integer", "Chronological index, 1 = oldest draw in this file. Use for ordering / lags."),
        ("Draw Date", "date", "Draw date in UAE time (UTC+4)."),
        ("Draw Time UAE", "text", "Draw time HH:MM in UAE time. Changed from 20:30 to 21:30 in rules 1.0.2."),
        ("Year / Month / Day", "integer", "Parts of Draw Date."),
        ("Weekday / Weekday Num", "text / integer", "Day of week of the draw; ISO number Monday=1 ... Sunday=7."),
        ("N1-N6", "integer 1-31", "The six Day numbers SORTED ASCENDING (the API does not publish ball-draw order). "
                                  "N1 is the smallest, N6 the largest - treat as order statistics, not draw positions."),
        ("Lucky Month", "integer 1-12", "The Month number drawn."),
        ("<Tier> Winners", "integer", "Number of winning tickets in the tier."),
        ("<Tier> Prize AED", "integer", "NOMINAL prize per winner for that draw (advertised amount - shown even when "
                                        "there are 0 winners). Not the amount actually paid."),
        ("Total Winners", "integer", "Total winning tickets across all tiers incl. Lucky Chance."),
        ("Total Paid AED", "integer", "Sum of the actual amounts paid across all tiers (API totalPrize)."),
        ("Lucky Chance IDs", "text", "Comma-separated winning Lucky Chance IDs. Count varies by rules version."),
        ("Rules Version", "text", "Game configuration version. Schedule, draw time, jackpot and Lucky Chance "
                                  "count/prize differ between versions - segment by this when comparing periods."),
    ] + [(f"{label} Winners/Prize AED", "tier", rule) for _, label, rule in TIERS])

    # 2. Draw Features -------------------------------------------------------
    feats = [(p, draw_features(p, prev[p["draw_no"]])) for p in newest_first]
    fcols = list(feats[0][1].keys()) if feats else []
    write_table(wb, "Draw Features", ["Draw No", "Draw Seq", "Draw Date", "Rules Version", *fcols],
                [[p["draw_no"], seq[p["draw_no"]], p["when"].date(), p["rules_version"], *f.values()] for p, f in feats],
                {"Draw Date": FMT_DATE}, freeze="B2")
    doc("Draw Features", [
        ("Sum / Mean / Min / Max / Range", "number", "Of the six Day numbers."),
        ("Odd Count / Even Count", "integer", "How many of the six numbers are odd / even."),
        ("Low Count 1 to 15 / High Count 16 to 31", "integer", "Numbers in the low / high half."),
        ("Count 1 to 10 / 11 to 20 / 21 to 31", "integer", "Numbers per band."),
        ("Consecutive Pairs", "integer", "Adjacent sorted numbers differing by exactly 1 (e.g. 21,22 = 1 pair)."),
        ("Max Gap", "integer", "Largest difference between adjacent sorted numbers."),
        ("Repeats From Previous Draw", "integer", "Day numbers shared with the chronologically previous draw "
                                                  "(blank for the first draw)."),
        ("Contains Draw Day", "0/1", "1 if the draw's own day-of-month is among the six numbers."),
        ("Lucky Month Equals Draw Month", "0/1", "1 if the Lucky Month equals the calendar month of the draw."),
    ])

    # 3. Numbers Long --------------------------------------------------------
    long_rows = []
    for p in newest_first:
        base = [p["draw_no"], seq[p["draw_no"]], p["when"].date(), p["when"].year, p["when"].month,
                p["when"].strftime("%A"), p["rules_version"]]
        for pos, n in enumerate(p["numbers"], 1):
            long_rows.append(base + ["Day", pos, n])
        if p["month"] is not None:
            long_rows.append(base + ["Month", None, p["month"]])
    write_table(wb, "Numbers Long", ["Draw No", "Draw Seq", "Draw Date", "Year", "Month", "Weekday",
                                     "Rules Version", "Ball Type", "Sorted Position", "Number"],
                long_rows, {"Draw Date": FMT_DATE})
    doc("Numbers Long", [
        ("(sheet)", "tidy", "One row per drawn number - best for pivot tables, pandas, R."),
        ("Ball Type", "text", "'Day' (1-31, six per draw) or 'Month' (1-12, one per draw)."),
        ("Sorted Position", "integer", "1-6 rank of a Day number within its draw (ascending). Blank for Month."),
    ])

    # 4. Number Matrix -------------------------------------------------------
    mheader = ["Draw No", "Draw Seq", "Draw Date"] + [f"D{i}" for i in range(1, DAY_MAX + 1)] + \
              [f"M{i}" for i in range(1, MONTH_MAX + 1)]
    mrows = [[p["draw_no"], seq[p["draw_no"]], p["when"].date()]
             + [int(i in p["numbers"]) for i in range(1, DAY_MAX + 1)]
             + [int(i == p["month"]) for i in range(1, MONTH_MAX + 1)] for p in newest_first]
    write_table(wb, "Number Matrix", mheader, mrows, {"Draw Date": FMT_DATE}, freeze="D2", width=None)
    doc("Number Matrix", [
        ("D1-D31", "0/1", "One-hot: 1 if that Day number was drawn. Each row sums to 6."),
        ("M1-M12", "0/1", "One-hot: 1 if that Lucky Month was drawn. Each row sums to 1."),
    ])

    # 5 & 6. Day Number Stats / Month Stats ----------------------------------
    stat_fmt = {"Pct Of Draws": FMT_PCT, "Last Drawn Date": FMT_DATE}
    for title, universe, values_of, p_hit, label in [
        ("Day Number Stats", range(1, DAY_MAX + 1), lambda p: p["numbers"], PICKS / DAY_MAX, "Number"),
        ("Month Stats", range(1, MONTH_MAX + 1), lambda p: [p["month"]] if p["month"] else [], 1 / MONTH_MAX, "Month"),
    ]:
        stats = number_stats(chrono, values_of, universe, p_hit)
        cols = list(stats[0][1].keys())
        write_table(wb, title, [label, *cols], [[v, *s.values()] for v, s in stats], stat_fmt)
    doc("Day Number Stats", [
        ("Times Drawn", "integer", "Draws containing the number (whole dataset)."),
        ("Pct Of Draws", "fraction", "Times Drawn / total draws."),
        ("Expected", "number", "Expected count if uniform: draws x 6/31 (Day) or draws x 1/12 (Month)."),
        ("Deviation", "number", "Times Drawn - Expected."),
        ("Z Score", "number", "Deviation / sqrt(draws x p x (1-p)); |Z| > 2 is unusual for ONE number, but with "
                              "31 numbers ~1-2 such values are expected by chance."),
        ("<Weekday> Count", "integer", "Times drawn on that weekday."),
        ("Rules <version> Count", "integer", "Times drawn under that rules version."),
        ("Last Drawn Date", "date", "Most recent draw containing the number."),
        ("Draws Since Last Seen", "integer", "Draws since it last appeared (0 = in the latest draw)."),
        ("Longest Gap Draws / Average Gap Draws", "number", "Gap in draws between consecutive appearances."),
    ])
    doc("Month Stats", [("(sheet)", "sheet", "Same columns as Day Number Stats, for the Lucky Month (p = 1/12).")])

    # 7. Pair Frequency ------------------------------------------------------
    pair = [[0] * (DAY_MAX + 1) for _ in range(DAY_MAX + 1)]
    for p in chrono:
        for a in p["numbers"]:
            for b in p["numbers"]:
                pair[a][b] += 1  # diagonal (a == b) = single-number count
    write_table(wb, "Pair Frequency", ["Number", *range(1, DAY_MAX + 1)],
                [[a, *pair[a][1:]] for a in range(1, DAY_MAX + 1)], freeze="B2", width=6)
    doc("Pair Frequency", [
        ("(matrix)", "integer", "Draws in which row number and column number both appeared. Symmetric; the "
                                "diagonal is the single-number count. Expected count per pair if uniform = "
                                f"draws x (6x5)/(31x30) = draws/31 = {n_draws / 31:.2f}."),
    ])

    # 8. Lucky Chance --------------------------------------------------------
    write_table(wb, "Lucky Chance", ["Draw No", "Draw Date", "Rules Version", "Lucky Chance ID", "Prize AED"],
                [[p["draw_no"], p["when"].date(), p["rules_version"], rid, p["tiers"]["rafflePrize"]["prize"]]
                 for p in newest_first for rid in p["raffle"]],
                {"Draw Date": FMT_DATE, "Prize AED": FMT_INT})
    doc("Lucky Chance", [("(sheet)", "sheet", "One row per winning Lucky Chance ID; prize is per ID.")])

    # 9. Data Dictionary -----------------------------------------------------
    write_table(wb, "Data Dictionary", ["Sheet", "Column", "Type", "Description"], dictionary)
    ws = wb["Data Dictionary"]
    ws.column_dimensions["D"].width = 110
    for r in range(2, ws.max_row + 1):
        ws.cell(row=r, column=4).alignment = Alignment(wrap_text=True, vertical="top")

    # 10. Metadata (hidden) --------------------------------------------------
    meta = [
        ("Dataset ID", "uae-lottery-lucky-day"),
        ("Generated At UTC", datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")),
        ("Total Draws", n_draws),
        ("Oldest Draw", f"{chrono[0]['draw_no']} ({chrono[0]['when']:%Y-%m-%d})" if chrono else ""),
        ("Latest Draw", f"{chrono[-1]['draw_no']} ({chrono[-1]['when']:%Y-%m-%d})" if chrono else ""),
        ("Source URL", "https://www.theuaelottery.ae/lottery/luckyday/results"),
        ("Generator", "luckyday_scraper.py (Python reference)"),
    ]
    write_table(wb, "Metadata", ["Key", "Value"], meta, hidden=True)

    wb.save(path)


def main():
    args = sys.argv[1:]
    raw_in = None
    if "--from-raw" in args:  # rebuild the workbook from a saved raw JSON without refetching
        i = args.index("--from-raw")
        raw_in = args[i + 1]
        del args[i:i + 2]
    out = args[0] if args else "uae_lottery_luckyday_results.xlsx"

    if raw_in:
        with open(raw_in, encoding="utf-8") as f:
            raw = json.load(f)
        print(f"Loaded {len(raw)} raw draws from {raw_in}")
    else:
        print("Fetching Lucky Day results...")
        raw = fetch_all_draws()
        with open("luckyday_raw.json", "w", encoding="utf-8") as f:
            json.dump(raw, f, ensure_ascii=False, indent=1)

    draws = [parse_draw(d) for d in raw]
    if len({p["draw_no"] for p in draws}) != len(draws):
        raise SystemExit("duplicate draw numbers in data")
    build_workbook(draws, out)
    print(f"Saved {len(draws)} draws to {out}")


if __name__ == "__main__":
    main()
