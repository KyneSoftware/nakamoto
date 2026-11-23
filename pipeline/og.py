"""Social card (1200x630 og.png) from the exported history: the operator Nakamoto falling into the danger zone.

  python -I pipeline/og.py site/public/data/history.json site/public/og.png
"""
import json
import sys
from datetime import date, timedelta

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.dates import YearLocator, DateFormatter  # noqa: E402

DANGER = 10
START = "2021-06-01"
BG, INK, INK2, MUTED, LINE = "#0f1115", "#eef0f3", "#b6bcc6", "#7c8390", "#262a33"
ACCENT, ACCENT_SOFT, BLUE = "#ff6a52", "#3a1d18", "#6aa0ff"


def month(d: str) -> str:
    return date.fromisoformat(d).strftime("%b %Y")


def main(src: str, out: str) -> None:
    h = json.load(open(src))
    idx = [i for i, d in enumerate(h["date"]) if d >= START]
    ds = [date.fromisoformat(h["date"][i]) for i in idx]
    low = [h["op_n50_low"][i] for i in idx]
    lo = [min(h[f"op_n50_{s}"][i] for s in ("low", "cons", "high")) for i in idx]
    hi = [max(h[f"op_n50_{s}"][i] for s in ("low", "cons", "high")) for i in idx]
    now = low[-1]
    tail = ds[-1] + timedelta(days=28)             # hold the last frame for one step, as the site's chart does
    peak = max(range(len(idx)), key=lambda k: (low[k], -k))
    below = len(low)                      # first frame of the current run below the danger line
    while below > 0 and low[below - 1] < DANGER:
        below -= 1

    fig = plt.figure(figsize=(12, 6.3), dpi=100, facecolor=BG)
    fig.text(0.05, 0.9, "nakamoto.kyne.eu", color=MUTED, fontsize=17, fontweight="bold")
    fig.text(0.05, 0.75, f"{now} operators", color=ACCENT, fontsize=50, fontweight="bold")
    fig.text(0.05, 0.645, "run half of all staked ETH", color=INK, fontsize=36, fontweight="bold")
    sub = f"Down from {low[peak]} in {month(h['date'][idx[peak]])}"
    if below < len(low):
        sub += f"; below the danger line of {DANGER} since {month(h['date'][idx[below]])}"
    fig.text(0.05, 0.575, sub + ".", color=INK2, fontsize=17)

    ax = fig.add_axes((0.05, 0.08, 0.9, 0.44), facecolor=BG)
    ax.axhspan(0, DANGER, color=ACCENT_SOFT, zorder=0)
    ax.axhline(DANGER, color=ACCENT, lw=1.2, ls=(0, (4, 3)), zorder=1)
    ax.text(ds[0] + timedelta(days=20), 1.2, f"danger zone: fewer than {DANGER} firms run half",
            color=ACCENT, fontsize=14, va="bottom", zorder=3)
    ds, lo, hi, low = ds + [tail], lo + lo[-1:], hi + hi[-1:], low + low[-1:]
    ax.fill_between(ds, lo, hi, step="post", color=BLUE, alpha=0.22, lw=0, zorder=2)
    ax.step(ds, low, where="post", color=INK, lw=2.6, zorder=4)
    ax.plot([ds[-1]], [now], "o", ms=10, color=ACCENT, mec=BG, mew=2.5, zorder=5)
    ax.annotate(str(now), (ds[-1], now), xytext=(12, -4), textcoords="offset points",
                color=ACCENT, fontsize=20, fontweight="bold", va="center")
    ax.set_ylim(0, 22)
    ax.set_xlim(ds[0], ds[-1])
    ax.set_yticks([0, 10, 20])
    ax.xaxis.set_major_locator(YearLocator())
    ax.xaxis.set_major_formatter(DateFormatter("%Y"))
    ax.tick_params(colors=MUTED, labelsize=12, length=0)
    for s in ax.spines.values():
        s.set_visible(False)
    ax.grid(axis="y", color=LINE, lw=1)
    ax.set_axisbelow(True)
    fig.text(0.95, 0.9, "operators that together run >50% of stake", color=MUTED, fontsize=13, ha="right")
    fig.savefig(out, facecolor=BG)


if __name__ == "__main__":
    main(*sys.argv[1:3])
