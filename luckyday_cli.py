"""
Command line for the UAE Lottery Lucky Day results tool, designed to be called
by scripts, other apps and AI agents.

    python luckyday_cli.py latest                        newest draw as JSON
    python luckyday_cli.py draws --from 2025-01-01       draws as JSON (or --format csv/text)
    python luckyday_cli.py stats --last 50               number/month frequency stats
    python luckyday_cli.py export results.xlsx           analysis-ready spreadsheet

Contract:
  - stdout carries only the result (JSON by default, schema_version 1)
  - progress goes to stderr, and only with -v
  - never prompts
  - exit codes: 0 ok, 1 network/site/file error, 2 bad usage, 3 no draws matched
  - with --format json, errors are one JSON line on stderr:
    {"error": "...", "exit_code": N}
"""

import argparse
import csv
import io
import json
import os
import subprocess
import sys
from datetime import date, datetime, timezone
from pathlib import Path

__version__ = "1.0.0"
SCHEMA_VERSION = 1
SOURCE = "https://www.theuaelottery.ae/lottery/luckyday/results"
DEFAULT_XLSX = "uae_lottery_luckyday_results.xlsx"
COMMANDS = ("latest", "draws", "stats", "export")

EXIT_OK, EXIT_ERROR, EXIT_USAGE, EXIT_EMPTY = 0, 1, 2, 3


class CliError(Exception):
    def __init__(self, message, exit_code=EXIT_ERROR):
        super().__init__(message)
        self.exit_code = exit_code


# --------------------------------------------------------------------------
# Argument parsing
# --------------------------------------------------------------------------

def iso_date(text):
    try:
        return date.fromisoformat(text)
    except ValueError:
        raise argparse.ArgumentTypeError(f"invalid date {text!r}; use YYYY-MM-DD")


def positive_int(text):
    try:
        n = int(text)
    except ValueError:
        n = 0
    if n < 1:
        raise argparse.ArgumentTypeError(f"must be a positive whole number, got {text!r}")
    return n


def build_parser():
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("-v", "--verbose", action="store_true", help="print progress to stderr")
    common.add_argument("--from-raw", metavar="FILE", type=Path,
                        help="use a saved raw API dump instead of fetching (offline)")
    common.add_argument("--save-raw", metavar="FILE", type=Path, help="also save the raw API data to FILE")

    selection = argparse.ArgumentParser(add_help=False)
    selection.add_argument("--from", dest="start", metavar="YYYY-MM-DD", type=iso_date,
                           help="first draw date to include (UAE date, inclusive)")
    selection.add_argument("--to", dest="end", metavar="YYYY-MM-DD", type=iso_date,
                           help="last draw date to include (UAE date, inclusive)")
    selection.add_argument("--last", metavar="N", type=positive_int,
                           help="only the newest N draws (after any date filter)")

    parser = argparse.ArgumentParser(
        prog="luckyday_cli.py",
        description="Official UAE Lottery Lucky Day draw results as JSON, CSV or an analysis-ready "
                    "spreadsheet. Unofficial tool. Output goes to stdout; progress (with -v) and errors "
                    "go to stderr. Exit codes: 0 ok, 1 network/site/file error, 2 bad usage, "
                    "3 no draws matched.",
    )
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    sub = parser.add_subparsers(dest="command", metavar="COMMAND", required=True)

    p = sub.add_parser("latest", parents=[common], help="the newest published draw",
                       description="Print the newest published draw (1 request).")
    p.add_argument("--format", choices=["json", "text"], default="json")

    p = sub.add_parser("draws", parents=[common, selection], help="draw results for a date range",
                       description="Print draw results, newest first. Numbers are sorted ascending "
                                   "(the site does not publish draw order).")
    p.add_argument("--format", choices=["json", "csv", "text"], default="json")
    p.add_argument("-o", "--output", metavar="FILE", type=Path, help="write to FILE instead of stdout")

    p = sub.add_parser("stats", parents=[common, selection], help="number and month frequency statistics",
                       description="Frequency, expected count, z-score and recency for each day number "
                                   "(1-31) and Lucky Month (1-12), over the selected draws.")
    p.add_argument("--format", choices=["json", "csv", "text"], default="json")
    p.add_argument("-o", "--output", metavar="FILE", type=Path, help="write to FILE instead of stdout")

    p = sub.add_parser("export", parents=[common, selection], help="write the analysis-ready .xlsx workbook",
                       description="Write the same analysis-ready workbook as the desktop window, then "
                                   "print a summary. Existing files are overwritten.")
    p.add_argument("output", nargs="?", default=DEFAULT_XLSX, type=Path,
                   help=f"workbook path (default: {DEFAULT_XLSX})")
    p.add_argument("--open", action="store_true", help="open the workbook when done")
    p.add_argument("--format", choices=["json", "text"], default="json", help="format of the summary")
    return parser


