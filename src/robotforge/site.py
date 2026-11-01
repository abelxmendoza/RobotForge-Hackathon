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
import json
import re
from pathlib import Path

from .catalog import (MOBILITY_TAXONOMY, ROBOTS_DATA, Catalog, GateRun,
                      Robodex, RobotCheck,
                      RobotEntry)

REPO_URL = "https://github.com/abelxmendoza/RobotForge-Hackathon"

# 3D take-apart (assets/js/robot3d.js): Three.js pinned, the same
# version and CDN the 3D parts kit (kit.html) already ships, loaded as
# ES modules behind an importmap. Robot pages only.
THREE_VERSION = "0.160.0"
THREE_CDN = f"https://cdn.jsdelivr.net/npm/three@{THREE_VERSION}"
THREE_IMPORTMAP = (
    '{"imports":{'
    f'"three":"{THREE_CDN}/build/three.module.js",'
    f'"three/addons/":"{THREE_CDN}/examples/jsm/"'
    "}}")

VERDICT_CLASS = {"PASS": "pass", "MARGINAL": "marginal", "FAIL": "fail",
                 "NOT_GATED": "norun"}
VERDICT_LABEL = {"PASS": "Pass", "MARGINAL": "Marginal", "FAIL": "Fail",
                 "NOT_GATED": "Not gated"}
SOURCE_LABEL = {"my": "My robot", "sighted": "Sighted",
                "photo": "From photo", "researched": "Researched"}
SOURCE_TAB_LABEL = {"my": "My Robots", "sighted": "Sighted Robots",
                    "photo": "From Photos", "researched": "Researched"}
SOURCE_DESCRIPTION = {
    "my": "Robots you own and keep in the Workshop.",
    "sighted": "Other people's robots you saw in person and credited.",
    "photo": "Robots known from a 2D photo or video frame; dimensions stay estimated.",
    "researched": "Researched robots use published specs, URDFs, datasheets, and project records.",
}

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


def chat_widget(docked: bool = False) -> str:
    """The Forge Guide chat. Default: the floating launcher + panel
    (landing page). Docked: the same chat as a persistent left rail
    inside the app shell — same ids and engine, different frame."""
    wrap = "forge-chat docked" if docked else "forge-chat"
    return f"""<div class="{wrap}" id="forge-chat">
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


# --------------------------------------------------------------------------
# Live endpoint config (assets/js/live-config.js). The site is static
# and ships with NO live endpoint: empty means the Forge Guide answers
# from recorded data and the Forge replays recorded runs, exactly as
# before. Deploying the Worker in live/ and setting this constant to
# its base URL (then regenerating) lights up live describe + live
# chat; the key itself only ever lives in the Worker (live/README.md).
# --------------------------------------------------------------------------

LIVE_ENDPOINT = ""


def render_live_config() -> str:
    """The one deployment constant, as a tiny script both the chat and
    the Forge read (window.RF_LIVE.endpoint)."""
    return f"""'use strict';
/* RobotForge live endpoint — deployment configuration.
 *
 * GENERATED by `robotforge site` from src/robotforge/site.py
 * (LIVE_ENDPOINT). Do not hand-edit; change the constant there and
 * regenerate.
 *
 * Empty (the committed default): the site is exactly the recorded
 * site — the Forge Guide answers from recorded data and the Forge
 * replays recorded runs. Set this to the deployed Worker base URL
 * (see live/README.md) to light up live describe + live chat.
 */
