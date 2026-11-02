"""Wrench reads the tools & materials ownership state (Forge
Engine §11, Phase 4 of the workshop-chat-tools plan).

The chat engine stays import-free and offline: ChatDock hands it
a provider that resolves the catalogue records, the owner's
flips and the constraints profile through lib/toolsMaterials.ts
at answer time. These tests wire the engine exactly that way —
the real engine module, the real lib snapshot builder, the real
catalogues — and check the vocabulary the surfaces share:

- an ownership question lists the two states, simulated named as
  "Simulated — not owned", never as owned;
- a build-plan answer carries the same Doable now / Future —
  needs X split as the Workshop, with the buy list priced only
  from gathered records;
- with no provider at all, the conversation behaves exactly as
  it did before the state existed.
"""
import json
import pathlib
import shutil
import subprocess

REPO = pathlib.Path(__file__).resolve().parents[1]
WEB = REPO / "web-next"
LIB = WEB / "src/lib"
CHAT = WEB / "src/components/chat"

SCRIPT = """
import fs from "node:fs";
const root = process.argv[2];
const tmp = process.argv[3];
const load = (p) => JSON.parse(fs.readFileSync(root + "/" + p, "utf8"));
const robots = load("catalog/robots.json");
const parts = load("catalog/parts.json");
const FG = await import(root + "/web-next/src/components/chat/engine.ts");
const BP = await import(tmp + "/buildPlan.ts");
const TM = await import(tmp + "/toolsMaterials.ts");
const tmItems = TM.tmItemsFromCatalog(
  load("catalog/tools.json"), load("catalog/materials.json"), parts.parts);
const NOW = "2026-11-01T18:00:00Z";
function engineWith(provider) {
  return FG.createEngine({
    robots: robots.robots, parts: parts.parts,
    templates: parts.templates.length, templateList: parts.templates,
    kinds: load("catalog/kinds.json").kinds,
    reports: load("catalog/gate-reports.json"),
    intents: load("assets/js/chat-intents.json"),
    root: "",
    ...(provider ? { toolsMaterials: provider } : {}),
  });
}
const withState = engineWith(() => TM.chatSnapshot(
  tmItems, {}, BP.DEFAULT_PROFILE, NOW));
const fullProfile = {
  ...BP.DEFAULT_PROFILE,
  toolsOnHand: [...BP.DEFAULT_PROFILE.toolsOnHand, "wire_tools"],
};
const withFull = engineWith(() => TM.chatSnapshot(
  tmItems, {}, fullProfile, NOW));
const bare = engineWith(null);
const qs = {
  own: withState.answer("What tools do I have?").html,
  printer: withState.answer("Do I own a 3D printer?").html,
  plan: withState.answer("Plan a differential rover build").html,
  planFull: withFull.answer("Plan a differential rover build").html,
  barePlan: bare.answer("Plan a differential rover build").html,
  bareOwn: bare.answer("What tools do I have?").html,
};
console.log(JSON.stringify(qs));
"""


def _prep_unit_dir(tmp) -> None:
    """The lib chain buildPlan/toolsMaterials pull in, with the
    repo's node-test import rewriting (same prep as
    test_tools_materials.py). The chat engine itself is imported
    from its real path — it has no imports to rewrite."""
    (tmp / "package.json").write_text('{"type":"module"}')
    for name in ("sourcing.ts", "wiring.ts", "types.ts"):
        (tmp / name).write_text((LIB / name).read_text())
    bom = (LIB / "bom.ts").read_text().replace('"./sourcing"', '"./sourcing.ts"')
    (tmp / "bom.ts").write_text(bom)
    palette = (LIB / "palette.ts").read_text()
    palette = (palette.replace('"./bom"', '"./bom.ts"')
               .replace('"./sourcing"', '"./sourcing.ts"')
               .replace('"./types"', '"./types.ts"'))
    (tmp / "palette.ts").write_text(palette)
    build_wiring = (LIB / "buildWiring.ts").read_text()
    build_wiring = (build_wiring.replace('"./types"', '"./types.ts"')
                    .replace('"./palette"', '"./palette.ts"'))
    (tmp / "buildWiring.ts").write_text(build_wiring)
    engine = (LIB / "buildPlan.ts").read_text()
    engine = (engine.replace('"./bom"', '"./bom.ts"')
              .replace('"./types"', '"./types.ts"')
              .replace('"./wiring"', '"./wiring.ts"')
              .replace('"./buildWiring"', '"./buildWiring.ts"')
              .replace('"./palette"', '"./palette.ts"'))
    (tmp / "buildPlan.ts").write_text(engine)
    tm = (LIB / "toolsMaterials.ts").read_text()
    tm = tm.replace('"./buildPlan"', '"./buildPlan.ts"')
    (tmp / "toolsMaterials.ts").write_text(tm)


def _run() -> dict:
    tmp = REPO / ".pytest-tmp-chat-tm"
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True)
    _prep_unit_dir(tmp)
    (tmp / "run.mjs").write_text(SCRIPT)
    (tmp / "node_modules").symlink_to(WEB / "node_modules", target_is_directory=True)
    try:
        out = subprocess.run(
            ["node", "--experimental-strip-types", "run.mjs", str(REPO), str(tmp)],
            cwd=tmp, capture_output=True, text=True, timeout=120,
        )
        assert out.returncode == 0, out.stderr[-3000:]
        return json.loads(out.stdout[out.stdout.index("{"):])
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def test_wiring_provider_only_in_the_dock():
    dock = (CHAT / "ChatDock.tsx").read_text()
    assert "chatSnapshot" in dock and "OWNERSHIP_KEY" in dock
    assert "toolsMaterials" in dock
    engine = (CHAT / "engine.ts").read_text()
    assert "toolsMaterialsAnswer" in engine and "tmPlanBlock" in engine
    # The engine itself stays import-free and offline.
    for banned in ("fetch(", "postJSON", "liveHealth", 'from "../../lib'):
        assert banned not in engine, banned


def test_ownership_answer_names_both_states():
    a = _run()
    own = a["own"]
    assert "On hand:" in own and "Simulated — not owned:" in own
    # The catalogue's only tool is simulated by default — named,
    # in the simulated list, never in the on-hand list.
    on_hand_line = own.split("Simulated — not owned:")[0]
    assert "Prusa MK4S" not in on_hand_line
    assert "Prusa MK4S" in own.split("Simulated — not owned:")[1]
    # The printer question gets the same honest answer.
    assert "Simulated — not owned:" in a["printer"]
    assert "Prusa MK4S" in a["printer"]


def test_plan_answer_carries_the_split_and_buy_list():
    a = _run()
    plan = a["plan"]
    # The default profile lacks wire tools, which the rover
    # template's power parts require: a future step, named.
    assert "Tools &amp; materials — Future — needs" in plan
    assert "Wire cutters / strippers" in plan
    assert "Buy list for the future steps" in plan
    # Wire tools have no catalogue record: listed unpriced.
    assert "no price recorded" in plan
    # With the full workshop profile, the same build is doable now.
    assert "Tools &amp; materials — Doable now" in a["planFull"]


def test_no_provider_no_state_claims():
    a = _run()
    assert "Tools &amp; materials" not in a["barePlan"]
    assert "Simulated — not owned" not in a["bareOwn"]
