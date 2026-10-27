"""Static site generator: the app shell and every data-driven page.

The site has two surfaces that share only design tokens
(assets/css/tokens.css):

- the landing page, ``index.html`` — hand-written, except the robot row
  between its ``robots:start`` / ``robots:end`` markers, which this
  module fills from catalog/robots.json, and the Forge Guide chat block
  between its ``chat:start`` / ``chat:end`` markers, which
  update_landing() injects and refreshes;
- the app, under ``app/`` — every page generated here, inside one shell
  (sidebar + top bar), so the navigation exists in exactly one place.

Pages are rendered from repository data only (catalog/robots.json,
catalog/parts.json). Never hand-edit a generated page; edit the data or
this module and run ``robotforge site``.

All links are relative, so the site works at any base path (GitHub
Pages serves it under /RobotForge-Hackathon/).
"""
from __future__ import annotations

import html
import re
from pathlib import Path

from .catalog import Catalog, GateRun, Robodex, RobotEntry

REPO_URL = "https://github.com/abelxmendoza/RobotForge-Hackathon"

VERDICT_CLASS = {"PASS": "pass", "MARGINAL": "marginal", "FAIL": "fail",
                 "NOT_GATED": "norun"}
VERDICT_LABEL = {"PASS": "Pass", "MARGINAL": "Marginal", "FAIL": "Fail",
                 "NOT_GATED": "Not gated"}

# Locked gate thresholds (docs/DESIGN.md): pass <= 5, fail > 10, in % for
# distance and degrees for heading.
PASS_AT, FAIL_AT = 5.0, 10.0

