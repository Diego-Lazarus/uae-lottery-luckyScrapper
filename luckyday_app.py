"""
UAE Lottery Lucky Day Results: a small desktop window that downloads the
official draw results and saves them as an analysis-ready Excel workbook.

Run:  python luckyday_app.py   (or double-click "Lucky Day Results.bat")
"""

import os
import queue
import subprocess
import sys
import threading
import tkinter as tk
from datetime import date
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

from luckyday_scraper import build_workbook, fetch_all_draws, parse_draw

APP_TITLE = "UAE Lottery Lucky Day Results"
DEFAULT_NAME = "uae_lottery_luckyday_results.xlsx"
DATE_HINT = "YYYY-MM-DD"


def parse_date(text, label):
    text = text.strip()
    if not text or text == DATE_HINT:
        return None
    try:
        return date.fromisoformat(text)
    except ValueError:
        raise ValueError(f"{label} date must look like 2025-06-01")


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title(APP_TITLE)
        self.resizable(False, False)
        self.events = queue.Queue()  # messages from the worker thread
        self.saved_path = None
        self._build()
        self.after(100, self._poll)

    # UI ---------------------------------------------------------------
    def _build(self):
        pad = {"padx": 16}
        root = ttk.Frame(self, padding=(0, 16, 0, 16))
        root.grid()

        ttk.Label(root, text=APP_TITLE, font=("Segoe UI", 14, "bold")).grid(row=0, column=0, sticky="w", **pad)
        ttk.Label(root, text="Downloads the official draw results into a spreadsheet for analysis.",
                  foreground="#555").grid(row=1, column=0, sticky="w", pady=(2, 12), **pad)

        box = ttk.LabelFrame(root, text="Draws", padding=12)
        box.grid(row=2, column=0, sticky="ew", **pad)
        self.mode = tk.StringVar(value="all")
        ttk.Radiobutton(box, text="All results", value="all", variable=self.mode,
                        command=self._toggle_dates).grid(row=0, column=0, columnspan=4, sticky="w")
        ttk.Radiobutton(box, text="Date range", value="range", variable=self.mode,
                        command=self._toggle_dates).grid(row=1, column=0, columnspan=4, sticky="w", pady=(4, 6))
        ttk.Label(box, text="From").grid(row=2, column=0, sticky="w", padx=(22, 6))
        self.from_entry = self._date_entry(box)
        self.from_entry.grid(row=2, column=1)
        ttk.Label(box, text="To").grid(row=2, column=2, sticky="w", padx=(14, 6))
        self.to_entry = self._date_entry(box)
        self.to_entry.grid(row=2, column=3)
        ttk.Label(box, text="Leave To empty for 'up to the latest draw'. Dates are UAE dates.",
                  foreground="#666").grid(row=3, column=0, columnspan=4, sticky="w", padx=(22, 0), pady=(4, 0))
        self._toggle_dates()

        self.button = ttk.Button(root, text="Download results…", command=self._start)
        self.button.grid(row=3, column=0, sticky="w", pady=(14, 8), **pad)

        self.progress = ttk.Progressbar(root, mode="indeterminate", length=380)
        self.progress.grid(row=4, column=0, sticky="ew", **pad)
        self.status = tk.StringVar(value="Ready.")
        ttk.Label(root, textvariable=self.status, wraplength=380).grid(row=5, column=0, sticky="w", pady=(6, 0), **pad)

        links = ttk.Frame(root)
        links.grid(row=6, column=0, sticky="w", pady=(8, 0), **pad)
        self.open_file = ttk.Button(links, text="Open spreadsheet", command=lambda: self._open(self.saved_path))
        self.open_folder = ttk.Button(links, text="Open folder", command=lambda: self._open(self.saved_path.parent))
        self.open_file.grid(row=0, column=0, padx=(0, 8))
        self.open_folder.grid(row=0, column=1)
        links.grid_remove()
        self.links = links

    def _date_entry(self, parent):
        e = ttk.Entry(parent, width=12)
        e.insert(0, DATE_HINT)
        e.configure(foreground="#999")

        def focus_in(_):
            if e.get() == DATE_HINT:
                e.delete(0, "end")
                e.configure(foreground="")

        def focus_out(_):
            if not e.get().strip():
                e.insert(0, DATE_HINT)
                e.configure(foreground="#999")

        e.bind("<FocusIn>", focus_in)
        e.bind("<FocusOut>", focus_out)
        return e

    def _toggle_dates(self):
        state = "normal" if self.mode.get() == "range" else "disabled"
        self.from_entry.configure(state=state)
        self.to_entry.configure(state=state)

    # Actions ------------------------------------------------------------
    def _start(self):
        try:
            start = end = None
            if self.mode.get() == "range":
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

        self.links.grid_remove()
        self.button.configure(state="disabled")
        self.progress.start(12)
        self.status.set("Contacting theuaelottery.ae…")
        threading.Thread(target=self._work, args=(start, end, Path(path)), daemon=True).start()

    def _work(self, start, end, path):
        """Runs in a background thread; talks to the UI only through self.events."""
        try:
            raw = fetch_all_draws(on_progress=lambda m: self.events.put(("status", m)), stop_before=start)
            self.events.put(("status", "Building spreadsheet…"))
            draws = [parse_draw(d) for d in raw]
            if start:
                draws = [p for p in draws if p["when"].date() >= start and (not end or p["when"].date() <= end)]
            if not draws:
                self.events.put(("empty", None))
                return
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
                self.button.configure(state="normal")
                if kind == "done":
                    path, draws = payload
                    dates = sorted(p["when"].date() for p in draws)
                    self.saved_path = path
                    self.status.set(f"Saved {len(draws)} draws ({dates[0]:%d %b %Y} to {dates[-1]:%d %b %Y}) "
                                    f"to {path}")
                    self.links.grid()
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
