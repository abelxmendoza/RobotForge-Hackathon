"""The build plan's Doable-now / Future split (Forge Engine
§11, Phase 3 of the workshop-chat-tools plan).

Same discipline as test_build_plan.py: the engine is pure lib/
code, so it is exercised through node directly on the real
catalogue kit for TurtleBot3 Burger. A step is "now" only when
every tool and material it names is on hand in the profile;
otherwise it is "future" and names what is missing — the buy
list prices those needs from the tools/material catalogues,
with basis + expiry, never an invented figure — and the plan's
Markdown header never reads as ready to build while future
steps exist.
"""
import json
import pathlib
import shutil
import subprocess

REPO = pathlib.Path(__file__).resolve().parents[1]
WEB = REPO / "web-next"
LIB = WEB / "src/lib"


def _prep_unit_dir(tmp) -> None:
    """The lib chain buildPlan/toolsMaterials pull in, with the
    repo's node-test import rewriting (same prep as
    test_tools_materials.py)."""
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


def _run_node(script: str) -> dict:
    tmp = REPO / ".pytest-tmp-split"
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True)
    _prep_unit_dir(tmp)
    (tmp / "run.mjs").write_text(script)
    (tmp / "node_modules").symlink_to(WEB / "node_modules", target_is_directory=True)
    try:
        out = subprocess.run(
            ["node", "--experimental-strip-types", "run.mjs", str(REPO)],
            cwd=tmp, capture_output=True, text=True, timeout=120,
        )
        assert out.returncode == 0, out.stderr[-3000:]
        return json.loads(out.stdout[out.stdout.index("{"):])
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


SCRIPT = """
import fs from "node:fs";
const root = process.argv[2];
const BP = await import("./buildPlan.ts");
const BOM = await import("./bom.ts");
const TM = await import("./toolsMaterials.ts");
const partsDoc = JSON.parse(fs.readFileSync(root + "/catalog/parts.json", "utf8"));
const parts = partsDoc.parts;
const partsById = new Map(parts.map((p) => [p.id, p]));
const kitsDoc = JSON.parse(fs.readFileSync(root + "/catalog/parts-kits.json", "utf8"));
const toolsDoc = JSON.parse(fs.readFileSync(root + "/catalog/tools.json", "utf8"));
const matsDoc = JSON.parse(fs.readFileSync(root + "/catalog/materials.json", "utf8"));
const burger = kitsDoc.kits["turtlebot3-burger"];
const items = BP.kitPlanItems(burger);
const tmItems = TM.tmItemsFromCatalog(toolsDoc, matsDoc, parts);
const NOW = "2026-11-01T18:00:00Z";

const full = BP.generateBuildPlan({
  title: "Burger full workshop", items, profile: BP.DEFAULT_PROFILE, partsById });
const noPrinter = BP.generateBuildPlan({
  title: "Burger no printer", items, partsById,
  profile: {
    ...BP.DEFAULT_PROFILE,
    toolsOnHand: BP.DEFAULT_PROFILE.toolsOnHand.filter((t) => t !== "3d_printer"),
  } });
const tpuOnly = BP.generateBuildPlan({
  title: "Burger TPU only", items, partsById,
  profile: { ...BP.DEFAULT_PROFILE, materialsOnHand: ["TPU"] } });
const withList = TM.withBuyList(noPrinter, tmItems, NOW);
/* A template build has buy-role lines, hence a Buy step. */
const kitsByFile = BP.kitFileIndex(kitsDoc.kits);
const rover = partsDoc.templates.find((t) => t.name === "rover_diff_drive");
const roverItems = BP.bomLinePlanItems(
  BOM.templateBomLines(rover, partsById, []), partsById, kitsByFile);
const roverNoPrinter = BP.generateBuildPlan({
  title: "Rover no printer", items: roverItems, partsById,
  profile: noPrinter.profile });

console.log(JSON.stringify({
  full: {
    future: full.steps.filter((s) => s.availability === "future")
      .map((s) => [s.phase, s.missing.map((m) => m.name)]),
    summaryFuture: full.summary.futureSteps,
    md: BP.planToMarkdown(full),
  },
  noPrinter: {
    future: noPrinter.steps.filter((s) => s.availability === "future")
      .map((s) => [s.phase, s.missing.map((m) => [m.name, m.kind, m.id ?? null])]),
    summaryFuture: noPrinter.summary.futureSteps,
    md: BP.planToMarkdown(withList),
  },
  roverBuyStep: roverNoPrinter.steps.find((s) => s.phase === "Buy").availability,
  tpuOnly: {
    future: tpuOnly.steps.filter((s) => s.availability === "future")
      .map((s) => [s.phase, s.missing.map((m) => [m.name, m.kind])]),
  },
  buyList: withList.buyList ?? null,
}));
"""


def test_split_marks_steps_by_recorded_state():
    data = _run_node(SCRIPT)
    # The default workshop profile has the printer and the
    # filaments on hand: nothing is future.
    assert data["full"]["future"] == []
    assert data["full"]["summaryFuture"] == 0
    # Without the printer, the Print steps are future and name
    # the printer need by its profile id. (The Prep step lists
    # the printer among its tools too — staging printed parts —
    # so it is future as well; nothing else is.)
    assert data["noPrinter"]["future"], "print steps should be future"
    phases = {phase for phase, _ in data["noPrinter"]["future"]}
    assert phases <= {"Print", "Prep"} and "Print" in phases
    for phase, missing in data["noPrinter"]["future"]:
        assert ["3D printer", "tool", "3d_printer"] in missing
    assert data["noPrinter"]["summaryFuture"] == len(data["noPrinter"]["future"])
    # The Buy step is procurement itself — always doable now,
    # even in a profile missing the printer.
    assert data["roverBuyStep"] == "now"
    # No rigid filament on hand: print steps are future and name
    # the catalogue's recorded structural material pick.
    assert data["tpuOnly"]["future"]
    for phase, missing in data["tpuOnly"]["future"]:
        assert phase == "Print"
        assert ["PETG", "material"] in missing


def test_buy_list_prices_only_from_gathered_records():
    data = _run_node(SCRIPT)
    entries = data["buyList"]
    assert entries is not None and len(entries) == 1
    (entry,) = entries
    # The printer need joins the Prusa record: its gathered
    # estimate, with provenance — not an invented figure.
    assert "Prusa MK4S" in entry["name"]
    assert entry["price"]["amount"] == 925.00
    assert "web-gathered estimate" in entry["price"]["label"]
    assert "expires 2026-11-02" in entry["price"]["label"]
    assert entry["price"]["expired"] is False


def test_markdown_never_reads_ready_with_future_steps():
    data = _run_node(SCRIPT)
    md = data["noPrinter"]["md"]
    assert "step(s) are FUTURE" in md
    assert "not" in md and "ready to build end-to-end" in md
    assert "[Future — needs: 3D printer]" in md
    assert "## Buy list (for the future steps)" in md
    assert "Prusa MK4S" in md and "$925.00" in md
    full_md = data["full"]["md"]
    assert "every step's named tools and materials are on hand" in full_md
    assert "[Future — needs" not in full_md
