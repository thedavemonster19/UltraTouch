"""Switch on the shared leaderboard.

Usage:
  python3 tools/setup_leaderboard.py "<Google Form pre-filled link>" "<Google Sheet link>"

Make the pre-filled link with these exact answers: Game = GAME, Name = NAME, Score = 123, Detail = DETAIL.
The script reads the form id and each question's entry id from it and writes js/leaderboard-config.js.
"""
import re
import sys
from pathlib import Path
from urllib.parse import parse_qsl, urlparse

ROOT = Path(__file__).resolve().parent.parent
WANT = {"GAME": "game", "NAME": "name", "123": "score", "DETAIL": "detail"}


def main(prefilled: str, sheet: str) -> None:
    m = re.search(r"/forms/d/e/([A-Za-z0-9_-]+)/", prefilled)
    if not m:
        sys.exit("That doesn't look like a Google Form pre-filled link (expected .../forms/d/e/<id>/viewform?...).")
    entries = {}
    for k, v in parse_qsl(urlparse(prefilled).query):
        if k.startswith("entry.") and v.strip().upper() in WANT:
            entries[WANT[v.strip().upper()]] = k
    missing = [w for w in ("game", "name", "score") if w not in entries]
    if missing:
        sys.exit("Couldn't find the " + ", ".join(missing) + " question(s). Fill the pre-filled link with GAME / NAME / 123 / DETAIL.")
    s = re.search(r"/spreadsheets/d/([A-Za-z0-9_-]+)", sheet)
    if not s:
        sys.exit("That doesn't look like a Google Sheet link (expected .../spreadsheets/d/<id>/...).")
    cfg = (
        "/* Shared leaderboard settings, written by tools/setup_leaderboard.py. */\n"
        "window.UT_LEADERBOARD = {\n"
        f"  formAction: 'https://docs.google.com/forms/d/e/{m.group(1)}/formResponse',\n"
        f"  entries: {{ game: '{entries['game']}', name: '{entries['name']}', score: '{entries['score']}', detail: '{entries.get('detail', '')}' }},\n"
        f"  sheetId: '{s.group(1)}',\n"
        "};\n"
    )
    (ROOT / "js" / "leaderboard-config.js").write_text(cfg, encoding="utf-8")
    print(cfg)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