window.RF_LIVE = {{ endpoint: '{LIVE_ENDPOINT}' }};
"""




def inject_chat(page: str) -> str:
    """Ensure a root-level page (the landing) carries the Forge Guide:
    the chat.css link in <head> and the marked widget block before
    </body>. Idempotent — an already-injected page gets its block
    refreshed to the current markup, byte for byte."""
    link = '<link rel="stylesheet" href="assets/css/chat.css">'
    if "assets/css/chat.css" not in page:
        page = page.replace("</head>", link + "\n</head>", 1)
    block = (CHAT_START + "\n" + chat_widget() + "\n"
             '<script src="assets/js/live-config.js"></script>\n'
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


STABILITY_CLASS = {"STABLE": "stable", "MARGINAL": "marginal",
                   "UNSTABLE": "unstable"}


def static_badge(check: RobotCheck, extra: str = "") -> str:
    """Badge for a static stability check — a computation from the spec,
    styled (dashed steel-blue) so it can never be read as a gate
    verdict, and worded to say what it is."""
    cls = "static-badge " + STABILITY_CLASS[check.grade] \
        + (f" {extra}" if extra else "")
    return (f'<span class="{cls}">Static check: {check.grade} — '
            f'tip margin {check.tip_angle_deg:.0f}°</span>')


def _load_check_report(check: RobotCheck) -> dict | None:
    """The full JSON report behind a catalog check record."""
    path = ROBOTS_DATA.parent.parent / check.report
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return None


def _harness_report(r: RobotEntry) -> dict | None:
    """The recorded harness-check report for a robot, if one exists.

    Harness reports live in catalog/harness-reports/<slug>.json and
    are re-derived from the spec by the test suite, so a report on
    disk is the check's own output — the page renders its counts and
    findings verbatim and claims nothing beyond them."""
    path = ROBOTS_DATA.parent / "harness-reports" / f"{slugify(r.name)}.json"
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return None


def _harness_report_path(r: RobotEntry) -> str:
    return f"catalog/harness-reports/{slugify(r.name)}.json"


def harness_badge(rep: dict, extra: str = "") -> str:
    """Badge for a harness-check report — counts, never a verdict.

    Styled (dashed amber) as its own evidence kind: not a gate pill,
    not the steel-blue stability badge. The text is the summary's own
    counts, so the badge cannot drift from the report."""
    s = rep["summary"]
    cls = "harness-badge" + (f" {extra}" if extra else "")
    return (f'<span class="{cls}">Harness checks: '
            f'{s["checked_clean"]} clean · '
            f'{s["findings"]["WARN"]} warn · '
            f'{s["findings"]["ERROR"]} err · '
            f'{s["states"]["NOT_CHECKED"]} not checked</span>')


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
              scripts: tuple[str, ...] = (), description: str = "",
              module_scripts: tuple[str, ...] = (),
              importmap: str = "") -> str:
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
        for s in ("common.js", "anim.js", "live-config.js") + scripts +
        ("chat-engine.js", "chat.js"))
    if module_scripts:
        script_tags += "\n" + "\n".join(
            f'<script type="module" src="{root}assets/js/{s}"></script>'
            for s in module_scripts)
    imap = (f'\n<script type="importmap">{importmap}</script>'
            if importmap else "")
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
<link rel="stylesheet" href="{root}assets/css/anim.css">{imap}
</head>
<body class="app">
<!-- Generated by `robotforge site` from repository data. Do not hand-edit. -->
<div class="shell">
{chat_widget(docked=True)}
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
    generated art appears only where no photo exists, captioned as AI.
    A relative ``assets/...`` image_url is a repo-local illustration
    (labeled as one in its credit) and gets the page's root prefix."""
    if r.image_url:
        src = root + r.image_url if r.image_url.startswith("assets/") \
            else r.image_url
        return src, r.image_credit, False
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
    check = r.static_check()
    return (f'<a class="robot-card" href="{e(href)}" '
            f'data-status="{r.gate_status.status}" '
            f'data-mobility="{e(r.mobility_class)}" '
            f'data-source="{e(r.source)}">{ph}'
            f'<div class="body"><span class="dex">{e(r.dex_id)}</span>'
            f'<span class="source-badge source-{e(r.source)}">'
            f'{e(SOURCE_LABEL[r.source])}</span>'
            f'<h3>{e(r.name)}</h3><span class="cls">{e(r.class_path)}</span>'
            f'{verdict_badge(r.gate_status.status)}'
            f'{static_badge(check) if check else ""}</div></a>')


# --------------------------------------------------------------------------
# app pages
# --------------------------------------------------------------------------