# --------------------------------------------------------------------------
# Data
# --------------------------------------------------------------------------

def get_draws(args, start=None, end=None, last=None):
    from luckyday_scraper import fetch_raw, load_draws

    progress = (lambda m: print(m, file=sys.stderr)) if args.verbose else None
    if args.from_raw:
        try:
            raw = json.loads(args.from_raw.read_text(encoding="utf-8"))
        except (OSError, ValueError) as e:
            raise CliError(f"could not read {args.from_raw}: {e}")
    else:
        raw = fetch_raw(start=start, end=end, last=last, on_progress=progress)
    if args.save_raw:
        write_text(args.save_raw, json.dumps(raw, ensure_ascii=False, indent=1))
    draws = load_draws(start=start, end=end, last=last, raw=raw)
    if not draws:
        raise CliError("no draws match the selection", EXIT_EMPTY)
    return draws


def envelope(args, selected, **extra):
    """Common JSON wrapper: provenance, the request, and the span of the data returned."""
    return {
        "schema_version": SCHEMA_VERSION,
        "source": SOURCE,
        "fetched_at": None if args.from_raw else datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "offline": bool(args.from_raw),
        "filters": {
            "from": getattr(args, "start", None) and args.start.isoformat(),
            "to": getattr(args, "end", None) and args.end.isoformat(),
            "last": getattr(args, "last", None),
        },
        "count": len(selected),
        "range": {"from": selected[-1]["when"].strftime("%Y-%m-%d"), "to": selected[0]["when"].strftime("%Y-%m-%d")},
        **extra,
    }


def csv_rows(draws):
    from luckyday_scraper import draw_to_dict

    tiers = ["jackpot", "second", "third", "fourth", "fifth", "lucky_chance"]
    header = ["draw_no", "date", "time_uae", "weekday", "n1", "n2", "n3", "n4", "n5", "n6", "lucky_month"]
    for t in tiers:
        header += [f"{t}_winners", f"{t}_prize_aed", f"{t}_paid_aed"]
    header += ["total_winners", "total_paid_aed", "lucky_chance_ids", "rules_version"]
    rows = []
    for p in draws:
        d = draw_to_dict(p)
        row = [d["draw_no"], d["date"], d["time_uae"], d["weekday"], *d["numbers"], d["lucky_month"]]
        for t in tiers:
            row += [d["tiers"][t]["winners"], d["tiers"][t]["prize_aed"], d["tiers"][t]["paid_aed"]]
        row += [d["total_winners"], d["total_paid_aed"], " ".join(d["lucky_chance_ids"]), d["rules_version"]]
        rows.append(row)
    return header, rows


