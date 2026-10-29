"""Guard: web-next internal links must work on the canonical deployment.

Regression history (Oct 2026): the landing nav's "Problem space" link was
hardcoded to the GitHub Pages subpath ("/RobotForge-Hackathon/...")
while the site is served from a domain root (Vercel), so it 404'd. A
later fix routed it through BASE_PATH but kept the ".html" suffix —
which the root deployment's routing also 404s (the page is served at
the extensionless path; GitHub Pages resolves the extensionless path
to the same file, so extensionless works on both hosts).

These tests make both halves of that mistake a CI failure:

1. The "/RobotForge-Hackathon" literal may not appear in web-next/src
   as a path prefix — BASE_PATH in components/home/asset.ts is the
   single source of truth. (Full https:// URLs, e.g. the GitHub repo
   link, are not path prefixes and are allowed; so is the BASE_PATH
   definition line itself, and next.config.mjs, which is not scanned.)
2. Internal page links in web-next/src may not end in ".html" — page
   links go through BASE_PATH, extensionless. (The legacy /vanilla/
   subtree is exempt: it is a self-contained static site of raw .html
   files with its own conventions.)
3. When a built export exists (web-next/out), exported HTML must not
   reference the Pages prefix while BASE_PATH is "", and every
   internal link in the export must resolve to a file in the export.
"""

import re
from pathlib import Path

import pytest

REPO = Path(__file__).parent.parent
SRC = REPO / "web-next" / "src"
ASSET_TS = SRC / "components" / "home" / "asset.ts"
OUT = REPO / "web-next" / "out"
PREFIX = "/RobotForge-Hackathon"

FULL_URL = re.compile(r"https?://[^\s\"')\]]+")
ATTR = re.compile(r"""(?:href|src)\s*=\s*(?:\{\s*)?["'`]([^"'`]+)["'`]""")
EXPORT_ATTR = re.compile(r"""(?:href|src)\s*=\s*["']([^"']+)["']""")
SKIP_PREFIXES = ("http://", "https://", "mailto:", "data:", "javascript:", "#", "//")


def _src_files():
    return sorted(
        p for p in SRC.rglob("*") if p.suffix in {".ts", ".tsx", ".js", ".jsx"}
    )


def _base_path():
    m = re.search(
        r'export\s+const\s+BASE_PATH\s*=\s*"([^"]*)"',
        ASSET_TS.read_text(encoding="utf-8"),
    )
    assert m, "BASE_PATH definition not found in web-next/src/components/home/asset.ts"
    return m.group(1)


def test_no_hardcoded_pages_prefix_in_web_next_src():
    offenders = []
    for f in _src_files():
        for i, line in enumerate(
            f.read_text(encoding="utf-8", errors="replace").splitlines(), 1
        ):
            # The BASE_PATH definition line in asset.ts is the one place
            # the prefix may be defined.
            if f == ASSET_TS and re.search(r"\bBASE_PATH\s*=", line):
                continue
            if PREFIX in FULL_URL.sub("", line):
                offenders.append(f"{f.relative_to(REPO)}:{i}: {line.strip()}")
    assert not offenders, (
        "Hardcoded GitHub Pages prefix in web-next/src — route the path "
        "through BASE_PATH (components/home/asset.ts) instead:\n"
        + "\n".join(offenders)
    )


def test_internal_page_links_have_no_html_suffix():
    offenders = []
    for f in _src_files():
        text = f.read_text(encoding="utf-8", errors="replace")
        for m in ATTR.finditer(text):
            value = m.group(1)
            if value.startswith(SKIP_PREFIXES) or "/vanilla/" in value:
                continue
            path = value.split("#")[0].split("?")[0]
            if path.endswith(".html"):
                offenders.append(f"{f.relative_to(REPO)}: {value}")
    assert not offenders, (
        "Internal page links ending in .html 404 on the root deployment "
        "(Vercel serves the extensionless path; GitHub Pages resolves "
        "extensionless to the same file). Drop the suffix:\n"
        + "\n".join(offenders)
    )


def _resolves_in_export(target: Path) -> bool:
    return (
        target.is_file()
        or Path(str(target) + ".html").is_file()
        or (target / "index.html").is_file()
    )


def test_exported_links_resolve_when_export_present():
    if not OUT.is_dir():
        pytest.skip("web-next/out not built in this checkout")
    base = _base_path()
    offenders = []
    for f in sorted(OUT.rglob("*.html")):
        text = f.read_text(encoding="utf-8", errors="replace")
        for m in EXPORT_ATTR.finditer(text):
            value = m.group(1)
            if value.startswith(SKIP_PREFIXES):
                continue
            path = value.split("#")[0].split("?")[0]
            if not path:
                continue
            if base == "" and (path == PREFIX or path.startswith(PREFIX + "/")):
                offenders.append(
                    f"{f.relative_to(REPO)}: references {path} while BASE_PATH is ''"
                )
                continue
            if path.startswith("/"):
                rel = path.lstrip("/")
                if base and rel.startswith(base.strip("/") + "/"):
                    rel = rel[len(base.strip("/")) + 1 :]
                target = OUT / rel if rel else OUT / "index.html"
            else:
                target = f.parent / path
            if not _resolves_in_export(target):
                offenders.append(f"{f.relative_to(REPO)}: unresolved link {value}")
    assert not offenders, (
        "Exported site contains internal links that resolve to nothing:\n"
        + "\n".join(offenders[:50])
    )
