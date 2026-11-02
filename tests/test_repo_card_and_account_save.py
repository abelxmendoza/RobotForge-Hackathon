"""Repo card pictures and the Save-to-account button.

- A repo's card shows pictures the user picked from that repo's own
  images, only while the license gate lets them be displayed, and
  always credited as the repo's images, not the user's build.
- Save copies this browser's Workshop stores to the signed-in account
  through the Worker's /account/* routes (tests/worker_mock.mjs runs
  the route itself). The demo never saves or loads.
"""
from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web-next" / "src"

RUN = r"""
import { cardImagesOf, toggleCardImage } from "./cards.ts";
const imgs = [1, 2, 3].map((i) => ({ url: "u" + i, path: "p" + i, alt: "", via: "tree" }));
const base = { images: imgs, imagesAttested: false, provenance: { license: { family: "permissive", label: "MIT" } } };
const out = {};
let picked = toggleCardImage(undefined, "u2");
picked = toggleCardImage(picked, "u3");
out.picked = picked;
out.cover = toggleCardImage(picked, "u3", true);
out.off = toggleCardImage(out.cover, "u3");
out.shown = cardImagesOf({ ...base, cardImages: ["u3", "gone", "u1"] }).map((x) => x.url);
out.gated = cardImagesOf({ ...base, cardImages: ["u1"], provenance: { license: { family: "none", label: "No license" } } }).length;
out.attested = cardImagesOf({ ...base, imagesAttested: true, cardImages: ["u1"], provenance: { license: { family: "none", label: "No license" } } }).length;
process.stdout.write(JSON.stringify(out));
"""


def _slice(src: str, start: str, end: str) -> str:
    i = src.index(start)
    return src[i:src.index(end, i)]


def test_card_picture_helpers(tmp_path: Path) -> None:
    src = (WEB / "lib" / "repoImport.ts").read_text()
    gate = _slice(src, "export function imageGate", "\n}\n") + "\n}\n"
    cards = _slice(src, "export function cardImagesOf", "export function repoUrl")
    (tmp_path / "cards.ts").write_text(
        "type LicenseInfo = any; type RepoImage = any; type RepoSpecimen = any;\n" + gate + cards)
    (tmp_path / "package.json").write_text('{"type": "module"}')
    (tmp_path / "run.mjs").write_text(RUN)
    proc = subprocess.run(["node", "--experimental-strip-types", "run.mjs"],
                          cwd=tmp_path, capture_output=True, text=True, timeout=60)
    assert proc.returncode == 0, proc.stderr[-2000:]
    out = json.loads(proc.stdout)
    assert out["picked"] == ["u2", "u3"]
    assert out["cover"] == ["u3", "u2"]
    assert out["off"] == ["u2"]
    # Picks no longer in the repo's image list are dropped, order kept.
    assert out["shown"] == ["u3", "u1"]
    # Not a permissive license and no attestation: nothing on the card.
    assert out["gated"] == 0 and out["attested"] == 1


def test_import_gallery_and_workshop_card() -> None:
    imp = (WEB / "components" / "import" / "RepoImport.tsx").read_text()
    assert "Show on card" in imp and "Make cover" in imp and 'id="repo-images"' in imp
    garage = (WEB / "components" / "garage" / "Garage.tsx").read_text()
    assert "cardImagesOf(x)" in garage
    assert "not your build" in garage  # credit line on the card
    assert "#repo-images" in garage


def test_save_button_and_load_from_account() -> None:
    sync = (WEB / "lib" / "accountSync.ts").read_text()
    worker = (ROOT / "live" / "worker.js").read_text()
    client_keys = re.findall(r"'(rf\.[a-z]+\.v1)'", _slice(sync, "ACCOUNT_DATA_KEYS", "];"))
    worker_keys = re.findall(r"'(rf\.[a-z]+\.v1)'", _slice(worker, "const ACCOUNT_DATA_KEYS", "];"))
    assert client_keys == worker_keys and len(client_keys) == 5
    assert "isDemoMode()" in sync  # the demo never saves or loads
    save = (WEB / "components" / "shell" / "AccountSave.tsx").read_text()
    assert "if (!session || inDemo) return null;" in save
    shell = (WEB / "components" / "shell" / "AppShell.tsx").read_text()
    assert "<AccountSave />" in shell
    acct = (WEB / "components" / "shell" / "AccountControl.tsx").read_text()
    assert "Load from account" in acct and "Yes, load it" in acct
    assert "no cloud sync yet" not in acct
    # One write per save, a daily cap and a size cap at the Worker.
    assert "ACCOUNT_SAVES_PER_DAY = 50" in worker
    assert "ACCOUNT_DATA_MAX_BYTES = 5 * 1024 * 1024" in worker
