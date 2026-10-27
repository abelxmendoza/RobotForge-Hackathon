"""Electrical view tests: the wiring data in the Robodex spec files,
the schema's wiring support, and the viewer's electrical logic.

The honesty rules under test: every voltage in the wiring comes from
the spec's own electrical fields or the catalog's datasheet specs; a
connection whose voltage is null (data link, PWM drive, unspecified
rail) can never be flagged; and no real robot in the fleet trips the
over-voltage check on its recorded values.
"""
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

from robotforge.catalog import Robodex
from robotforge.schema import RobotSpec, SpecError
from robotforge.site import render_robot_page

REPO = Path(__file__).resolve().parent.parent
KIT_PARTS = {"plate", "wheel", "mount", "caster", "lidar", "camera",
             "ultrasonic"}

dex = Robodex.load()
SPECS = {}
for r in dex.robots:
    if r.spec_file:
        SPECS[r.name] = RobotSpec.from_json(
            (REPO / r.spec_file).read_text())


def _overvolt(spec):
    """The check, mirrored: a power connection carrying a fixed
    voltage above its target's recorded rated maximum."""
    w = spec.wiring
    nodes = {n.id: n for n in w.nodes}
    return [c for c in w.connections
            if c.kind == "power" and c.volts is not None
            and nodes[c.dst].rated_max_v is not None
            and c.volts > nodes[c.dst].rated_max_v]


def test_every_robodex_robot_spec_carries_valid_wiring():
    assert SPECS, "no Robodex specs loaded"
    for name, spec in SPECS.items():
        w = spec.wiring
        assert w is not None, f"{name}: spec carries no wiring"
        ids = [n.id for n in w.nodes]
        assert "battery" in ids, f"{name}: no battery node"
        for n in w.nodes:
            if n.kit is not None:
                assert n.kit in KIT_PARTS, \
                    f"{name}: node {n.id} maps to unknown kit part {n.kit}"
        # endpoints were validated by the schema; kinds too
        assert all(c.kind in ("power", "data") for c in w.connections)


def test_wiring_values_come_from_the_spec():
    for name, spec in SPECS.items():
        w = spec.wiring
        nodes = {n.id: n for n in w.nodes}
        # the battery node advertises the spec's own battery voltage
        assert str(spec.battery.voltage_v) in nodes["battery"].req_label, \
            f"{name}: battery label does not carry the spec voltage"
        # the motors' rated maximum is the spec's motor voltage
        # (for Andino that is the top of its recorded 3-9 V range)
        assert nodes["motors"].rated_max_v == spec.motor.voltage_v, \
            f"{name}: motor rating disagrees with the spec"
        # nothing carries more than the battery rail provides
        for c in w.connections:
            if c.volts is not None:
                assert c.volts <= spec.battery.voltage_v, \
                    f"{name}: connection carries {c.volts} V from a " \
                    f"{spec.battery.voltage_v} V battery"


def test_real_fleet_has_no_overvoltage():
    for name, spec in SPECS.items():
        bad = _overvolt(spec)
        assert not bad, f"{name}: recorded wiring over-volts {[c.dst for c in bad]}"


def test_schema_roundtrip_and_optional_wiring():
    for spec in SPECS.values():
        again = RobotSpec.from_dict(spec.to_dict())
        assert again.wiring is not None
        assert again.wiring.to_dict() == spec.wiring.to_dict()
    plain = RobotSpec.from_json(
        (REPO / "examples/indoor-delivery-rover.json").read_text())
    assert plain.wiring is None
    assert "wiring" not in plain.to_dict()


def test_malformed_wiring_is_rejected():
    base = json.loads((REPO / "examples/pathfinder.json").read_text())

    def with_wiring(w):
        d = json.loads(json.dumps(base))
        d["wiring"] = w
        return d

    good = base["wiring"]
    bad_endpoint = json.loads(json.dumps(good))
    bad_endpoint["connections"][0]["to"] = "warp-drive"
    bad_kind = json.loads(json.dumps(good))
    bad_kind["connections"][0]["kind"] = "magic"
    dupe = json.loads(json.dumps(good))
    dupe["nodes"].append(dict(dupe["nodes"][0]))
    for w in (bad_endpoint, bad_kind, dupe):
        try:
            RobotSpec.from_dict(with_wiring(w))
        except SpecError:
            pass
        else:
            raise AssertionError(f"malformed wiring accepted: {w}")