# The app's three destinations, in sidebar order: (id, label, href from
# the app root, icon path data).
APP_NAV = [
    ("forge", "Forge", "forge/",
     '<path d="M4 6h16M4 12h10M4 18h7"/><circle cx="18" cy="16" r="3"/>'),
    ("robots", "Robots", "robots/",
     '<rect x="4" y="7" width="16" height="9" rx="2"/>'
     '<circle cx="8" cy="18.5" r="1.8"/><circle cx="16" cy="18.5" r="1.8"/>'
     '<path d="M12 7V4"/>'),
    ("evidence", "Evidence", "evidence/",
     '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
]

BRAND_MARK = ('<span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24" '
              'fill="none" stroke="#1a1204" stroke-width="2.2" '
              'stroke-linecap="round" stroke-linejoin="round">'
              '<rect x="4" y="6" width="16" height="9" rx="2"/>'
              '<circle cx="8" cy="17.5" r="2"/><circle cx="16" cy="17.5" r="2"/>'
              '</svg></span>')

e = html.escape


# --------------------------------------------------------------------------
# Forge Guide chat widget (assets/css/chat.css, assets/js/chat-engine.js,
# assets/js/chat.js). The markup is URL-free — chat.js resolves the
# catalog data from its own script URL — so one block serves the landing
# page and every app depth. The label is the honest one: this static
# site has no backend, so the guide answers from recorded data only.
# --------------------------------------------------------------------------

CHAT_HONEST = ("Answers from RobotForge's recorded data "
               "(not a live AI)")


def chat_widget() -> str:
    return f"""<div class="forge-chat" id="forge-chat">
  <button class="fc-launcher" id="fc-launcher" type="button" aria-expanded="false" aria-controls="fc-panel">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-8 8H4l2.3-2.9A8 8 0 1 1 21 12z"/><path d="M8.5 11h.01M12 11h.01M15.5 11h.01"/></svg>
    <span>Forge Guide</span>
  </button>
  <section class="fc-panel" id="fc-panel" hidden role="dialog" aria-label="Forge Guide chat">
    <header class="fc-head">
      <div>
        <strong>Forge Guide</strong>
        <span class="fc-sub">{CHAT_HONEST} — the Robodex, the parts catalogue and the recorded gate reports.</span>
      </div>
      <button class="fc-close" id="fc-close" type="button" aria-label="Close chat">&times;</button>
    </header>
    <div class="fc-msgs" id="fc-msgs" role="log" aria-live="polite"></div>
    <div class="fc-chips" id="fc-chips" aria-label="Suggested questions"></div>
    <form class="fc-form" id="fc-form">
      <input id="fc-input" type="text" autocomplete="off" placeholder="Ask about a robot, a part, or the gate…" aria-label="Your question">
      <button class="btn btn-primary btn-sm" type="submit">Ask</button>
    </form>
  </section>
</div>"""


CHAT_START = "<!-- chat:start -->"
CHAT_END = "<!-- chat:end -->"


def inject_chat(page: str) -> str:
    """Ensure a root-level page (the landing) carries the Forge Guide:
    the chat.css link in <head> and the marked widget block before
    </body>. Idempotent — an already-injected page gets its block
    refreshed to the current markup, byte for byte."""
    link = '<link rel="stylesheet" href="assets/css/chat.css">'
    if "assets/css/chat.css" not in page:
        page = page.replace("</head>", link + "\n</head>", 1)
    block = (CHAT_START + "\n" + chat_widget() + "\n"
             '<script src="assets/js/chat-engine.js"></script>\n'
             '<script src="assets/js/chat.js"></script>\n' + CHAT_END)
    if CHAT_START in page and CHAT_END in page:
        start = page.index(CHAT_START)
        end = page.index(CHAT_END) + len(CHAT_END)
        page = page[:start] + block + page[end:]
    else:
        page = page.replace("</body>", block + "\n</body>", 1)
    return page


def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def verdict_badge(status: str, extra: str = "") -> str:
    cls = VERDICT_CLASS[status] + (f" {extra}" if extra else "")
    return f'<span class="verdict {cls}">{VERDICT_LABEL[status]}</span>'


def _grade(value: float | None) -> str:
    if value is None:
        return ""
    v = abs(value)
    return "pass" if v <= PASS_AT else ("marginal" if v <= FAIL_AT else "fail")


# --------------------------------------------------------------------------
# shell
# --------------------------------------------------------------------------

def app_shell(*, active: str, title: str, depth: int, body: str,
              crumbs: list[tuple[str, str]] | None = None,
              scripts: tuple[str, ...] = (), description: str = "") -> str:
    """Wrap ``body`` in the app shell.

    ``depth`` is how many folders below the site root the page lives
    (app/forge/ -> 2), used to build relative links. ``crumbs`` is a list
    of (label, href-from-site-root); the last one is the current page.
    """
    root = "../" * depth
    app = root + "app/"
    nav = []
    for vid, label, href, icon in APP_NAV:
        cur = ' aria-current="page"' if vid == active else ""
        nav.append(
            f'<a href="{app}{href}"{cur}><svg viewBox="0 0 24 24" fill="none" '
            f'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" '
            f'stroke-linejoin="round" aria-hidden="true">{icon}</svg>'
            f'<span>{label}</span></a>')
    crumbs = crumbs or []
    crumb_html = []
    for i, (label, href) in enumerate(crumbs):
        if i == len(crumbs) - 1:
            crumb_html.append(f'<span class="here" aria-current="page">{e(label)}</span>')
        else:
            crumb_html.append(f'<a href="{root}{href}">{e(label)}</a>'
                              '<span class="sep" aria-hidden="true">/</span>')
    script_tags = "\n".join(
        f'<script src="{root}assets/js/{s}"></script>'
        for s in ("common.js", "anim.js") + scripts + ("chat-engine.js", "chat.js"))
    desc = (f'\n<meta name="description" content="{e(description)}">'
            if description else "")
    return f"""<!DOCTYPE html>
<html lang="en" data-root="{root}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{e(title)} · RobotForge</title>{desc}
<meta name="theme-color" content="#0f1115">
<link rel="stylesheet" href="{root}assets/css/tokens.css">
<link rel="stylesheet" href="{root}assets/css/app.css">
<link rel="stylesheet" href="{root}assets/css/chat.css">
<link rel="stylesheet" href="{root}assets/css/anim.css">
</head>
<body class="app">
<!-- Generated by `robotforge site` from repository data. Do not hand-edit. -->
<div class="shell">
  <aside class="sidebar">
    <a class="brand" href="{root}">{BRAND_MARK}<span>RobotForge<small>App</small></span></a>
    <nav class="side-nav" aria-label="App">
      {"".join(nav)}
    </nav>
    <div class="side-foot">
      <a href="{root}">&larr; RobotForge site</a>
      <a href="{REPO_URL}">GitHub</a>
    </div>
  </aside>
  <div class="main">
    <header class="topbar">
      <a class="mobile-brand" href="{root}" aria-label="RobotForge site">{BRAND_MARK}</a>
      <nav class="crumbs" aria-label="Breadcrumb">{"".join(crumb_html)}</nav>
      <span class="recorded" title="This static site replays recorded runs. Nothing here calls a model or a simulator live.">Recorded runs</span>
    </header>
    <main class="content" id="content">
{body}
    </main>
  </div>
</div>
{chat_widget()}
{script_tags}
</body>
</html>
"""


def redirect_page(target: str, title: str) -> str:
    """A tiny page that forwards an old URL to its new home."""
    t = e(target)
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{e(title)} — moved</title>
<meta http-equiv="refresh" content="0; url={t}">
<link rel="canonical" href="{t}">
<script>location.replace({target!r} + location.hash);</script>
</head>
<body style="background:#0f1115;color:#eceef2;font-family:system-ui,sans-serif;padding:40px">
<p>{e(title)} has moved. <a style="color:#f59e0b" href="{t}">Continue &rarr;</a></p>
</body>
</html>
"""


# --------------------------------------------------------------------------
# robot imagery
# --------------------------------------------------------------------------

def _robot_image(r: RobotEntry, root: str) -> tuple[str, str, bool]:
    """(src, caption, is_ai). Real robots lead with their official photo;
    generated art appears only where no photo exists, captioned as AI."""
    if r.image_url:
        return r.image_url, r.image_credit, False
    if r.name == "Pathfinder":
        return (root + "assets/img/pathfinder.jpg",
                "AI concept illustration (muse-image-1.0). Pathfinder is a "
                "RobotForge design, not built hardware; no photo of it exists.",
                True)
    return "", "", False


def robot_card(r: RobotEntry, root: str, href: str) -> str:
    src, _, ai = _robot_image(r, root)
    alt = r.name + (" (AI concept illustration)" if ai else "")
    ph = (f'<div class="ph{" ai" if ai else ""}"><img src="{e(src)}" '
          f'alt="{e(alt)}" loading="lazy"></div>' if src
          else '<div class="ph ai"></div>')
    return (f'<a class="robot-card" href="{e(href)}" '
            f'data-status="{r.gate_status.status}">{ph}'
            f'<div class="body"><span class="dex">{e(r.dex_id)}</span>'
            f'<h3>{e(r.name)}</h3><span class="cls">{e(r.robot_class)}</span>'
            f'{verdict_badge(r.gate_status.status)}</div></a>')


# --------------------------------------------------------------------------
# app pages
# --------------------------------------------------------------------------

FORGE_BODY = """<div class="page-head">
  <div>
    <div class="eyebrow">Forge</div>
    <h1>Run a robot through the forge</h1>
    <p class="lede">Pick an input and step through a real recorded run: what went in, the spec that came back, what the checks found, and what the gate measured.</p>
  </div>
</div>
<div class="forge-top">
  <div class="tabs" role="tablist" aria-label="Input type" id="forge-tabs"></div>
  <span class="forge-meta" id="forge-meta"></span>
</div>
<div class="forge">
  <ol class="rail" id="forge-rail" aria-label="Steps"></ol>
  <div>
    <div class="progress" aria-hidden="true"><span id="forge-progress"></span></div>
    <article class="step-card" id="forge-step" aria-live="polite">
      <div class="state-box">Loading the recorded run&hellip;</div>
    </article>
  </div>
</div>"""


def render_forge() -> str:
    return app_shell(active="forge", title="Forge", depth=2, body=FORGE_BODY,
                     crumbs=[("App", "app/forge/"), ("Forge", "app/forge/")],
                     scripts=("forge.js",),
                     description="Step through a recorded RobotForge run: "
                                 "input, spec, checks, twin and gate, outputs.")


CLASS_LABEL = {"sbc": "single-board computers",
               "cables_connectors": "cables & connectors",
               "cameras_sensors": "cameras & sensors",
               "safety_protection": "safety & protection",
               "memory_storage": "memory & storage",
               "propulsion_air": "air propulsion"}


def _parts_catalog(cat: Catalog, root: str) -> str:
    groups: dict[str, list] = {}
    for p in sorted(cat.parts.values(), key=lambda p: (p.part_class, p.name)):
        groups.setdefault(p.part_class, []).append(p)
    out = []
    for cls, parts in groups.items():
        items = []
        for p in parts:
            specs = ", ".join(
                f"{k.replace('_', ' ')}: "
                + (" / ".join(map(str, v)) if isinstance(v, (list, tuple)) else str(v))
                for k, v in p.specs.items())
            hay = " ".join([p.name, p.id, cls, p.blurb, p.used_for]).lower()
            # The illustration is an AI drawing of a real part, captioned
            # as such; if the image file is not on the site yet, the whole
            # figure removes itself instead of showing a broken image.
            fig = ""
            if p.image:
                fig = (f'<figure class="pfig"><img src="{root}{e(p.image)}" '
                       f'alt="AI illustration of the {e(p.name)}" '
                       f'loading="lazy" '
                       f'onerror="this.parentElement.remove()">'
                       f"<figcaption>AI illustration</figcaption></figure>")
            items.append(
                f'<div class="part" data-q="{e(hay)}">{fig}<h4>{e(p.name)}</h4>'
                + (f"<p>{e(p.blurb)}</p>" if p.blurb else "")
                + (f'<div class="specs">{e(specs)}</div>' if specs else "")
                + "</div>")
        label = CLASS_LABEL.get(cls, cls.replace("_", " "))
        out.append(f'<div class="parts-group"><h3>{e(label)} '
                   f'<span>({len(parts)})</span></h3>'
                   f'<div class="part-list">{"".join(items)}</div></div>')
    return "\n".join(out)


def render_robots_index(dex: Robodex, cat: Catalog) -> str:
    root = "../../"
    cards = "\n".join(robot_card(r, root, f"{slugify(r.name)}/")
                      for r in dex.robots)
    counts = {s: sum(r.gate_status.status == s for r in dex.robots)
              for s in ("PASS", "FAIL", "NOT_GATED")}
    chips = ['<button class="chip" type="button" data-filter="all" '
             f'aria-pressed="true">All ({len(dex.robots)})</button>']
    for s, n in counts.items():
        if n:
            chips.append(f'<button class="chip" type="button" data-filter="{s}" '
                         f'aria-pressed="false">{VERDICT_LABEL[s]} ({n})</button>')
    body = f"""<div class="page-head">
  <div>
    <div class="eyebrow">Robots</div>
    <h1>Robodex</h1>
    <p class="lede">Every robot the forge knows, numbered in the order it learned them. Badges come only from recorded gate runs. A robot with no run says so in grey.</p>
  </div>
</div>
<div class="toolbar" role="group" aria-label="Filter by verdict">{"".join(chips)}</div>
<div class="robot-grid" id="robot-grid">
{cards}
</div>
<div class="dex-strip" aria-label="Robot illustrations">
  <figure><img src="{root}assets/img/illustrations/andino.svg" alt="Illustration of Andino" loading="lazy"><figcaption>#001 Andino</figcaption></figure>
  <figure><img src="{root}assets/img/illustrations/turtlebot3-burger.svg" alt="Illustration of TurtleBot3 Burger" loading="lazy"><figcaption>#002 TurtleBot3 Burger</figcaption></figure>
  <figure><img src="{root}assets/img/illustrations/turtlebot3-waffle-pi.svg" alt="Illustration of TurtleBot3 Waffle Pi" loading="lazy"><figcaption>#003 TurtleBot3 Waffle Pi</figcaption></figure>
  <figure><img src="{root}assets/img/illustrations/pathfinder.svg" alt="Illustration of Pathfinder" loading="lazy"><figcaption>#004 Pathfinder</figcaption></figure>
</div>
<p class="sub">RobotForge illustrations — drawn for this index; photos and gate badges live on each robot's page.</p>
<p><a href="{root}kit.html"><strong>Take it apart in 3D &rarr;</strong> orbit, explode and export the Burger kit as parametric CAD</a></p>

<section class="section" id="parts">
  <h2>Parts catalogue</h2>
  <p class="sub">{len(cat.parts)} real parts with datasheet-sourced specs, grouped by class. These are what the forge assembles robots from and checks parts lists against.</p>
  <div class="toolbar"><input type="search" id="part-search" placeholder="Search parts, e.g. lidar, 12 V, ESP32" aria-label="Search parts"></div>
  <div id="parts-list">
{_parts_catalog(cat, root)}
  </div>
  <p class="state-box" id="parts-empty" hidden>No parts match that search.</p>
</section>"""
    return app_shell(active="robots", title="Robots", depth=2, body=body,
                     crumbs=[("App", "app/forge/"), ("Robots", "app/robots/")],
                     scripts=("robots.js",),
                     description="The Robodex: every robot RobotForge knows, "
                                 "with gate verdicts from recorded runs.")


def _fmt(v: float | None, unit: str) -> str:
    if v is None:
        return '<td class="num faint">—</td>'
    return f'<td class="num"><span class="verdict-text {_grade(v)}">{v:.3f}{unit}</span></td>'


def _runs_table(runs: tuple[GateRun, ...]) -> str:
    rows = []
    for i, run in enumerate(runs, 1):
        rows.append(f"<tr><td>Run {i}</td>"
                    + _fmt(run.drive_error_pct, "%")
                    + _fmt(run.heading_error_deg, "°")
                    + _fmt(run.odometry_distance_error_pct, "%")
                    + _fmt(run.odometry_heading_error_deg, "°")
                    + "</tr>")
    sources = "".join(f"<li>Run {i}: {e(run.source)}</li>"
                      for i, run in enumerate(runs, 1) if run.source)
    return ('<div class="table-scroll"><table class="data"><thead><tr>'
            "<th>Run</th><th>Drive vs truth</th><th>Turn vs truth</th>"
            "<th>Odometry distance</th><th>Odometry heading</th></tr></thead>"
            f"<tbody>{''.join(rows)}</tbody></table></div>"
            + (f'<ul class="prov" style="margin-top:12px;padding-left:18px">{sources}</ul>'
               if sources else ""))


def render_robot_page(r: RobotEntry) -> str:
    root = "../../../"
    slug = slugify(r.name)
    src, caption, ai = _robot_image(r, root)
    figure = ""
    if src:
        alt = r.name + (" (AI concept illustration)" if ai else " (official image)")
        figure = (f'<figure><div class="ph{" ai" if ai else ""}"><img src="{e(src)}" '
                  f'alt="{e(alt)}"></div>'
                  + (f"<figcaption>{e(caption)}</figcaption>" if caption else "")
                  + "</figure>")
    specs = "".join(f"<tr><th>{e(str(k).replace('_', ' ').capitalize())}</th><td>{e(str(v))}</td></tr>"
                    for k, v in sorted(r.key_specs.items()))
    spec_block = (f'<table class="kv">{specs}</table>' if specs else
                  '<p class="state-box">No key specs recorded yet.</p>')
    prov = r.provenance
    prov_lines = [f"<span><strong>Source:</strong> {e(str(prov.get('source_name', '')))}"
                  + (f' · <a href="{e(str(prov["source_url"]))}">link</a>'
                     if prov.get("source_url") else "") + "</span>"]
    if prov.get("license"):
        prov_lines.append(f"<span><strong>License:</strong> {e(str(prov['license']))}</span>")
    if r.spec_file:
        prov_lines.append(f'<span><strong>Spec file:</strong> <a href="{REPO_URL}/blob/main/'
                          f'{e(r.spec_file)}"><code>{e(r.spec_file)}</code></a></span>')
    if prov.get("note"):
        prov_lines.append(f"<span>{e(str(prov['note']))}</span>")
    gs = r.gate_status
    if gs.runs:
        gate = _runs_table(gs.runs)
    else:
        gate = '<p class="state-box">No recorded gate runs yet. This robot has no verdict until one is measured.</p>'
    note = (f'<div class="callout{" bad" if gs.status == "FAIL" else ""}" '
            f'style="margin-top:12px"><span>{e(gs.note)}</span></div>'
            if gs.note else "")
    take_apart = ""
    commands = ""
    if r.spec_file:
        take_apart = f"""
<section class="section" id="take-apart">
  <h2>Take it apart</h2>
  <p class="sub">Every spec becomes a kit of simple, 3D-printable parts (<code>robotforge cad</code>). This viewer lays the kit out the way the kit's own assembly file does, straight from the spec's numbers. Click any part.</p>
  <div id="ta" data-spec="{root}{e(r.spec_file)}">
    <div class="state-box">Loading <code>{e(r.spec_file)}</code>&hellip;</div>
  </div>
</section>"""
        commands = f"""
<section class="section" id="commands">
  <h2>Reproduce it</h2>
  <p class="sub">Run these from a clone of the repository.</p>
  <div class="codeblock card" style="padding:0;border:0;background:none">
<pre><code>robotforge validate {e(r.spec_file)}
robotforge urdf {e(r.spec_file)} --out build/{slug}.urdf
robotforge cad {e(r.spec_file)}
robotforge run-gate {e(r.spec_file)}</code></pre>
    <button class="btn btn-sm copy" type="button" data-copy>Copy</button>
  </div>
</section>"""
    jump = ['<a class="chip" href="#spec">Spec</a>', '<a class="chip" href="#gate">Gate runs</a>']
    if r.spec_file:
        jump += ['<a class="chip" href="#take-apart">Take it apart</a>',
                 '<a class="chip" href="#commands">Reproduce</a>']
    body = f"""<div class="robot-hero">
  {figure}
  <div>
    <span class="dex">{e(r.dex_id)}</span>
    <h1>{e(r.name)}</h1>
    <div class="cls">{e(r.robot_class)}</div>
    {verdict_badge(gs.status, "lg")}
    <p class="desc">{e(r.description)}</p>
    <nav class="jump" aria-label="On this page">{"".join(jump)}</nav>
  </div>
</div>

<section class="section" id="spec">
  <h2>Spec</h2>
  <div class="cols">
    <div class="card">{spec_block}</div>
    <div class="card prov">{"".join(prov_lines)}</div>
  </div>
</section>

<section class="section" id="gate">
  <h2>Gate runs</h2>
  <p class="sub">Measured against simulator ground truth at the locked thresholds: pass ≤ 5% / 5°, fail over 10% / 10°. The gate tests the spec's simulated twin, not a physical robot.</p>
  <div class="card">{gate}{note}</div>
</section>
{take_apart}
{commands}"""
    return app_shell(active="robots", title=r.name, depth=3, body=body,
                     crumbs=[("App", "app/forge/"), ("Robots", "app/robots/"),
                             (r.name, f"app/robots/{slug}/")],
                     scripts=("robot.js",) if r.spec_file else (),
                     description=f"{r.name} in the RobotForge Robodex: spec, "
                                 "gate runs and take-apart kit.")


def render_evidence(dex: Robodex) -> str:
    rows = []
    for r in dex.robots:
        gs = r.gate_status
        best = gs.runs[-1] if gs.runs else None
        rows.append(
            f'<tr><td><a href="../robots/{slugify(r.name)}/">{e(r.name)}</a></td>'
            f"<td>{verdict_badge(gs.status)}</td>"
            f'<td class="num">{len(gs.runs)}</td>'
            + (_fmt(best.drive_error_pct, "%") + _fmt(best.heading_error_deg, "°")
               if best else '<td class="num faint">—</td><td class="num faint">—</td>')
            + "</tr>")
    body = f"""<div class="page-head">
  <div>
    <div class="eyebrow">Evidence</div>
    <h1>Measured, not believed</h1>
    <p class="lede">Every verdict is judged against simulator ground truth, where the robot actually went, never against its own odometry alone. These are the gate's own reports from real runs in Gazebo Sim, headless, on Oct 26, 2026.</p>
  </div>
</div>

<div class="cols">
  <div class="card">
    <div class="card-head"><h3 style="font-size:var(--fs-md)">Locked thresholds</h3></div>
    <div class="table-scroll" style="margin-top:12px"><table class="data">
      <thead><tr><th>Measurement</th><th>Pass</th><th>Marginal</th><th>Fail</th></tr></thead>
      <tbody>
        <tr><td>Distance error</td><td class="num">≤ 5%</td><td class="num">5–10%</td><td class="num">&gt; 10%</td></tr>
        <tr><td>Heading error</td><td class="num">≤ 5°</td><td class="num">5–10°</td><td class="num">&gt; 10°</td></tr>
      </tbody></table></div>
    <p class="faint" style="font-size:var(--fs-xs);margin-top:12px">Printed on every report and never quietly loosened.</p>
  </div>
  <div class="card">
    <div class="card-head"><h3 style="font-size:var(--fs-md)">How a run is graded</h3></div>
    <p class="muted" style="font-size:var(--fs-sm);margin-top:12px">The twin is commanded to drive 1 m and turn 90°. Drive and turn are graded against the simulator's true pose. Odometry is graded against that same truth, so a robot whose sensors are wrong about itself can't pass. When something is off, the gate names the spec field to look at first.</p>
  </div>
</div>

<section class="section" id="reports">
  <h2>Gate reports</h2>
  <p class="sub">Two clean passes and two failures the gate caught. Each report shows every check, the raw measurements, the ground-truth path, and any suspects the gate named.</p>
  <div class="report-strip" id="report-strip"></div>
  <div id="report-list" style="margin-top:var(--s5)">
    <div class="state-box">Loading recorded reports from <code>catalog/gate-reports.json</code>&hellip;</div>
  </div>
</section>

<section class="section" id="robots">
  <h2>Robodex verdicts</h2>
  <p class="sub">The current verdict for each robot and its latest recorded run. Failures stay on the record exactly as measured.</p>
  <div class="card" style="padding:8px 8px 4px"><div class="table-scroll"><table class="data">
    <thead><tr><th>Robot</th><th>Verdict</th><th>Runs</th><th>Latest drive</th><th>Latest turn</th></tr></thead>
    <tbody>{"".join(rows)}</tbody>
  </table></div></div>
</section>"""
    return app_shell(active="evidence", title="Evidence", depth=2, body=body,
                     crumbs=[("App", "app/forge/"), ("Evidence", "app/evidence/")],
                     scripts=("evidence.js",),
                     description="RobotForge gate reports: measured against "
                                 "ground truth at locked thresholds.")


# --------------------------------------------------------------------------
# landing page robot row + build
# --------------------------------------------------------------------------

ROBOTS_START = "<!-- robots:start"
ROBOTS_END = "<!-- robots:end -->"


def render_landing_robots(dex: Robodex) -> str:
    return "\n".join(robot_card(r, "", f"app/robots/{slugify(r.name)}/")
                     for r in dex.robots)


def update_landing(index_html: str, dex: Robodex) -> str:
    start = index_html.index(ROBOTS_START)
    start = index_html.index("\n", start) + 1
    end = index_html.index(ROBOTS_END)
    page = (index_html[:start] + render_landing_robots(dex) + "\n"
            + index_html[end:])
    return inject_chat(page)


LEGACY_REDIRECTS = {
    "robodex.html": ("app/robots/", "The Robodex"),
    "parts.html": ("app/robots/#parts", "The parts kit"),
    "try.html": ("app/forge/", "Try It"),
    "reports.html": ("app/evidence/", "The gate reports"),
}


def build_site(out: Path, dex: Robodex | None = None,
               cat: Catalog | None = None) -> list[Path]:
    """Write every generated page under ``out`` (the repository root)."""
    dex = dex or Robodex.load()
    cat = cat or Catalog.load()
    pages: dict[str, str] = {
        "app/index.html": redirect_page("forge/", "The RobotForge app"),
        "app/forge/index.html": render_forge(),
        "app/robots/index.html": render_robots_index(dex, cat),
        "app/evidence/index.html": render_evidence(dex),
    }
    for r in dex.robots:
        pages[f"app/robots/{slugify(r.name)}/index.html"] = render_robot_page(r)
    for old, (target, title) in LEGACY_REDIRECTS.items():
        pages[old] = redirect_page(target, title)
    written = []
    for rel, text in pages.items():
        p = out / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text)
        written.append(p)
    index = out / "index.html"
    if index.exists():
        index.write_text(update_landing(index.read_text(), dex))
        written.append(index)
    return written
