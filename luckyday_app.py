"""
UAE Lottery Lucky Day Results: a small desktop window that downloads the
official draw results and saves them as an analysis-ready Excel workbook.

The look follows the colours of the official results page (gold number balls,
red Lucky Month ball, gold pill buttons). It is an unofficial tool.

Run:  python luckyday_app.py   (or double-click "Lucky Day Results.bat")
"""

import os
import queue
import subprocess
import sys
import threading
import tkinter as tk
import tkinter.font as tkfont
from datetime import date
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

from luckyday_scraper import build_workbook, load_draws

APP_TITLE = "Lucky Day Results"
DEFAULT_NAME = "uae_lottery_luckyday_results.xlsx"
DATE_HINT = "YYYY-MM-DD"

# Palette taken from the Lucky Day results page on theuaelottery.ae
BG = "#f5f5f7"
SURFACE = "#ffffff"
TEXT = "#333333"
MUTED = "#666666"
GOLD = "#d7a84d"
GOLD_HOVER = "#c6963b"
GOLD_DARK = "#b98630"
GOLD_LIGHT = "#eeca7d"
GOLD_TEXT = "#cc7200"
CREAM = "#fef0d5"
CREAM_TEXT = "#b27730"
RED = "#bc1a2f"
BORDER = "#e6e6e6"

SCALE = 1.0  # display scaling (1.0 = 96 dpi), set when the window is created


def px(n):
    """Scale a pixel size for the current display."""
    return int(round(n * SCALE))


def parse_date(text, label):
    text = text.strip()
    if not text or text == DATE_HINT:
        return None
    try:
        return date.fromisoformat(text)
    except ValueError:
        raise ValueError(f"{label} date must look like 2025-06-01")


def pick_font():
    families = set(tkfont.families())
    for f in ("Roboto Flex", "Segoe UI", "Helvetica Neue", "Arial"):
        if f in families:
            return f
    return "TkDefaultFont"


class Pill(tk.Canvas):
    """Rounded pill button drawn on a canvas (Tk buttons can't be rounded).

    style "solid": gold fill, white text.  style "outline": white fill, gold border.
    """

    def __init__(self, parent, text, command, style="solid", font=None, padx=22, height=38, bg=SURFACE):
        self._font = font
        padx, height = px(padx), px(height)
        width = tkfont.Font(font=font).measure(text) + padx * 2
        super().__init__(parent, width=width, height=height, bg=bg, highlightthickness=0, cursor="hand2")
        self.text, self.command, self.style = text, command, style
        self.enabled, self.hover = True, False
        self.bind("<Enter>", lambda _: self._set_hover(True))
        self.bind("<Leave>", lambda _: self._set_hover(False))
        self.bind("<Button-1>", lambda _: self.enabled and self.command())
        self._draw()

    def _set_hover(self, value):
        self.hover = value
        self._draw()

    def set_style(self, style):
        self.style = style
        self._draw()

    def set_enabled(self, enabled):
        self.enabled = enabled
        self.configure(cursor="hand2" if enabled else "arrow")
        self._draw()

    def _draw(self):
        self.delete("all")
        w, h = int(self["width"]), int(self["height"])
        r = h / 2
        if self.style == "solid":
            fill = GOLD_HOVER if self.hover and self.enabled else GOLD
            outline, fg = fill, "#ffffff"
        else:
            fill = CREAM if self.hover and self.enabled else SURFACE
            outline, fg = GOLD_LIGHT, TEXT
        if not self.enabled:
            fill = "#e8dcc2" if self.style == "solid" else SURFACE
            outline = fill if self.style == "solid" else BORDER
            fg = "#ffffff" if self.style == "solid" else "#aaaaaa"
        # rounded rectangle = two circles + a rectangle
        self.create_oval(1, 1, h - 1, h - 1, fill=fill, outline=outline)
        self.create_oval(w - h + 1, 1, w - 1, h - 1, fill=fill, outline=outline)
        self.create_rectangle(r, 1, w - r, h - 1, fill=fill, outline="")
        self.create_line(r, 1, w - r, 1, fill=outline)
        self.create_line(r, h - 1, w - r, h - 1, fill=outline)
        self.create_text(w / 2, h / 2, text=self.text, fill=fg, font=self._font)