def test_robot_pages_ship_the_electrical_viewer():
    robot_js = (REPO / "assets/js/robot.js").read_text()
    app_css = (REPO / "assets/css/app.css").read_text()
    for r in dex.robots:
        if not r.spec_file:
            continue
        page = render_robot_page(r)
        assert 'id="ta"' in page and "robot.js" in page, r.name
    # the toggle, the power sequencing and the fault state ship in
    # the viewer every robot page loads
    for marker in ('id="ta-elec"', 'id="ta-power"', "taSetPower",
                   "over-voltage", "elec-logic:start", "taDimsSide",
                   "taDimsTop"):
        assert marker in robot_js, marker
    # power/data/fault colours are the viewer's own, verdict colours
    # are not reused for wire states
    for marker in (".wire.on.power", ".wire.on.data", ".wire.bad",
                   ".node-chip", ".req-label", ".dim"):
        assert marker in app_css, marker


NODE_DRIVER = """
const fs = require('fs');
const [robotJs, repo] = process.argv.slice(2);
const src = fs.readFileSync(robotJs, 'utf8');
const block = src.split('/* == elec-logic:start == */')[1]
                 .split('/* == elec-logic:end == */')[0];
eval(block);
const out = {};
const assert = (c, m) => { if (!c) { console.error('FAIL ' + m); process.exit(1); } };
// the real fleet: clean, and power-on reaches the motors in 2 steps
for (const f of ['andino', 'turtlebot3-burger', 'photo-turtlebot',
                 'pathfinder']) {
  const spec = JSON.parse(fs.readFileSync(repo + '/examples/' + f + '.json', 'utf8'));
  const w = spec.wiring, d = elecDepths(w);
  assert(elecBad(w).size === 0, f + ' must be clean');
  assert(d.battery === 0 && d.driver === 1 && d.motors === 2,
         f + ' depths battery/driver/motors');
  out[f] = { bad: elecBad(w).size,
             motors: elecNodeStatus(w, 'motors').state };
}
// a fixed rail above the target's rating is flagged, in both the
// connection set and the node's status
const over = { nodes: [{id:'battery', label:'B', rated_max_v:null},
                       {id:'motors', label:'M', rated_max_v:12}],
  connections: [{from:'battery', to:'motors', kind:'power', volts:24,
                 label:'direct rail'}] };
assert(elecBad(over).has(0), 'over-voltage connection flagged');
assert(elecNodeStatus(over, 'motors').state === 'bad', 'status bad');
// a matched rail is checked and within rating
const matched = { nodes: over.nodes,
  connections: [{from:'battery', to:'motors', kind:'power', volts:11.1,
                 label:'rail'}] };
matched.nodes = [{id:'battery', label:'B', rated_max_v:null},
                 {id:'motors', label:'M', rated_max_v:11.1}];
assert(elecBad(matched).size === 0, 'matched rail not flagged');
assert(elecNodeStatus(matched, 'motors').state === 'ok', 'status ok');
// PWM drive (null volts): a 14.8 V battery feeding 12 V motors
// through a driver is never flagged, and lights at stage 2
const pwm = { nodes: [{id:'battery', label:'B', rated_max_v:null},
                      {id:'driver', label:'D', rated_max_v:null},
                      {id:'motors', label:'M', rated_max_v:12}],
  connections: [{from:'battery', to:'driver', kind:'power', volts:14.8,
                 label:'battery rail'},
                {from:'driver', to:'motors', kind:'power', volts:null,
                 label:'PWM output'}] };
assert(elecBad(pwm).size === 0, 'PWM drive not flagged');
assert(elecStage(pwm, elecDepths(pwm), 1) === 2, 'PWM stage');
assert(elecNodeStatus(pwm, 'motors').state === 'unchecked', 'PWM unchecked');
console.log(JSON.stringify(out));
"""


