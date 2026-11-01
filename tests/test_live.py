"""Live-endpoint tests: the Cloudflare Worker and its mirrors of
the Python sources of truth, the site wiring (config constant,
script order, Guide live routing, the Forge chat surface and its
badges), and the browser validator subset against fixture specs.

No network, no real keys: the Worker is exercised through
tests/worker_mock.mjs with stubbed upstreams (skipped when node is
unavailable), and its embedded prompt/schema/catalogue mirrors are
compared byte-for-byte with the Python they mirror.
"""
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "src"))

from robotforge import schema, site  # noqa: E402
from robotforge.catalog import Catalog, Robodex  # noqa: E402
from robotforge.describe import SYSTEM_PROMPT  # noqa: E402
from robotforge.photo import DOCUMENT_INSTRUCTIONS, PHOTO_INSTRUCTIONS  # noqa: E402
from robotforge.schema import RobotSpec  # noqa: E402
from robotforge.validate import validate as py_validate  # noqa: E402

WORKER = (REPO / "live" / "worker.js").read_text()
CHAT_JS = (REPO / "assets" / "js" / "chat.js").read_text()
ENGINE_JS = (REPO / "assets" / "js" / "chat-engine.js").read_text()
FORGE_JS = (REPO / "assets" / "js" / "forge.js").read_text()
NODE = shutil.which("node")


def _between(text, begin, end):
    m = re.search(re.escape(begin) + r"(.*?)" + re.escape(end), text, re.S)
    assert m, f"markers {begin}..{end} not found"
    return m.group(1)


def _node_check(source, name):
    if not NODE:
        return
    with tempfile.TemporaryDirectory() as tmp:
        p = Path(tmp) / (name + ".mjs")
        p.write_text(source)
        r = subprocess.run([NODE, "--check", str(p)],
                           capture_output=True, text=True)
        assert r.returncode == 0, f"{name}: {r.stderr}"


# ------------------------------------------------------------------
# site wiring: the config constant and script order
# ------------------------------------------------------------------

def test_endpoint_constant_is_empty_by_default():
    assert site.LIVE_ENDPOINT == ""
    committed = (REPO / "assets" / "js" / "live-config.js").read_text()
    assert committed == site.render_live_config()
    assert "endpoint: ''" in committed


def test_live_config_loads_before_the_chat_and_forge():
    dex, cat = Robodex.load(), Catalog.load()
    pages = [site.render_forge(), site.render_robots_index(dex, cat),
             site.render_evidence(dex)]
    for page in pages:
        assert "assets/js/live-config.js" in page
        assert page.index("assets/js/live-config.js") < \
            page.index("assets/js/chat.js")
    forge = pages[0]
    # the Forge's take-apart stage reuses robot.js's builders
    assert forge.index("assets/js/robot.js") < forge.index("assets/js/forge.js")
    landing = (REPO / "index.html").read_text()
    assert "assets/js/live-config.js" in landing
    assert landing.index("assets/js/live-config.js") < \
        landing.index("assets/js/chat-engine.js")


# ------------------------------------------------------------------
# Worker mirrors of the Python sources of truth
# ------------------------------------------------------------------

def test_worker_describe_prompt_matches_python():
    embedded = _between(WORKER, "/*PROMPT_BEGIN*/`", "`/*PROMPT_END*/")
    assert embedded == SYSTEM_PROMPT


def test_worker_photo_prompt_matches_python():
    embedded = _between(WORKER, "/*PHOTO_PROMPT_BEGIN*/`",
                        "`/*PHOTO_PROMPT_END*/")
    assert embedded == SYSTEM_PROMPT + PHOTO_INSTRUCTIONS


def test_worker_document_prompt_matches_python():
    embedded = _between(WORKER, "/*DOC_PROMPT_BEGIN*/`",
                        "`/*DOC_PROMPT_END*/")
    assert embedded == SYSTEM_PROMPT + DOCUMENT_INSTRUCTIONS
    assert "drawing scale" in embedded
    # document mode rides the /photo route with document_read marking
    assert "document_read" in WORKER and "mode === 'document'" in WORKER
    assert "validateSpecPartial" in WORKER
    assert "Document draft (values transcribed from the document)" \
        in WORKER