FORGE_BODY = """<div class="page-head">
  <div>
    <div class="eyebrow">Forge</div>
    <h1>Talk to the forge</h1>
    <p class="lede">One conversation: describe a robot in words, or attach a photo, a parts list, a spec file, or a 3D scan. A photo of a spec sheet or blueprint is read as a document &mdash; printed values transcribed, never inferred from drawing scale &mdash; and a scan (.ply) is measured right in your browser. Every stage of every run wears the badge it earned &mdash; <strong>LIVE</strong> (a real model call through the live endpoint), <strong>LOCAL</strong> (real computation in your browser) or <strong>RECORDED</strong> (a replayed run, labeled with its date). Nothing wears a badge it didn&rsquo;t earn.</p>
  </div>
</div>
<div class="forge-status" id="forge-status" role="status">Checking what this deployment can do&hellip;</div>
<div class="forge-thread" id="forge-thread" aria-live="polite"></div>
<div class="forge-samples">
  <span class="faint">Recorded sample runs:</span>
  <button class="btn btn-sm" type="button" data-sample="words">Words &mdash; indoor rover</button>
  <button class="btn btn-sm" type="button" data-sample="photo">Photo &mdash; TurtleBot (SAMPLE)</button>
  <button class="btn btn-sm" type="button" data-sample="list">Parts list &mdash; quadcopter</button>
  <button class="btn btn-sm" type="button" data-sample="document">Document &mdash; TurtleBot3 spec sheet</button>
</div>
<form class="forge-composer" id="forge-composer">
  <div class="attach-row" id="attach-row" hidden>
    <span class="attach-chip" id="attach-chip"></span>
    <button class="btn btn-sm btn-ghost" type="button" id="attach-clear">Remove</button>
  </div>
  <label class="faint" for="forge-input" style="font-size:var(--fs-xs)">Message the forge</label>
  <textarea id="forge-input" rows="3" placeholder="Describe a robot in plain words&hellip; or attach a photo, a parts list, a spec file, or a .ply scan below."></textarea>
  <div class="composer-row">
    <div class="attach-btns">
      <span class="faint" style="font-size:var(--fs-xs)">Attach:</span>
      <button class="btn btn-sm" type="button" id="att-photo">Photo</button>
      <button class="btn btn-sm" type="button" id="att-doc">Parts list</button>
      <button class="btn btn-sm" type="button" id="att-spec">Spec JSON</button>
      <button class="btn btn-sm" type="button" id="att-scan">Scan (.ply)</button>
    </div>
    <button class="btn btn-primary" type="submit" id="forge-send">Send</button>
  </div>
  <p class="faint composer-note">Files stay in your browser unless you run a live step. In local and recorded mode nothing is uploaded, ever.</p>
  <input type="file" id="file-photo" accept="image/*" hidden>
  <input type="file" id="file-doc" accept=".txt,.md,.csv,text/plain" hidden>
  <input type="file" id="file-spec" accept=".json,application/json" hidden>
  <input type="file" id="file-scan" accept=".ply" hidden>
</form>"""