def enable_sharp_rendering():
    """Tell Windows the app handles display scaling, so text and shapes aren't blurry."""
    if sys.platform == "win32":
        try:
            import ctypes
            ctypes.windll.shcore.SetProcessDpiAwareness(1)
        except Exception:
            pass


class App(tk.Tk):
    def __init__(self):
        global SCALE
        enable_sharp_rendering()
        super().__init__()
        SCALE = max(1.0, self.winfo_fpixels("1i") / 96)
        self.title(f"{APP_TITLE} (unofficial)")
        self.configure(bg=BG)
        self.resizable(False, False)
        self.events = queue.Queue()  # messages from the worker thread
        self.saved_path = None
        family = pick_font()
        self.f_body = (family, 10)
        self.f_small = (family, 9)
        self.f_bold = (family, 10, "bold")
        self.f_title = (family, 17, "bold")
        self.f_brand = (family, 12, "bold")
        self.f_ball = (family, 13, "bold")
        self._styles()
        self._build()
        self.after(100, self._poll)

    # UI ---------------------------------------------------------------
    def _styles(self):
        s = ttk.Style(self)
        s.theme_use("clam")
        s.configure("Gold.Horizontal.TProgressbar", troughcolor=CREAM, background=GOLD,
                    bordercolor=CREAM, lightcolor=GOLD, darkcolor=GOLD, thickness=6)
        s.configure("Date.TEntry", fieldbackground=SURFACE, foreground=TEXT, bordercolor="#d9d9d9",
                    lightcolor="#d9d9d9", darkcolor="#d9d9d9", padding=6)
        s.map("Date.TEntry", bordercolor=[("focus", GOLD)], lightcolor=[("focus", GOLD)],
              fieldbackground=[("disabled", "#f2f2f2")], foreground=[("disabled", "#aaaaaa")])

    def _card(self, parent, **grid):
        card = tk.Frame(parent, bg=SURFACE, highlightbackground=BORDER, highlightthickness=1, padx=px(18), pady=px(14))
        card.grid(sticky="ew", padx=px(20), **grid)
        return card

    def _build(self):
        # Top bar
        top = tk.Frame(self, bg=SURFACE, padx=px(20), pady=px(10))
        top.grid(row=0, column=0, sticky="ew")
        mark = tk.Canvas(top, width=px(24), height=px(24), bg=SURFACE, highlightthickness=0)
        mark.create_oval(1, 1, px(24) - 1, px(24) - 1, fill=GOLD, outline=GOLD_DARK)
        mark.grid(row=0, column=0)
        tk.Label(top, text=APP_TITLE, font=self.f_brand, bg=SURFACE, fg=TEXT).grid(row=0, column=1, padx=(8, 10))
        tk.Label(top, text=" UNOFFICIAL TOOL ", font=(self.f_small[0], 8, "bold"), bg=CREAM,
                 fg=CREAM_TEXT).grid(row=0, column=2)
        tk.Frame(self, bg=BORDER, height=1).grid(row=1, column=0, sticky="ew")

        # Gold banner
        hero = tk.Frame(self, bg=GOLD_DARK, padx=px(20), pady=px(16))
        hero.grid(row=2, column=0, sticky="ew", padx=px(20), pady=(px(16), px(12)))
        tk.Label(hero, text="Lucky Day Draw Results", font=self.f_title, bg=GOLD_DARK, fg="#ffffff").grid(sticky="w")
        tk.Label(hero, text="Download the official draw results into a spreadsheet for data analysis.",
                 font=self.f_body, bg=GOLD_DARK, fg="#fff6e3").grid(sticky="w", pady=(2, 0))

        # Options card
        card = self._card(self, row=3, column=0)
        tk.Label(card, text="Draws to download", font=self.f_bold, bg=SURFACE, fg=MUTED).grid(
            row=0, column=0, columnspan=4, sticky="w")
        modes = tk.Frame(card, bg=SURFACE)
        modes.grid(row=1, column=0, columnspan=4, sticky="w", pady=(8, 10))
        self.mode = "all"
        self.mode_all = Pill(modes, "All results", lambda: self._set_mode("all"), font=self.f_body, height=34, padx=18)
        self.mode_range = Pill(modes, "Date range", lambda: self._set_mode("range"), style="outline",
                               font=self.f_body, height=34, padx=18)
        self.mode_all.grid(row=0, column=0, padx=(0, 8))
        self.mode_range.grid(row=0, column=1)

        self.dates = tk.Frame(card, bg=SURFACE)
        self.dates.grid(row=2, column=0, columnspan=4, sticky="w")
        tk.Label(self.dates, text="From", font=self.f_body, bg=SURFACE, fg=TEXT).grid(row=0, column=0, padx=(0, 6))
        self.from_entry = self._date_entry(self.dates)
        self.from_entry.grid(row=0, column=1)
        tk.Label(self.dates, text="To", font=self.f_body, bg=SURFACE, fg=TEXT).grid(row=0, column=2, padx=(14, 6))
        self.to_entry = self._date_entry(self.dates)
        self.to_entry.grid(row=0, column=3)
        self.dates_hint = tk.Label(card, text="Leave To empty for 'up to the latest draw'. Dates are UAE dates.",
                                   font=self.f_small, bg=SURFACE, fg=MUTED)
        self.dates_hint.grid(row=3, column=0, columnspan=4, sticky="w", pady=(4, 0))

        self.button = Pill(card, "Download results…", self._start, font=self.f_bold, height=40, padx=28)
        self.button.grid(row=4, column=0, columnspan=4, sticky="w", pady=(14, 10))
        self.progress = ttk.Progressbar(card, mode="indeterminate", length=px(440), style="Gold.Horizontal.TProgressbar")
        self.progress.grid(row=5, column=0, columnspan=4, sticky="ew")
        self.progress.grid_remove()
        self.status = tk.StringVar(value="Ready.")
        tk.Label(card, textvariable=self.status, font=self.f_body, bg=SURFACE, fg=TEXT, wraplength=px(440),
                 justify="left").grid(row=6, column=0, columnspan=4, sticky="w", pady=(8, 0))
        self._set_mode("all")

        # Result card: latest draw as balls + open buttons (shown after a download)
        self.result = self._card(self, row=4, column=0, pady=(12, 0))
        self.result_title = tk.Label(self.result, font=(self.f_bold[0], 12, "bold"), bg=SURFACE, fg=TEXT)
        self.result_title.grid(row=0, column=0, sticky="w")
        self.result_sub = tk.Label(self.result, font=self.f_small, bg=SURFACE, fg=MUTED)
        self.result_sub.grid(row=1, column=0, sticky="w")
        self.balls = tk.Canvas(self.result, height=px(46), width=px(440), bg=SURFACE, highlightthickness=0)
        self.balls.grid(row=2, column=0, sticky="w", pady=(10, 12))
        links = tk.Frame(self.result, bg=SURFACE)
        links.grid(row=3, column=0, sticky="w")
        Pill(links, "Open spreadsheet", lambda: self._open(self.saved_path), style="outline",
             font=self.f_body, height=34, padx=16).grid(row=0, column=0, padx=(0, 8))
        Pill(links, "Open folder", lambda: self._open(self.saved_path.parent), style="outline",
             font=self.f_body, height=34, padx=16).grid(row=0, column=1)
        self.result.grid_remove()

        tk.Label(self, text="Unofficial tool. Not affiliated with, or endorsed by, The UAE Lottery.",
                 font=self.f_small, bg=BG, fg="#888888").grid(row=5, column=0, sticky="w", padx=px(20), pady=(px(12), px(14)))

    def _date_entry(self, parent):
        e = ttk.Entry(parent, width=12, style="Date.TEntry", font=self.f_body)
        e.insert(0, DATE_HINT)

        def focus_in(_):
            if e.get() == DATE_HINT:
                e.delete(0, "end")

        def focus_out(_):
            if not e.get().strip():
                e.insert(0, DATE_HINT)

        e.bind("<FocusIn>", focus_in)
        e.bind("<FocusOut>", focus_out)
        return e

    def _set_mode(self, mode):
        self.mode = mode
        self.mode_all.set_style("solid" if mode == "all" else "outline")
        self.mode_range.set_style("solid" if mode == "range" else "outline")
        state = "normal" if mode == "range" else "disabled"
        self.from_entry.configure(state=state)
        self.to_entry.configure(state=state)
        self.dates_hint.configure(fg=MUTED if mode == "range" else "#bbbbbb")

    def _draw_balls(self, draw):
        c = self.balls
        c.delete("all")
        x, d, y = px(2), px(42), px(2)
        for n in draw["numbers"]:
            c.create_oval(x, y, x + d, y + d, fill=GOLD, outline=GOLD)
            c.create_text(x + d / 2, y + d / 2, text=str(n), fill="#ffffff", font=self.f_ball)
            x += d + px(8)
        if draw["month"] is not None:
            x += px(6)
            c.create_oval(x, y, x + d, y + d, fill=RED, outline=RED)
            c.create_text(x + d / 2, y + d / 2, text=str(draw["month"]), fill="#ffffff", font=self.f_ball)

    # Actions ------------------------------------------------------------
    def _start(self):
        try:
            start = end = None
            if self.mode == "range":
                start = parse_date(self.from_entry.get(), "From")
                end = parse_date(self.to_entry.get(), "To")
                if not start:
                    raise ValueError("Enter a From date, or choose 'All results'.")
                if end and end < start:
                    raise ValueError("The From date must be on or before the To date.")
        except ValueError as e:
            messagebox.showwarning(APP_TITLE, str(e), parent=self)
            return

        downloads = Path.home() / "Downloads"
        path = filedialog.asksaveasfilename(
            parent=self, title="Save spreadsheet as", defaultextension=".xlsx", initialfile=DEFAULT_NAME,
            initialdir=downloads if downloads.is_dir() else Path.home(),
            filetypes=[("Excel workbook", "*.xlsx")])
        if not path:
            return

        self.result.grid_remove()
        self.button.set_enabled(False)
        self.progress.grid()
        self.progress.start(12)
        self.status.set("Contacting theuaelottery.ae…")
        threading.Thread(target=self._work, args=(start, end, Path(path)), daemon=True).start()

    def _work(self, start, end, path):
        """Runs in a background thread; talks to the UI only through self.events."""
        try:
            draws = load_draws(start, end, on_progress=lambda m: self.events.put(("status", m)))
            if not draws:
                self.events.put(("empty", None))
                return
            self.events.put(("status", "Building spreadsheet…"))
            build_workbook(draws, path)
            self.events.put(("done", (path, draws)))
        except PermissionError:
            self.events.put(("error", f"Could not save {path.name}. Is it open in Excel? Close it and try again."))
        except Exception as e:  # network errors, site changes, etc.
            self.events.put(("error", f"Download failed: {e}"))

    def _poll(self):
        try:
            while True:
                kind, payload = self.events.get_nowait()
                if kind == "status":
                    self.status.set(payload)
                    continue
                self.progress.stop()
                self.progress.grid_remove()
                self.button.set_enabled(True)
                if kind == "done":
                    path, draws = payload
                    newest = max(draws, key=lambda p: p["when"])
                    dates = sorted(p["when"].date() for p in draws)
                    self.saved_path = path
                    self.status.set(f"Saved {len(draws)} draws ({dates[0]:%d %b %Y} to {dates[-1]:%d %b %Y}) "
                                    f"to {path}")
                    self.result_title.configure(text=f"Draw No.: {newest['draw_no']}")
                    self.result_sub.configure(text=f"Latest in your file · {newest['when']:%A %H:%M, %d/%m/%Y}")
                    self._draw_balls(newest)
                    self.result.grid()
                elif kind == "empty":
                    self.status.set("No draws found in that date range. Nothing was saved.")
                else:
                    self.status.set("Failed.")
                    messagebox.showerror(APP_TITLE, payload, parent=self)
        except queue.Empty:
            pass
        self.after(100, self._poll)

    def _open(self, target):
        if not target:
            return
        if sys.platform == "win32":
            os.startfile(target)
        elif sys.platform == "darwin":
            subprocess.run(["open", str(target)])
        else:
            subprocess.run(["xdg-open", str(target)])


if __name__ == "__main__":
    App().mainloop()
