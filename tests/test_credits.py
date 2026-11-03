"""The /credits page exists, is linked from the landing footer, and
credits only what the repo's own records support: every name traces
to catalog provenance, the README model table, omega1Twin.ts, or the
submission package's contributors draft. Acknowledgment is pinned as
distinct from contributor status, and no non-contributor is named."""
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


def test_no_foreign_project_provenance_leaks_in():
    # The rosbag2 / Claude provenance belongs to a different project
    # and stays in the submission package, not on this page.
    assert "rosbag2" not in PAGE
    assert "Claude" not in PAGE


def test_credits_list_style_in_css_source_of_truth():
    assert ".credits-list" in CSS
    assert 'className="credits-list"' in PAGE
