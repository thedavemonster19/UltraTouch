"""Bundle UltraTouch into one self-contained HTML file (dist/ultratouch.html).

Inlines css/ and js/, drops the PWA links and the service worker (sandboxed hosts such as a
claude.ai Artifact can't use them). With --fragment the <!doctype>/<html>/<head>/<body> wrapper is
removed too, which is the form the Artifact publisher expects.
"""
import hashlib
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


ASSETS = ["css/style.css", "js/core.js", "js/swish.js", "js/pairoff.js", "js/app.js"]


def stamp() -> str:
    """Add ?v=<content hash> to every asset link in index.html (the hosted copy), so a release always
    loads fresh files instead of a mix of cached old ones. Returns the version."""
    h = hashlib.sha1()
    for a in ASSETS:
        h.update((ROOT / a).read_bytes())
    ver = h.hexdigest()[:10]
    path = ROOT / "index.html"
    html = path.read_text(encoding="utf-8")
    for a in ASSETS:
        html = re.sub(re.escape(a) + r'(\?v=[0-9a-f]+)?"', a + "?v=" + ver + '"', html)
    path.write_text(html, encoding="utf-8")
    sw = ROOT / "sw.js"
    sw.write_text(re.sub(r"const VERSION = '[^']*';", "const VERSION = 'ut-" + ver + "';", sw.read_text(encoding="utf-8")), encoding="utf-8")
    return ver


def build(fragment: bool) -> str:
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    html = re.sub(r'\?v=[0-9a-f]+"', '"', html)
    html = re.sub(r"<!--pwa-->.*?<!--/pwa-->\n?", "", html, flags=re.S)
    html = html.replace('<meta name="apple-mobile-web-app-capable" content="yes">\n', "")
    css = (ROOT / "css/style.css").read_text(encoding="utf-8")
    html = html.replace('<link rel="stylesheet" href="css/style.css">', "<style>\n" + css + "</style>")

    def inline(m):
        return "<script>\n" + (ROOT / m.group(1)).read_text(encoding="utf-8") + "</script>"

    html = html.replace('<script src="js/core.js">', '<script>window.UT_NO_SW = true;</script>\n<script src="js/core.js">')
    html = re.sub(r'<script src="(js/[\w.]+)"></script>', inline, html)
    if fragment:
        html = re.sub(r"<!doctype html>\s*", "", html, flags=re.I)
        html = re.sub(r"</?(html|head|body)[^>]*>\s*", "", html)
        html = re.sub(r'<meta charset="utf-8">\s*', "", html)
        html = re.sub(r'<meta name="viewport"[^>]*>\s*', "", html)
        html = html.replace("<title>UltraTouch Arcade</title>", '<title>UltraTouch Arcade</title>\n<meta name="claude:viewport-fit-sides" content="cover">', 1)
    return html


if __name__ == "__main__":
    print("version", stamp())
    fragment = "--fragment" in sys.argv
    out = ROOT / "dist" / ("ultratouch-artifact.html" if fragment else "ultratouch.html")
    out.parent.mkdir(exist_ok=True)
    out.write_text(build(fragment), encoding="utf-8")
    print(out, out.stat().st_size, "bytes")