def compute_stats(draws):
    """Day-number and Lucky Month stats, the same figures as the workbook's stats sheets."""
    from luckyday_scraper import DAY_MAX, MONTH_MAX, PICKS, number_stats

    chrono = sorted(draws, key=lambda p: (p["when"], p["draw_no"]))
    out = {}
    for name, universe, values_of, p_hit in [
        ("day_numbers", range(1, DAY_MAX + 1), lambda p: p["numbers"], PICKS / DAY_MAX),
        ("lucky_months", range(1, MONTH_MAX + 1), lambda p: [p["month"]] if p["month"] else [], 1 / MONTH_MAX),
    ]:
        items = []
        for value, row in number_stats(chrono, values_of, universe, p_hit):
            last_drawn = row.get("Last Drawn Date")
            items.append({
                "value": value,
                "times_drawn": row["Times Drawn"],
                "pct_of_draws": row["Pct Of Draws"],
                "expected": row["Expected"],
                "deviation": row["Deviation"],
                "z_score": row["Z Score"],
                "by_weekday": {k[:-len(" Count")]: v for k, v in row.items()
                               if k.endswith(" Count") and not k.startswith("Rules ")},
                "by_rules_version": {k[len("Rules "):-len(" Count")]: v for k, v in row.items()
                                     if k.startswith("Rules ") and k.endswith(" Count")},
                "last_drawn": last_drawn.isoformat() if last_drawn else None,
                "draws_since_last_seen": row["Draws Since Last Seen"],
                "longest_gap_draws": row["Longest Gap Draws"],
                "average_gap_draws": row["Average Gap Draws"],
            })
        out[name] = items
    return out


# --------------------------------------------------------------------------
# Output
# --------------------------------------------------------------------------

def write_text(path, text):
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8", newline="")
    except PermissionError:
        raise CliError(f"could not write {path}: permission denied (is it open in another program?)")
    except OSError as e:
        raise CliError(f"could not write {path}: {e}")


def emit(args, text):
    if getattr(args, "output", None) and args.command in ("draws", "stats"):
        write_text(args.output, text)
    else:
        sys.stdout.write(text)


def to_json(obj):
    return json.dumps(obj, ensure_ascii=False, indent=2) + "\n"


def to_csv(header, rows):
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(header)
    w.writerows(rows)
    return buf.getvalue()


def draw_line(p):
    nums = " ".join(f"{n:2d}" for n in p["numbers"])
    month = p["month"] if p["month"] is not None else "-"
    return f"{p['draw_no']}  {p['when']:%a %Y-%m-%d %H:%M}  {nums}  | {month:>2}"


def open_file(path):
    if sys.platform == "win32":
        os.startfile(path)
    elif sys.platform == "darwin":
        subprocess.run(["open", str(path)], check=False)
    else:
        subprocess.run(["xdg-open", str(path)], check=False)


# --------------------------------------------------------------------------
# Commands
# --------------------------------------------------------------------------

def cmd_latest(args):
    from luckyday_scraper import draw_to_dict

    draws = get_draws(args, last=1)
    if args.format == "text":
        emit(args, draw_line(draws[0]) + "\n")
    else:
        emit(args, to_json(envelope(args, draws, draws=[draw_to_dict(draws[0])])))


def cmd_draws(args):
    from luckyday_scraper import draw_to_dict

    draws = get_draws(args, args.start, args.end, args.last)
    if args.format == "csv":
        emit(args, to_csv(*csv_rows(draws)))
    elif args.format == "text":
        emit(args, "".join(draw_line(p) + "\n" for p in draws))
    else:
        emit(args, to_json(envelope(args, draws, draws=[draw_to_dict(p) for p in draws])))