def render_forge() -> str:
    return app_shell(active="forge", title="Forge", depth=2, body=FORGE_BODY,
                     crumbs=[("App", "app/forge/"), ("Forge", "app/forge/")],
                     scripts=("robot.js", "wiring.js", "forge.js"),
                     module_scripts=("scan.js",),
                     importmap=THREE_IMPORTMAP,
                     description="The Forge as one conversation: describe a "
                                 "robot, or attach a photo, a parts list, "
                                 "a spec file or a .ply scan. Stages are "
                                 "badged LIVE, LOCAL or RECORDED — only "
                                 "what they earned.")


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
                f'<div class="part" data-part-id="{e(p.id)}" data-q="{e(hay)}">{fig}<h4>{e(p.name)}</h4>'
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
    source_counts = {s: sum(r.source == s for r in dex.robots)
                     for s in SOURCE_TAB_LABEL}
    source_tabs = []
    for source, label in SOURCE_TAB_LABEL.items():
        selected = source == "researched"
        source_tabs.append(
            f'<button class="tab" type="button" role="tab" '
            f'data-sfilter="{e(source)}" '
            f'data-description="{e(SOURCE_DESCRIPTION[source])}" '
            f'aria-selected="{str(selected).lower()}">{e(label)} '
            f'({source_counts[source]})</button>')
    chips = ['<button class="chip" type="button" data-filter="all" '
             f'aria-pressed="true">All ({len(dex.robots)})</button>']
    for s, n in counts.items():
        if n:
            chips.append(f'<button class="chip" type="button" data-filter="{s}" '
                         f'aria-pressed="false">{VERDICT_LABEL[s]} ({n})</button>')
    # Class filters come straight from the ONE taxonomy tree
    # (catalog.MOBILITY_TAXONOMY). A class the Robodex has no robots
    # in yet is shown disabled and labelled "none yet" — the shape of
    # the classification is visible without inventing an entry.
    class_counts = {cls: sum(r.mobility_class == cls for r in dex.robots)
                    for cls, _ in MOBILITY_TAXONOMY}
    class_chips = ['<button class="chip" type="button" data-cfilter="all" '
                   f'aria-pressed="true">All classes '
                   f'({len(dex.robots)})</button>']
    for cls, _subs in MOBILITY_TAXONOMY:
        n = class_counts[cls]
        if n:
            class_chips.append(
                f'<button class="chip" type="button" data-cfilter="{e(cls)}" '
                f'aria-pressed="false">{e(cls)} ({n})</button>')
        else:
            class_chips.append(
                f'<button class="chip" type="button" data-cfilter="{e(cls)}" '
                f'aria-pressed="false" disabled>{e(cls)} — none yet</button>')
    body = f"""<div class="page-head">
  <div>
    <div class="eyebrow">Robots</div>
    <h1>Robodex</h1>
    <p class="lede">Every robot the forge knows, first sorted by how we know it, then by how it moves. Source badges name the evidence behind an entry; gate badges still come only from recorded runs.</p>
  </div>
</div>
<div class="tabs source-tabs" role="tablist" aria-label="Robot source">{"".join(source_tabs)}</div>
<p class="sub source-summary" id="source-summary">{e(SOURCE_DESCRIPTION["researched"])}</p>
<div class="toolbar" role="group" aria-label="Filter by verdict">{"".join(chips)}</div>
<div class="toolbar" role="group" aria-label="Filter by class">{"".join(class_chips)}</div>
<div class="robot-grid" id="robot-grid">
{cards}
</div>
<p class="state-box source-empty" id="robots-empty" hidden>No robots match this source and filter combination yet.</p>
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


def _stability_section(r: RobotEntry) -> str:
    """The static stability check section of a legged robot's page.

    Kept visually and verbally separate from the gate section: this is
    a computation from the spec (support-polygon statics), not a
    simulation run, and it changes nothing about the gate status.
    """
    check = r.static_check()
    if check is None:
        return ""
    rep = _load_check_report(check)
    rows = [
        ("Grade", f"{check.grade}"),
        ("Static tip-over angle (weakest direction)",
         f"{check.tip_angle_deg:.1f}° — {e(check.weakest_direction)}"),
        ("Weakest tip margin",
         f"{check.weakest_margin_mm:.0f} mm from the centre-of-mass "
         "projection to the support-polygon edge"),
    ]
    detail = ""
    if rep:
        res = rep["results"]
        rows.append(("Margin as share of the body's half-extent",
                     f"{res['weakest_margin_pct']:.0f}%"))
        rows.append(("Centre-of-mass height",
                     f"{rep['inputs']['com_height_m']:.3f} m — ASSUMED at "
                     "55% of standing height (printed in the report's "
                     "assumptions, never buried)"))
        rows.append(("Thresholds (v1, printed on the report)",
                     "tip angle ≥ 20° STABLE · 10–20° MARGINAL · "
                     "&lt; 10° UNSTABLE"))
        edges = "".join(
            f"<tr><td>{e(ed['direction'])}</td>"
            f'<td class="num">{ed["margin_mm"]:.0f} mm</td>'
            f'<td class="num">{ed["tip_angle_deg"]:.1f}°</td></tr>'
            for ed in res["edges"])
        assumptions = "".join(f"<li>{e(a)}</li>"
                              for a in rep["assumptions"])
        detail = f"""
  <div class="card" style="margin-top:12px">
    <div class="card-head"><h3 style="font-size:var(--fs-md)">How it was computed</h3></div>
    <p class="muted" style="font-size:var(--fs-sm);margin-top:12px">{e(rep["method"])}</p>
    <p class="muted" style="font-size:var(--fs-sm)"><strong>Support model:</strong> {e(rep["inputs"]["support_model"])}</p>
    <div class="table-scroll" style="margin-top:12px"><table class="data">
      <thead><tr><th>Direction</th><th>Margin</th><th>Tip angle</th></tr></thead>
      <tbody>{edges}</tbody>
    </table></div>
    <p style="font-size:var(--fs-sm);margin-top:12px"><strong>Assumptions</strong> (all of them, as printed in the report):</p>
    <ul class="prov" style="padding-left:18px">{assumptions}</ul>
  </div>"""
    table = "".join(f"<tr><th>{e(k)}</th><td>{v}</td></tr>"
                    for k, v in rows)
    return f"""