RENDER_DRIVER = r"""
const fs = require('fs');
const [commonJs, robotJs, repo] = process.argv.slice(2);
const stub = `
const document = { documentElement: { dataset: {} },
  addEventListener(){}, querySelector: () => null,
  querySelectorAll: () => [] };
const window = { devicePixelRatio: 1 };
`;
const test = `
;(function () {
  const assert = (c, m) => { if (!c) { console.error('FAIL ' + m);
    process.exit(1); } };
  const spec = JSON.parse(require('fs').readFileSync(
    repoPath + '/examples/andino.json', 'utf8'));
  taSpec = spec;
  const built = taBuildParts(spec);
  const side0 = taRenderSide(spec, built.parts, built.pos);
  assert(!side0.includes('wire-g'), 'no wires before electrical mode');
  assert(side0.includes('\u00d8 66 mm'), 'wheel diameter dimension');
  assert(side0.includes('250 mm'), 'length dimension');
  assert(side0.includes('30 mm'), 'ground clearance dimension');
  const top0 = taRenderTop(spec, built.parts, built.pos);
  assert(top0.includes('100 mm'), 'width dimension');
  taElec = true;
  const side = taRenderSide(spec, built.parts, built.pos);
  const nWires = (side.match(/wire-g/g) || []).length;
  assert(nWires === spec.wiring.connections.length,
         'every connection drawn, got ' + nWires);
  assert(side.includes('node-chip'), 'component chips drawn');
  assert(side.includes('Raspberry Pi 4'), 'chip label');
  assert(side.includes('3\u20139 V'), 'chip requirement');
  assert(side.includes('req-label'), 'sensor requirement label');
  assert(!side.includes('over-voltage'), 'fleet renders no fault');
  taPower = true; taElecStage = 1;
  const s1 = taRenderSide(spec, built.parts, built.pos);
  assert(s1.includes('class="wire power on"'), 'stage 1 lights a feed');
  taElecStage = 99;
  const sAll = taRenderSide(spec, built.parts, built.pos);
  assert((sAll.match(/wire power on/g) || []).length >= 4,
         'power wires lit when fully on');
  assert((sAll.match(/wire data on/g) || []).length >= 4,
         'data wires lit when fully on');
  const bad = JSON.parse(JSON.stringify(spec));
  bad.wiring = { note: 'fixture', nodes: [
      {id:'battery', label:'Battery', req_label:'24 V',
       rated_max_v:null, kit:null, deck:true},
      {id:'motors', label:'Motors', req_label:'12 V',
       rated_max_v:12, kit:'mount', deck:true}],
    connections: [{from:'battery', to:'motors', kind:'power',
                   volts:24, label:'direct rail'}] };
  taSpec = bad;
  const sideBad = taRenderSide(bad, taBuildParts(bad).parts,
                               taBuildParts(bad).pos);
  assert(sideBad.includes('over-voltage'), 'fault tag rendered');
  assert(sideBad.includes('wire power bad'), 'fault class rendered');
  console.log('render ok');
})();`;
eval(stub + '\nconst repoPath = ' + JSON.stringify(repo) + ';\n' +
     fs.readFileSync(commonJs, 'utf8') + '\n' +
     fs.readFileSync(robotJs, 'utf8') + '\n' + test);
"""


def test_electrical_render_in_node():
    node = shutil.which("node")
    if not node:
        return  # no node on this machine; logic tests above still hold
    with tempfile.TemporaryDirectory() as td:
        script = Path(td) / "render_driver.js"
        script.write_text(RENDER_DRIVER)
        r = subprocess.run(
            [node, str(script), str(REPO / "assets/js/common.js"),
             str(REPO / "assets/js/robot.js"), str(REPO)],
            capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stderr
    assert "render ok" in r.stdout


def test_electrical_logic_in_node():
    node = shutil.which("node")
    if not node:
        return  # no node on this machine; data tests above still hold
    with tempfile.TemporaryDirectory() as td:
        script = Path(td) / "driver.js"
        script.write_text(NODE_DRIVER)
        r = subprocess.run(
            [node, str(script), str(REPO / "assets/js/robot.js"),
             str(REPO)],
            capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stderr
    out = json.loads(r.stdout.strip().splitlines()[-1])
    assert out["andino"]["motors"] == "unchecked"     # PWM-driven
    assert out["pathfinder"]["motors"] == "unchecked"  # PWM-driven
    assert out["turtlebot3-burger"]["motors"] == "ok"  # rated rail
    assert out["photo-turtlebot"]["motors"] == "ok"    # rated rail