def cmd_stats(args):
    draws = get_draws(args, args.start, args.end, args.last)
    stats = compute_stats(draws)
    if args.format == "json":
        emit(args, to_json(envelope(args, draws, **stats)))
        return
    weekdays = sorted({k for s in stats["day_numbers"] for k in s["by_weekday"]})
    if args.format == "csv":
        header = ["ball_type", "value", "times_drawn", "pct_of_draws", "expected", "deviation", "z_score",
                  *[f"{w.lower()}_count" for w in weekdays], "last_drawn", "draws_since_last_seen",
                  "longest_gap_draws", "average_gap_draws"]
        rows = []
        for ball_type, key in (("day", "day_numbers"), ("month", "lucky_months")):
            for s in stats[key]:
                rows.append([ball_type, s["value"], s["times_drawn"], s["pct_of_draws"], s["expected"],
                             s["deviation"], s["z_score"], *[s["by_weekday"].get(w, 0) for w in weekdays],
                             s["last_drawn"], s["draws_since_last_seen"], s["longest_gap_draws"],
                             s["average_gap_draws"]])
        emit(args, to_csv(header, rows))
        return
    lines = [f"{len(draws)} draws, {draws[-1]['when']:%Y-%m-%d} to {draws[0]['when']:%Y-%m-%d}", "",
             "Day numbers (most drawn first)", " num  drawn  expected  z-score  last seen"]
    for s in sorted(stats["day_numbers"], key=lambda s: (-s["times_drawn"], s["value"])):
        lines.append(f"  {s['value']:2d}  {s['times_drawn']:5d}  {s['expected']:8.2f}  {s['z_score']:7.2f}  "
                     f"{s['last_drawn'] or '-'}")
    lines += ["", "Lucky Month", " mon  drawn  expected  z-score  last seen"]
    for s in stats["lucky_months"]:
        lines.append(f"  {s['value']:2d}  {s['times_drawn']:5d}  {s['expected']:8.2f}  {s['z_score']:7.2f}  "
                     f"{s['last_drawn'] or '-'}")
    emit(args, "\n".join(lines) + "\n")


def cmd_export(args):
    from luckyday_scraper import build_workbook, draw_to_dict

    draws = get_draws(args, args.start, args.end, args.last)
    path = args.output if args.output.suffix.lower() == ".xlsx" else args.output.with_suffix(".xlsx")
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        build_workbook(draws, path)
    except PermissionError:
        raise CliError(f"could not save {path}: permission denied (is it open in Excel?)")
    except OSError as e:
        raise CliError(f"could not save {path}: {e}")
    path = path.resolve()
    if args.format == "text":
        sys.stdout.write(f"Saved {len(draws)} draws ({draws[-1]['when']:%Y-%m-%d} to "
                         f"{draws[0]['when']:%Y-%m-%d}) to {path}\nLatest: {draw_line(draws[0])}\n")
    else:
        sys.stdout.write(to_json(envelope(args, draws, saved=str(path), latest=draw_to_dict(draws[0]))))
    if args.open:
        open_file(path)


# --------------------------------------------------------------------------
# Entry point
# --------------------------------------------------------------------------

def main(argv=None, legacy=False):
    """Run the CLI and return an exit code. legacy=True accepts the old
    `luckyday_scraper.py [--from-raw FILE] [output.xlsx]` form."""
    argv = list(sys.argv[1:] if argv is None else argv)
    if legacy and (not argv or argv[0] not in COMMANDS + ("-h", "--help", "--version")):
        argv.insert(0, "export")
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except (AttributeError, ValueError):
            pass

    parser = build_parser()
    try:
        args = parser.parse_args(argv)
    except SystemExit as e:  # argparse exits 0 for --help/--version, 2 for usage errors
        return e.code if isinstance(e.code, int) else EXIT_USAGE

    if getattr(args, "start", None) and getattr(args, "end", None) and args.end < args.start:
        return fail(args, "--to must be on or after --from", EXIT_USAGE)
    try:
        {"latest": cmd_latest, "draws": cmd_draws, "stats": cmd_stats, "export": cmd_export}[args.command](args)
        return EXIT_OK
    except CliError as e:
        return fail(args, str(e), e.exit_code)
    except KeyboardInterrupt:
        return fail(args, "interrupted", EXIT_ERROR)
    except Exception as e:  # network errors, unexpected site changes
        return fail(args, f"{type(e).__name__}: {e}", EXIT_ERROR)


def fail(args, message, code):
    if getattr(args, "format", None) == "json":
        print(json.dumps({"error": message, "exit_code": code}), file=sys.stderr)
    else:
        print(f"error: {message}", file=sys.stderr)
    return code


if __name__ == "__main__":
    sys.exit(main())