<section class="section" id="stability">
  <h2>Static stability check</h2>
  <p class="sub">A computation from this robot's spec — support-polygon statics, not a simulation run and not a gate verdict. It grades how far the robot can tip before its centre of mass passes over its feet. The gate status above is unchanged by it: this robot is still not gated.</p>
  <div class="card">
    {static_badge(check, "lg")}
    <table class="kv" style="margin-top:12px">{table}</table>
    <p class="prov" style="margin-top:12px"><span><strong>Report:</strong> <a href="{REPO_URL}/blob/main/{e(check.report)}"><code>{e(check.report)}</code></a> · checked {e(check.date)} · reproduce with <code>robotforge stability {e(r.spec_file or "")}</code></span></p>
  </div>{detail}
</section>"""


def _harness_section(r: RobotEntry) -> str:
    """The harness checks section of a wired robot's page.

    A third evidence kind, kept apart from gate verdicts and static
    checks: computations over the documented wiring graph. The
    section prints the report's counts (never a blanket pass), its
    findings, and — just as prominently — the data the checks are
    missing, because that gap list is half the deliverable."""
    rep = _harness_report(r)
    if rep is None:
        return ""
    s = rep["summary"]
    by_check = "".join(
        f"<tr><td>{e(name.replace('_', ' '))}</td>"
        f'<td class="num">{counts["CHECKED"]}</td>'
        f'<td class="num">{counts["PARTIAL"]}</td>'
        f'<td class="num">{counts["NOT_CHECKED"]}</td></tr>'
        for name, counts in s["by_check"].items())
    findings = rep.get("findings", [])
    if findings:
        flist = "".join(
            f'<li><strong>[{e(f["severity"])}]</strong> '
            f'{e(f["message"])}</li>' for f in findings)
        findings_html = (f'<p style="font-size:var(--fs-sm);'
                         f'margin-top:12px"><strong>Findings</strong> '
                         f'({len(findings)}):</p>'
                         f'<ul class="prov" style="padding-left:18px">'
                         f'{flist}</ul>')
    else:
        findings_html = ('<p class="muted" style="font-size:var(--fs-sm);'
                         'margin-top:12px">Findings: none — the inputs '
                         'that could be checked raised nothing. That '
                         'is not the same as everything being '
                         'checked; the counts above say how much '
                         'was.</p>')
    missing = s["missing_inputs"]
    if missing:
        mrows = "".join(
            f"<tr><td><code>{e(m['input'])}</code></td>"
            f'<td class="num">{m["count"]}</td>'
            f"<td>{e(', '.join(m['subjects'][:4]))}"
            f"{' …' if len(m['subjects']) > 4 else ''}</td></tr>"
            for m in missing)
        missing_html = f"""
    <p style="font-size:var(--fs-sm);margin-top:12px"><strong>Missing data</strong> — the datasheets still to hunt. A check that could not run says what it needs:</p>
    <div class="table-scroll" style="margin-top:8px"><table class="data">
      <thead><tr><th>Missing input</th><th>Blocks</th><th>Needed by</th></tr></thead>
      <tbody>{mrows}</tbody>
    </table></div>"""
    else:
        missing_html = ""
    return f"""
