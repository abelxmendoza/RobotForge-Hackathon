"""Submitting a robot through Wrench's composer (2026-11-01): a GitHub
repo link in a chat message opens the repo importer with that repo,
and the importer starts the import from its ?repo= parameter."""
from pathlib import Path

WEB = Path(__file__).resolve().parent.parent / "web-next" / "src"


def test_composer_routes_repo_links_to_the_importer():
    dock = (WEB / "components/chat/ChatDock.tsx").read_text()
    assert "repoLinkIn(q)" in dock
    assert "'/import/?repo='" in dock
    # The link check runs before the command grammar and the answer
    # engine, so a pasted link is never answered as a question.
    assert dock.index("repoLinkIn(q)") < dock.index("if (runCommands(q)) return;")
    # The operations help says how to submit a robot.
    assert "Submit a robot: paste its GitHub repo link" in dock


def test_importer_starts_from_the_repo_param():
    imp = (WEB / "components/import/RepoImport.tsx").read_text()
    assert '.get("repo")' in imp
    assert "runImport(autoRepo)" in imp


def test_only_explicit_github_links_count():
    link = (WEB / "lib/repoLink.ts").read_text()
    assert "github\\.com" in link
    assert "parseRepoInput" in link
