"""Generated site tests: the app pages carry true badges and measured
numbers, the shell's navigation lives in one place, and the committed
pages match what `robotforge site` would write today."""
import tempfile
from pathlib import Path

from robotforge.catalog import Catalog, Robodex
from robotforge.site import (APP_NAV, LEGACY_REDIRECTS, ROBOTS_END,
                             ROBOTS_START, build_site, render_evidence,
                             render_forge, render_robot_page,
                             render_robots_index, slugify, update_landing)

REPO = Path(__file__).resolve().parent.parent
dex = Robodex.load()
cat = Catalog.load()

LABEL = {"PASS": ">Pass<", "MARGINAL": ">Marginal<", "FAIL": ">Fail<",
         "NOT_GATED": ">Not gated<"}


def _cards(page):
    return page.split('<a class="robot-card"')[1:]


def test_robots_index_shows_every_robot_with_its_true_badge():
    cards = _cards(render_robots_index(dex, cat))
    assert len(cards) == len(dex.robots)
    for r in dex.robots:
        card = next(c for c in cards if f'href="{slugify(r.name)}/"' in c)
        status = r.gate_status.status
        assert f'data-status="{status}"' in card
        assert LABEL[status] in card
        for other, label in LABEL.items():
            if other != status:
                assert label not in card, (r.name, other)


def test_robot_pages_show_measured_numbers_and_take_apart():
    for r in dex.robots:
        page = render_robot_page(r)
        assert r.name in page
        for run in r.gate_status.runs:
            assert f"{run.drive_error_pct:.3f}%" in page
        if not r.gate_status.runs:
            assert "No recorded gate runs yet" in page
        if r.spec_file:
            assert f'data-spec="../../../{r.spec_file}"' in page


def test_app_shell_nav_marks_only_the_current_destination():
    pages = {"forge": render_forge(), "robots": render_robots_index(dex, cat),
             "evidence": render_evidence(dex)}
    for active, page in pages.items():
        for vid, label, href, _ in APP_NAV:
            assert f'href="../../app/{href}"' in page
        nav = page.split('<nav class="side-nav"')[1].split("</nav>")[0]
        assert nav.count('aria-current="page"') == 1
        current = nav.split('aria-current="page"')[0].rsplit("<a ", 1)[1]
        assert dict((v, h) for v, _, h, _ in APP_NAV)[active] in current


def test_app_pages_link_back_to_the_landing_page_not_its_nav():
    page = render_forge()
    assert "&larr; RobotForge site" in page
    # The landing page's section links never appear inside the app.
    assert "#workflow" not in page and "#proof" not in page


def test_landing_robot_row_is_regenerated_between_markers():
    landing = (REPO / "index.html").read_text()
    assert ROBOTS_START in landing and ROBOTS_END in landing
    stale = landing.replace("<h3>Pathfinder</h3>", "<h3>Stale</h3>")
    fresh = update_landing(stale, dex)
    assert "<h3>Stale</h3>" not in fresh and "<h3>Pathfinder</h3>" in fresh
    assert fresh.count('class="robot-card"') == len(dex.robots)


def test_committed_pages_match_the_generator():
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp)
        (out / "index.html").write_text((REPO / "index.html").read_text())
        for p in build_site(out, dex, cat):
            rel = p.relative_to(out)
            committed = REPO / rel
            assert committed.exists(), f"{rel} missing: run `robotforge site`"
            assert committed.read_text() == p.read_text(), \
                f"{rel} is stale: run `robotforge site`"


def test_parts_catalogue_renders_an_illustration_per_part():
    page = render_robots_index(dex, cat)
    assert page.count('class="pfig"') == len(cat.parts)
    for p in cat.parts.values():
        assert f'src="../../{p.image}"' in page, p.id
    # Graceful degradation: until an image file is on the site, its
    # figure removes itself — no broken-image icons.
    assert 'onerror="this.parentElement.remove()"' in page
    assert "AI illustration" in page


def test_legacy_urls_redirect_into_the_app():
    for old, (target, _) in LEGACY_REDIRECTS.items():
        page = (REPO / old).read_text()
        assert f'url={target}' in page
        assert target.startswith("app/")


def test_app_pages_carry_the_docked_chat_rail_landing_keeps_the_widget():
    # App pages: the Forge Guide is a persistent left rail in the
    # shell (Muse-style), not the floating bubble.
    for page in (render_forge(), render_robots_index(dex, cat),
                 render_evidence(dex)):
        assert '<div class="forge-chat docked" id="forge-chat">' in page
        assert 'id="fc-panel"' in page and 'id="fc-form"' in page
    # The landing page keeps the floating widget between its markers.
    landing = (REPO / "index.html").read_text()
    block = landing.split(CHAT_START := "<!-- chat:start -->")[1] \
        .split("<!-- chat:end -->")[0]
    assert 'class="forge-chat"' in block and "docked" not in block