def test_worker_spec_schema_matches_python():
    embedded = json.loads(_between(WORKER, "/*SPEC_SCHEMA_BEGIN*/",
                                   "/*SPEC_SCHEMA_END*/"))
    assert embedded["required_top"] == [
        "name", "drivetrain", "length_m", "width_m", "height_m",
        "mass_kg", "motor", "battery"]
    assert embedded["ground_required_top"] == ["ground_clearance_m", "wheel"]
    assert embedded["ground_drivetrains"] == list(schema.GROUND_DRIVETRAINS)
    assert embedded["class_required_top"] == {
        "multirotor": ["rotors"], "quadruped": ["legs"],
        "humanoid": ["legs", "arms"], "robotic_arm": ["arms"]}
    assert embedded["required_nested"] == {
        "wheel": ["diameter_m", "width_m", "count"],
        "motor": ["kind", "voltage_v", "count"],
        "battery": ["chemistry", "voltage_v", "capacity_mah"],
        "rotors": ["count", "prop_diameter_m"],
        "legs": ["count"], "arms": ["count"]}
    assert embedded["drivetrains"] == list(schema.DRIVETRAINS)
    assert embedded["sensor_kinds"] == list(schema.SENSOR_KINDS)


def test_worker_parts_mirror_matches_the_catalogue():
    embedded = json.loads(_between(WORKER, "/*PARTS_BEGIN*/",
                                   "/*PARTS_END*/"))
    parts = json.loads((REPO / "catalog" / "parts.json").read_text())["parts"]
    assert embedded == [{"id": p["id"], "name": p["name"]} for p in parts]
    assert len(embedded) == 50


# ------------------------------------------------------------------
# Worker guardrails and secrets discipline
# ------------------------------------------------------------------

def test_worker_guardrails_and_routes_present():
    for bit in ("abelxmendoza.github.io", "budget_exhausted",
                "rate_limited", "guardrail_error", "LIVE_ENABLED",
                "RF_LIVE_KV", "/describe", "/chat", "/list", "/photo",
                "photo_not_configured", "routes", "/transcribe",
                "transcribe_not_configured", "muse-voice-transcribe-1.0"):
        assert bit in WORKER, bit
    # photo is the optional route: 501 when its secret is absent
    assert "501" in WORKER and "env.META_API_KEY" in WORKER


def test_keys_live_only_as_worker_secrets():
    assert "env.BASETEN_API_KEY" in WORKER
    assert "env.META_API_KEY" in WORKER
    # no bearer value is ever written literally
    assert not re.search(r"Bearer [A-Za-z0-9_\-]{8,}", WORKER)
    example = (REPO / "live" / ".dev.vars.example").read_text()
    for line in example.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        key, _, value = line.partition("=")
        assert "placeholder" in value and "redacted" in value, \
            f".dev.vars.example holds a real-looking value: {key}"
    gitignore = (REPO / "live" / ".gitignore").read_text()
    assert ".dev.vars" in gitignore


def test_worker_and_site_js_parse():
    _node_check(WORKER, "worker")
    _node_check(CHAT_JS, "chat")
    _node_check(ENGINE_JS, "chat-engine")
    _node_check(FORGE_JS, "forge")
    _node_check(site.render_live_config(), "live-config")