<section class="section" id="harness">
  <h2>Harness checks</h2>
  <p class="sub">Electrical computations over this robot's documented wiring graph — voltage drop, ampacity, logic levels, rail budgets, connector matching. Not a gate run and not a simulation: each check is Checked, Partial or Not checked, and the headline is counts, never a blanket pass.</p>
  <div class="card">
    {harness_badge(rep, "lg")}
    <p class="muted" style="font-size:var(--fs-sm);margin-top:12px">{e(rep["headline"])}</p>
    <div class="table-scroll" style="margin-top:12px"><table class="data">
      <thead><tr><th>Check</th><th>Checked</th><th>Partial</th><th>Not checked</th></tr></thead>
      <tbody>{by_check}</tbody>
    </table></div>
    {findings_html}{missing_html}
    <p class="prov" style="margin-top:12px"><span><strong>Report:</strong> <a href="{REPO_URL}/blob/main/{e(_harness_report_path(r))}"><code>{e(_harness_report_path(r))}</code></a> · checked {e(rep.get("date", ""))} · reproduce with <code>robotforge harness {e(r.spec_file or "")}</code></span></p>
  </div>
</section>"""


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
        ground = r.mobility_class.startswith("Ground")
        if ground:
            ta_sub = ("Every spec becomes a kit of simple, 3D-printable parts "
                      "(<code>robotforge cad</code>). This viewer lays the kit out "
                      "the way the kit's own assembly file does, straight from the "
                      "spec's numbers — flat views, or in 3D with the toggle. "
                      "Click any part.")
            cmd_lines = (f"robotforge validate {e(r.spec_file)}\n"
                         f"robotforge urdf {e(r.spec_file)} --out build/{slug}.urdf\n"
                         f"robotforge cad {e(r.spec_file)}\n"
                         f"robotforge run-gate {e(r.spec_file)}")
            cmd_sub = "Run these from a clone of the repository."
        else:
            ta_sub = ("This viewer derives a schematic take-apart straight from "
                      "the spec's numbers — the same one-derivation rule as the "
                      "ground kits — flat views, or in 3D with the toggle. It is "
                      "a schematic of the real robot's layout, not a printable "
                      "kit: <code>robotforge cad</code> kits cover ground robots "
                      "only today. Click any part.")
            cmd_lines = (f"robotforge validate {e(r.spec_file)}\n"
                         + (f"robotforge stability {e(r.spec_file)}\n"
                            if r.static_check() else "")
                         + f"robotforge catalog robot {r.number}")
            cmd_sub = ("Run these from a clone of the repository. The twin, CAD "
                       "kit and motion gate (<code>urdf</code> / <code>cad</code> / "
                       "<code>run-gate</code>) cover ground robots today, so "
                       "they are not listed here.")
        if _harness_report(r) is not None:
            cmd_lines += f"\nrobotforge harness {e(r.spec_file)}"
        take_apart = f"""
<section class="section" id="take-apart">
  <h2>Take it apart</h2>
  <p class="sub">{ta_sub}</p>
  <div id="ta" data-spec="{root}{e(r.spec_file)}">
    <div class="state-box">Loading <code>{e(r.spec_file)}</code>&hellip;</div>
  </div>
</section>"""
        commands = f"""
<section class="section" id="commands">
  <h2>Reproduce it</h2>
  <p class="sub">{cmd_sub}</p>
  <div class="codeblock card" style="padding:0;border:0;background:none">
<pre><code>{cmd_lines}</code></pre>
    <button class="btn btn-sm copy" type="button" data-copy>Copy</button>
  </div>
</section>"""
    gate_sub = ("Measured against simulator ground truth at the locked "
                "thresholds: pass ≤ 5% / 5°, fail over 10% / 10°. The gate "
                "tests the spec's simulated twin, not a physical robot.")
    if not gs.runs and not r.mobility_class.startswith("Ground"):
        gate_sub = ("The motion gate covers ground robots today. This class "
                    "has no gate yet, so there is no verdict to show — the "
                    "note below says why, in the entry's own words.")
    jump = ['<a class="chip" href="#spec">Spec</a>', '<a class="chip" href="#gate">Gate runs</a>']
    if r.static_check():
        jump.append('<a class="chip" href="#stability">Static stability</a>')
    harness_rep = _harness_report(r)
    if harness_rep is not None:
        jump.append('<a class="chip" href="#harness">Harness checks</a>')
    if r.spec_file:
        jump += ['<a class="chip" href="#take-apart">Take it apart</a>',
                 '<a class="chip" href="#commands">Reproduce</a>']
    check = r.static_check()
    body = f"""<div class="robot-hero">
  {figure}
  <div>
    <span class="dex">{e(r.dex_id)}</span>
    <h1>{e(r.name)}</h1>
    <div class="cls">{e(r.class_path)}</div>
    <div class="cls faint">{e(r.robot_class)}</div>
    {verdict_badge(gs.status, "lg")}{static_badge(check, "lg") if check else ""}{harness_badge(harness_rep, "lg") if harness_rep else ""}
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
  <p class="sub">{gate_sub}</p>
  <div class="card">{gate}{note}</div>
