"""The /credits page exists, is linked from the landing footer, and
credits only what the repo's own records support: every name traces
to catalog provenance, the parts catalogue's source records, the
live Worker's web and sign-in routes, the README model table,
omega1Twin.ts, or the submission package's contributors draft.
Acknowledgment is pinned as distinct from contributor status, and
no non-contributor is named."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGE_PATH = ROOT / "web-next/src/app/credits/page.tsx"
PAGE = PAGE_PATH.read_text()
CHROME = (ROOT / "web-next/src/components/home/LandingChrome.tsx").read_text()
CSS = (ROOT / "assets/css/app.css").read_text()
ROBOTS = (ROOT / "catalog/robots.json").read_text()


def test_credits_route_exists():
    assert PAGE_PATH.is_file()
    assert 'title: "Credits"' in PAGE
    # Same fine-print pattern as /privacy and /data-deletion: public
    # page, no account gate.
    assert 'gate={false}' in PAGE
    assert 'crumbs={[{ label: "Credits" }]}' in PAGE


def test_footer_links_to_credits():
    footer = CHROME.split("export function LandingFooter()")[1]
    assert 'href="/credits/"' in footer
    assert ">Credits</Link>" in footer


def test_solo_contributor_and_acknowledgment_split():
    assert "Abel Mendoza" in PAGE
    assert "the only human contributor" in PAGE
    assert "acknowledgment, not team membership" in PAGE
    # A prospective helper who never replied or contributed is not
    # credited anywhere on the site.
    assert "Rachel Yu" not in PAGE


def test_ai_and_workshops_credited():
    assert "Muse Spark" in PAGE
    assert "Torque" in PAGE
    assert "SAM 3.1" in PAGE
    assert "Agents 101" in PAGE
    assert "Agents 102" in PAGE
    assert "Fireworks: Muse Open Models" in PAGE


def test_catalogue_robots_match_the_robodex():
    # Every catalogued robot is named on the page, and every maker
    # credited there is one the catalogue's provenance records.
    for name in (
        "Andino", "TurtleBot3 Burger", "TurtleBot3 Waffle Pi",
        "Pathfinder", "PX4 X500", "Crazyflie 2.1", "Unitree Go2",
        "Mini Pupper", "Unitree G1", "ROBOTIS OP3",
        "OpenManipulator-X",
    ):
        assert name in ROBOTS, name  # really in the catalogue data
        assert name in PAGE, name  # and credited on the page
    for maker in ("Ekumen", "ROBOTIS", "Holybro", "Bitcraze",
                  "Unitree", "MangDang"):
        assert maker in PAGE, maker
    # Spot is a Spotter sighting (Cal Poly Pomona IRLab, Oct 28,
    # 2026), credited as such — never as a catalogue entry.
    assert "Boston Dynamics Spot is not a catalogue entry" in PAGE
    assert "Spotter sighting" in PAGE


def test_omega1_twin_and_services_credited():
    assert "Freenove FNK0043" in PAGE
    assert "ProjectSim (Kaedim)" in PAGE
    # The twin stays labelled an estimate on the credits page too.
    assert "ESTIMATED" in PAGE
    assert "not measurements of the real robot" in PAGE
    for service in ("Vercel", "Cloudflare Worker", "Baseten",
                    "Fireworks"):
        assert service in PAGE, service


def test_open_source_and_photos_credited():
    for piece in ("Next.js", "React", "Three.js", "Rapier",
                  "urdf-loader", "Apache-2.0"):
        assert piece in PAGE, piece
    assert "credited on their own pages" in PAGE


def test_sources_we_cite_credited():
    # The "Sources we cite" section names only sources the repo's
    # own records actually use: Firecrawl runs the Worker's /web
    # route, the parts catalogue's records name Pololu / Toshiba
    # for the TB6612FNG and polymaker.com for the filament prices,
    # and the Worker exposes Google and Meta sign-in.
    parts = (ROOT / "catalog/parts.json").read_text()
    worker = (ROOT / "live/worker.js").read_text()
    assert "Sources we cite" in PAGE
    assert "Firecrawl" in worker and "Firecrawl" in PAGE
    assert "grounds live chat answers in real pages" in PAGE
    assert "source URL and the time it was fetched" in PAGE
    assert "WEB-SOURCED — UNVERIFIED" in PAGE
    for name in ("Pololu", "Toshiba", "TB6612FNG"):
        assert name in parts, name  # really in the catalogue data
        assert name in PAGE, name  # and credited on the page
    assert "polymaker.com" in parts
    assert "Polymaker" in PAGE
    # Sign-in routes the endpoint actually exposes.
    assert "googleLogin" in worker and "metaLogin" in worker
    assert "Google or Meta" in PAGE
    # Planned but never used — not credited.
    assert "Roboflow" not in PAGE


def test_no_foreign_project_provenance_leaks_in():
    # The rosbag2 / Claude provenance belongs to a different project
    # and stays in the submission package, not on this page.
    assert "rosbag2" not in PAGE
    assert "Claude" not in PAGE


def test_credits_list_style_in_css_source_of_truth():
    assert ".credits-list" in CSS
    assert 'className="credits-list"' in PAGE


APP_SHELL = (ROOT / "web-next/src/components/shell/AppShell.tsx").read_text()
CREDITS_IMG = ROOT / "assets/img/credits"


def test_sidebar_foot_links_to_credits():
    # Abel's ask: Credits lives at the bottom of the app sidebar,
    # alongside the two links already there (and copied in his
    # message): How it works and GitHub.
    foot = APP_SHELL.split('className="side-foot"')[1].split("</div>")[0]
    assert 'href="/how-it-works/"' in foot
    assert "GitHub" in foot
    assert 'href="/credits/"' in foot
    assert ">Credits</Link>" in foot
    # The credits page lights the link up like How it works does.
    assert 'active="credits"' in PAGE
    assert 'active === "credits"' in APP_SHELL


def test_credits_page_is_visual():
    # Founder portrait (already in the repo for the landing's
    # Why-I-built section) and the catalogue's own part photos
    # for the cited sources.
    assert "assets/img/abel-founder.jpg" in PAGE
    assert "assets/img/parts/driver_tb6612fng.jpg" in PAGE
    assert "assets/img/parts/pla_filament.jpg" in PAGE
    # Abel's call: the credits page does NOT re-show the Robodex
    # robots or Omega1 — their photos live on their own pages,
    # and repeating them here is duplication. Credit is words
    # and logos here.
    assert "credits-gallery" not in PAGE
    assert "robotImage" not in PAGE
    assert "omega1-real-photo" not in PAGE
    assert "omega1-rover-preview" not in PAGE
    # Visual styles live in the CSS source of truth.
    for cls in (".credits-tiles", ".credits-founder",
                ".credits-tile-stage--dark"):
        assert cls in CSS, cls


def test_credits_logos_and_illustrations_exist():
    # Every logo / illustration file the page references is a real
    # file in the repo (brand marks via Simple Icons, Freenove's
    # from freenove.com, the rest drawn for RobotForge), so no
    # tile renders as a broken image.
    import re
    refs = set(re.findall(r"(?:logo|art)=\"([a-z0-9\-]+\.(?:svg|png))\"", PAGE))
    refs |= set(re.findall(r"assets/img/credits/([a-z0-9\-]+\.(?:svg|png))", PAGE))
    assert len(refs) >= 12
    for name in refs:
        f = CREDITS_IMG / name
        assert f.is_file(), name
        if name.endswith(".svg"):
            assert f.read_text().lstrip().startswith("<svg"), name
        else:
            assert f.read_bytes()[:4] == b"\x89PNG", name
    # Freenove is credited with its real logo (the white wordmark
    # from freenove.com, on the dark tile stage), never a word
    # tile or a redraw.
    assert 'logo="logo-freenove.png"' in PAGE
    assert "dark" in PAGE.split('logo="logo-freenove.png"')[1].split("/>")[0]
    assert "freenove.com" in PAGE
    # The page says plainly which tiles are RobotForge drawings,
    # not the companies' own artwork.
    assert "illustrations drawn for RobotForge" in PAGE
    assert "Simple Icons (CC0)" in PAGE
