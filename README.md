# UAE Lottery Lucky Day Results: web version

> This is the **`web` branch**. For the simple desktop tool, see the
> [`main` branch](https://github.com/Diego-Lazarus/uae-lottery-luckyScrapper/tree/main).
>
> Live site: https://diego-lazarus.github.io/uae-lottery-luckyScrapper/

A small static web utility that downloads official **UAE Lottery Lucky Day** draw results as an
analysis-ready Excel workbook. It runs entirely in the browser, with no backend. Results are kept in
the browser only while the page is open, and are cleared automatically when you close or reload it.

- **Get Results**: choose *Latest 10*, *From Date*, *Date Range* or *All Results*. Retrieved draws are
  merged into one local dataset with no duplicates.
- **Download XLSX**: rebuilds `uae_lottery_luckyday_results.xlsx` from **all** draws stored in the
  browser, every time you click.

Deployed users need only a browser. Node and Python are used only for development, the snapshot job
and the reference checks.

---

## How the data gets to the browser

The official results API (`/qapi/command/execute?command=660301`) returns
`Access-Control-Allow-Origin: https://www.theuaelottery.ae`. Browsers therefore **block** calls from any
other origin, including GitHub Pages. This was verified: a `fetch()` from another origin fails with
*"Failed to fetch"*.

So the site publishes a **snapshot**, refreshed **by hand**. There is no schedule:

```
GitHub → Actions → "Lucky Day snapshot and Pages deploy" → Run workflow (branch: web)
  → fetch official latest 10 → normalize + validate
  → load public/data/luckyday.json → reconcile by draw number
  → no changes?  yes → finish (no commit, no deploy)
                 no  → merge → validate full set → commit JSON → test → build → deploy Pages
```

Run it after a draw (Wednesdays and Saturdays, results are usually out after 22:00 UAE) to bring the
site up to date. In the app, **Get Results** fetches the same-origin `data/luckyday.json`, applies the
selected mode and loads the matching draws. The data is as fresh as the last workflow run; the
*Published snapshot* time is shown in the app.

### Snapshot commands

| Command | What it does |
|---|---|
| `npm run snapshot` | Normal run. Fetches the official **latest 10** and reconciles them with the committed snapshot: new draw numbers are added, corrected recent draws are replaced, identical ones are left alone. Writes the file **only if draw data changed**. Never removes existing draws. |
| `npm run snapshot:full` | Full rebuild through the verified history paging (`phase=<oldest>&alreadyDrawn=0&includeSelf=0`, 10 per page). Used for the first snapshot and for explicit rebuilds. |

`npm run snapshot` escalates to a full rebuild on its own when there is no snapshot, when more than 10
draws were missed, or when the API reports history older than the snapshot.

The script never works out an "expected" draw from today's date. The official latest-results response
is authoritative, so a late, postponed or skipped draw simply means "no change yet". The run fails only
on real retrieval or validation problems: duplicate draw numbers, anything other than exactly 6 numbers
from 1–31, a Lucky Month outside 1–12, bad dates, an incremental run that would remove draws, or a full
rebuild that shrinks the dataset below 95%.

`snapshotGeneratedAt` changes only when draw data changes. Check times go to the Actions log and step
summary, never into the published JSON, so a check with no changes never triggers a redeploy.

### Manual runs (GitHub → Actions → *Lucky Day snapshot and Pages deploy* → Run workflow)

- `mode: full` rebuilds the whole history.
- `force_deploy: true` rebuilds and redeploys even if the data is unchanged.

---

## Local storage (IndexedDB)

- Database `uae-lottery`:
  - store `draws`, keyed by the draw number (a **string**, e.g. `"260926"`);
  - store `meta`, with dataset info: counts, oldest/newest draw, last checked/changed, snapshot time,
    last mode/range, `dataRevision`, last export.
- Upsert rules: a missing draw is **added**; a draw whose source fields differ is **updated**; an
  identical draw is **unchanged**. Local bookkeeping (`firstSeenAt`, `updatedAt`) is ignored when
  comparing. `dataRevision` increases only when something was added or changed.
- **Cleared automatically:** stored results are deleted when the page is opened (so a reload starts
  empty) and, best-effort, when it is closed. Nothing is kept between visits.
- **Clear local data** in the app empties it immediately.
- Data is never sent anywhere. It exists only in this browser tab's session.

## The spreadsheet

Every sheet is a single rectangular table: one header row, no merged cells and **no formulas**, so it
reads cleanly into Excel, pandas (`pd.read_excel(path, sheet_name=None)`), R or Power Query.

| Sheet | Contents |
|---|---|
| Results | One row per draw: Draw No (text), Draw Seq (1 = oldest), date parts, weekday, N1–N6, Lucky Month, winners and nominal prize per tier, Total Winners, Total Paid AED, Lucky Chance IDs, Rules Version |
| Draw Features | Sum, mean, min/max/range, odd/even, low/high, band counts, consecutive pairs, max gap, repeats from the previous draw, draw-day and draw-month matches |
| Numbers Long | One row per drawn number (tidy format) with Ball Type Day/Month and sorted position |
| Number Matrix | One-hot D1–D31 and M1–M12 per draw, for clustering and correlation |
| Day Number Stats / Month Stats | Frequency, expected count, deviation, z-score, per-weekday and per-rules-version counts, last seen, gaps |
| Pair Frequency | 31×31 co-occurrence counts (the diagonal holds single counts) |
| Lucky Chance | One row per winning Lucky Chance ID |
| Data Dictionary | Every column explained, with caveats |
| Metadata (hidden) | Dataset ID, generation time, draw range, source |

**Analysis caveats:**
- The API publishes the six numbers **sorted**, not in ball-draw order. Treat N1–N6 as order
  statistics.
- *Prize AED* is the **nominal** per-winner amount (the jackpot shows 30M even with 0 winners). Use
  *Total Paid AED* for money actually paid.
- The game changed over time, so use **Rules Version** when comparing periods:

  | Rules version | Schedule | Draw time | Lucky Chance IDs |
  |---|---|---|---|
  | 1.0.0 | fortnightly Saturday | 20:30 | 7 × AED 100k |
  | 1.0.1 | weekly Saturday | 20:30 | 3 × AED 100k |
  | 1.0.2 | Wednesday + Saturday | 21:30 | 3 × AED 50k |

  The number game itself (6 from 1–31 plus a month from 1–12) is the same in every version.
- All dates are UAE time (UTC+4). Excel date cells hold the UAE wall-clock date, so they don't shift
  when opened in another timezone.

---

## Development

Requires Node 22.18+. The TypeScript scripts run directly with Node's built-in type stripping.

```bash
npm install
npm run dev              # http://localhost:5173 (tick "Dev: use live API" to call the API through the Vite proxy)
npm test                 # Vitest: parsing, paging, reconciliation, IndexedDB, features, XLSX round-trip
npm run snapshot         # latest-10 reconciliation into public/data/luckyday.json
npm run snapshot:full    # full history rebuild
npm run verify:reference # web workbook must match reference/uae_lottery_luckyday_results.xlsx cell for cell
npm run build            # static site in dist/
npm run preview          # serve dist/ locally
```

### Reference implementation

`reference/luckyday_scraper.py` is the original, verified Python scraper, and
`reference/uae_lottery_luckyday_results.xlsx` is its output. The TypeScript port is checked against
it: `npm run verify:reference` compares every sheet except Metadata cell for cell.

```bash
pip install requests openpyxl
python reference/luckyday_scraper.py                       # fetch the full history and write the xlsx
python reference/luckyday_scraper.py --from-raw raw.json   # rebuild from a saved raw API dump
```