</section>
{_stability_section(r)}
{_harness_section(r)}
{take_apart}
{commands}"""
    return app_shell(active="robots", title=r.name, depth=3, body=body,
                     crumbs=[("App", "app/forge/"), ("Robots", "app/robots/"),
                             (r.name, f"app/robots/{slug}/")],
                     scripts=("robot.js", "wiring.js") if r.spec_file else (),
                     module_scripts=("robot3d.js",) if r.spec_file else (),
                     importmap=THREE_IMPORTMAP if r.spec_file else "",
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
    harness_rows = []
    for r in dex.robots:
        rep = _harness_report(r)
        if rep is None:
            continue
        s = rep["summary"]
        harness_rows.append(
            f'<tr><td><a href="../robots/{slugify(r.name)}/">{e(r.name)}</a></td>'
            f"<td>{harness_badge(rep)}</td>"
            f'<td class="num">{s["checked_clean"]}</td>'
            f'<td class="num">{s["findings"]["WARN"]}</td>'
            f'<td class="num">{s["findings"]["ERROR"]}</td>'
            f'<td class="num">{s["states"]["PARTIAL"]}</td>'
            f'<td class="num">{s["states"]["NOT_CHECKED"]}</td>'
            f"<td>{e(rep.get('date', ''))}</td>"
            f'<td><a href="{REPO_URL}/blob/main/{e(_harness_report_path(r))}">report</a></td>'
            + "</tr>")
    stab_rows = []
    for r in dex.robots:
        c = r.static_check()
        if c is None:
            continue
        stab_rows.append(
            f'<tr><td><a href="../robots/{slugify(r.name)}/">{e(r.name)}</a></td>'
            f"<td>{static_badge(c)}</td>"
            f'<td class="num">{c.tip_angle_deg:.1f}°</td>'
            f'<td class="num">{c.weakest_margin_mm:.0f} mm</td>'
            f"<td>{e(c.weakest_direction)}</td>"
            f"<td>{e(c.date)}</td>"
            f'<td><a href="{REPO_URL}/blob/main/{e(c.report)}">report</a></td>'
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
</section>

<section class="section" id="stability-checks">
  <h2>Static stability checks</h2>
  <p class="sub">A different kind of evidence, kept separate from the gate reports above: for the legged robots, a computation from the spec — the support polygon its feet make, and how far the robot can tip before its centre of mass passes over the edge. Nothing here was simulated or driven, and a static check never changes a gate verdict: every robot below is still <strong>Not gated</strong>. Method, inputs and assumptions are printed in each report.</p>
  <div class="card" style="padding:8px 8px 4px"><div class="table-scroll"><table class="data">
    <thead><tr><th>Robot</th><th>Static check</th><th>Tip angle</th><th>Weakest margin</th><th>Direction</th><th>Checked</th><th>Report</th></tr></thead>
    <tbody>{"".join(stab_rows)}</tbody>
  </table></div></div>
</section>

<section class="section" id="harness-checks">
  <h2>Harness checks</h2>
  <p class="sub">A third kind of evidence, kept separate from gate runs and static checks: electrical computations over each robot's documented wiring graph — voltage drop, ampacity, logic levels, rail budgets, connector matching. The headline is never a blanket pass; it is counts. A check that could not run says which data it is missing, and that gap list is printed in full on each robot's page: it is the shopping list of datasheets still to hunt.</p>
  <div class="card" style="padding:8px 8px 4px"><div class="table-scroll"><table class="data">
    <thead><tr><th>Robot</th><th>Harness checks</th><th>Clean</th><th>Warn</th><th>Err</th><th>Partial</th><th>Not checked</th><th>Date</th><th>Report</th></tr></thead>
    <tbody>{"".join(harness_rows)}</tbody>
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
        "assets/js/live-config.js": render_live_config(),
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
