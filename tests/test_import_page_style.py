"""The /import/ page is styled: its buttons use the shared .btn classes
and app.css carries rules for the form, sections, gallery and parts
table (it shipped with none, so the page rendered browser defaults)."""
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SRC = (REPO / "web-next/src/components/import/RepoImport.tsx").read_text()
CSS = (REPO / "assets/css/app.css").read_text()


def test_import_buttons_use_shared_button_classes():
    assert 'className="primary"' not in SRC
    assert 'className="btn btn-primary"' in SRC


def test_import_page_has_css_rules():
    for sel in (".repo-import > form", ".repo-import-detail section",
                ".repo-gallery", ".repo-parts"):
        assert sel in CSS, sel


def test_phone_layout_keeps_the_quantity_visible():
    phone = CSS.split(".repo-parts thead{display:none}", 1)[1].split("}\n}", 1)[0]
    assert "nth-child(2){display:none}" not in phone
    assert 'content:"Qty "' in phone