def test_worker_mock_suite():
    if not NODE:
        return
    r = subprocess.run([NODE, str(REPO / "tests" / "worker_mock.mjs")],
                       capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr
    for name in ("photo without the Meta key is a 501",
                 "ESTIMATED framing",
                 "budget exhausted is a 503",
                 "list happy path sanitizes",
                 "document mode transcribes",
                 "document mode rejects",
                 "malformed model output is a 502"):
        assert "PASS " + name.split(" is a 501")[0] in r.stdout or \
            name in r.stdout, name


# ------------------------------------------------------------------
# Forge Guide live routing
# ------------------------------------------------------------------

def test_guide_routes_only_fallbacks_to_the_live_model():
    assert "endpoint: ''" in ENGINE_JS  # the legacy hook stays empty
    assert "fallback: true" in ENGINE_JS
    assert "ans.fallback" in CHAT_JS
    assert "'/health'" in CHAT_JS and "'/chat'" in CHAT_JS
    assert "window.RF_LIVE" in CHAT_JS
    badge = ("LIVE MODEL — not from recorded RobotForge data; "
             "check numbers on the Evidence page")
    assert badge in CHAT_JS
    # the local recorded answer is computed before any live attempt
    assert CHAT_JS.index("var ans = localAnswer(q)") < \
        CHAT_JS.index("liveChat(q).then")


# ------------------------------------------------------------------
# Forge chat surface: shell, badges, per-input behavior
# ------------------------------------------------------------------

def test_forge_page_is_a_chat_with_three_attach_actions():
    page = site.render_forge()
    for bit in ('id="forge-thread"', 'id="forge-composer"',
                'id="forge-input"', 'id="att-photo"', 'id="att-doc"',
                'id="att-spec"', 'id="file-photo"', 'id="file-doc"',
                'id="file-spec"', 'id="forge-status"',
                'data-sample="words"', 'data-sample="photo"',
                'data-sample="list"',
                "Files stay in your browser unless you run a live step"):
        assert bit in page, bit


def test_forge_thread_renders_the_three_badge_types():
    for badge in ("live: 'LIVE'", "local: 'LOCAL'", "recorded: 'RECORDED'"):
        assert badge in FORGE_JS, badge
    assert "fbadge" in FORGE_JS
    # recorded stages are labeled with their run's date
    assert "dateLabel" in FORGE_JS and "Recorded Oct 26, 2026" in FORGE_JS


def test_forge_input_flows_are_honest_per_mode():
    # text -> live describe, else the recorded words run
    assert "'/describe'" in FORGE_JS and "playSample('words')" in FORGE_JS
    # spec upload is fully local: browser checks + the shared viewer
    assert "forgeValidateSpec" in FORGE_JS
    assert "browser checks (subset of the full validator)" in FORGE_JS
    assert "taBuildParts" in FORGE_JS and "taRenderSide" in FORGE_JS
    # the gate is never simulated client-side
    assert "no verdict is simulated here" in FORGE_JS
    # photo: live /photo or the recorded SAMPLE, photo shown either way
    assert "'/photo'" in FORGE_JS and "createObjectURL" in FORGE_JS
    assert "was sent nowhere" in FORGE_JS
    assert "downscale" in FORGE_JS  # photos shrink before any live send
    # parts list: live /list or the recorded run
    assert "'/list'" in FORGE_JS and "sampleOffer('list'" in FORGE_JS
    # waiting states show real elapsed time, never fake progress
    assert "startTimer" in FORGE_JS and "performance.now" in FORGE_JS


# ------------------------------------------------------------------
# Forge: document mode + scan attach
# ------------------------------------------------------------------

def test_forge_page_has_scan_attach_document_sample_and_3d_module():
    page = site.render_forge()
    for bit in ('id="att-scan"', 'id="file-scan"',
                'data-sample="document"',
                "Document &mdash; TurtleBot3 spec sheet",
                'assets/js/scan.js', 'type="importmap"'):
        assert bit in page, bit


def test_forge_photo_asks_robot_or_document_before_sending():
    assert "data-pmode" in FORGE_JS
    assert "Spec sheet or blueprint" in FORGE_JS
    assert "choosePhotoMode" in FORGE_JS
    # document mode posts mode=document to the same /photo route
    assert "mode: 'document'" in FORGE_JS
    # offline: the document is NOT read and the recorded run is offered
    assert "Your document was not read" in FORGE_JS
    assert "sampleOffer('document'" in FORGE_JS
    assert "Play the recorded document run" in FORGE_JS
    # the draft wears the document banner, never the estimated one
    assert "Document draft — values transcribed from the document; " \
           "verify against the source" in FORGE_JS
    assert "DOCUMENT-READ" in FORGE_JS
    # unbacked numbers dropped by the endpoint are surfaced, not hidden
    assert "Dropped as unbacked" in FORGE_JS


def test_forge_document_recorded_run_is_real_and_scored():
    run = json.loads((REPO / "examples" /
                      "document-turtlebot3-burger.json").read_text())
    assert run["kind"] == "document_run"
    assert run["complete"] is True
    assert run["score"]["total"] == 10
    assert 0 <= run["score"]["exact"] <= 10
    for row in run["score"]["rows"]:
        assert row["match"] == (row["got"] == row["expected"])
    # the input was an image of printed values, hash-recorded
    assert len(run["input"]["png_sha256"]) == 64
    assert run["input"]["display_svg"].endswith(".svg")
    assert (REPO / run["input"]["display_svg"]).exists()
    assert "document" in FORGE_JS and "document-turtlebot3-burger" \
        in FORGE_JS
    # the run card prints the score, whatever it is
    assert "printed values transcribed exactly" in FORGE_JS


def test_forge_scan_flow_is_local_measured_and_seeds_honestly():
    for bit in ("runScan", "RFScan", "parsePly", "measureCloud",
                "MEASURED (scan)",
                "bounding box of the uploaded point cloud",
                "depth scans arrive measured",
                "Seed a draft spec with these dimensions",
                "shape and size only",
                "not</strong> been run through the checks"):
        assert bit in FORGE_JS, bit
    # a scan is never sent to the live endpoint
    assert "postJSON('/scan'" not in FORGE_JS
    assert '"/scan"' not in FORGE_JS


# ------------------------------------------------------------------
# Browser validator subset vs the Python validator (fixtures)
# ------------------------------------------------------------------

def _run_forge_validator(specs):
    """Run forge.js's extracted validator block in node over the
    given spec dicts; returns the parsed results."""
    block = _between(FORGE_JS, "/* == forge-validate:start == */",
                     "/* == forge-validate:end == */")
    driver = (
        "import fs from 'node:fs';\n" + block + "\n"
        "globalThis.__fv = forgeValidateSpec;\n"
        "const specs = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));\n"
        "console.log(JSON.stringify(specs.map(s => globalThis.__fv(s))));\n")
    with tempfile.TemporaryDirectory() as tmp:
        dp = Path(tmp) / "driver.mjs"
        sp = Path(tmp) / "specs.json"
        dp.write_text(driver)
        sp.write_text(json.dumps(specs))
        r = subprocess.run([NODE, str(dp), str(sp)],
                           capture_output=True, text=True)
        assert r.returncode == 0, r.stderr
        return json.loads(r.stdout)


def test_forge_validator_matches_python_on_fixture_specs():
    if not NODE:
        return
    names = ["indoor-delivery-rover.json", "broken-indoor-rover.json"]
    specs = [json.loads((REPO / "examples" / n).read_text()) for n in names]
    results = _run_forge_validator(specs)
    for name, spec, res in zip(names, specs, results):
        expected = [f"[{f.severity}] {f.check}: {f.message}"
                    for f in py_validate(RobotSpec.from_dict(spec))]
        assert res["lines"] == expected, (name, res["lines"], expected)
        assert res["schemaErrors"] is False
    # the known-broken spec fails, with the clearance ERROR first
    assert results[1]["errors"] is True
    assert results[1]["lines"][0].startswith(
        "[ERROR] geometry.clearance_vs_wheel")
    # the valid spec passes clean
    assert results[0]["lines"] == \
        ["[INFO] all: spec passed all engineering checks"]


def test_forge_validator_flags_schema_problems():
    if not NODE:
        return
    (res,) = _run_forge_validator([{"name": "half a robot"}])
    assert res["schemaErrors"] is True and res["errors"] is True
    assert any("schema.required" in l for l in res["lines"])
