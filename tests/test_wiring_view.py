"""Wiring & cabling view tests: the cable schema extension, the
sourced cable backfill, the Jetson catalogue entry, and the view's
pure logic (layout, trace, failure finder, callouts, cable fields)
run in Node from the same wiring-logic block the page ships.

The honesty rules under test: cable facts exist ONLY where a source
names them (the cabled set is asserted exactly, so an invented
harness fails loudly); a null cable field reads "not specified";
the failure finder counts power edges only.
"""
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPO_EARLY = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_EARLY / "src"))

from robotforge.catalog import Catalog, Robodex
from robotforge.schema import RobotSpec, SpecError

REPO = Path(__file__).resolve().parent.parent
dex = Robodex.load()
SPECS = {}
for r in dex.robots:
    if r.spec_file:
        SPECS[r.name] = RobotSpec.from_json((REPO / r.spec_file).read_text())

# The ONLY cabled connections in the fleet, each traceable to a
# source: the X500 spec's own Holybro note (XT60/XT30) and the PM02
# module's documented 6-pin JST-GH 15 cm cable (Holybro); the
# ROBOTIS cable table for OpenCR -> X-series (Robot Cable-X3P,
# JST 3-pin TTL); the catalog's own CSI-ribbon camera interface.
CABLED = {
    ("PX4 X500", "battery", "pdb", "power"),
    ("PX4 X500", "pdb", "esc", "power"),
    ("PX4 X500", "pdb", "fc", "power"),
    ("ROBOTIS OP3", "opencr", "motors", "power"),
    ("ROBOTIS OP3", "opencr", "motors", "data"),
    ("OpenManipulator-X", "opencr", "motors", "power"),
    ("OpenManipulator-X", "opencr", "motors", "data"),
    ("TurtleBot3 Waffle Pi", "driver", "motors", "power"),
    ("TurtleBot3 Waffle Pi", "driver", "motors", "data"),
    ("Andino", "controller", "camera", "data"),
}


def test_cabled_set_is_exactly_the_sourced_set():
    found = set()
    for name, spec in SPECS.items():
        if spec.wiring is None:
            continue
        for c in spec.wiring.connections:
            if c.cable is not None:
                found.add((name, c.src, c.dst, c.kind))
    assert found == CABLED, found ^ CABLED


def test_backfilled_cable_values():
    x500 = SPECS["PX4 X500"].wiring
    by = {(c.src, c.dst): c for c in x500.connections}
    assert by[("battery", "pdb")].cable.connector == "XT60"
    assert by[("pdb", "esc")].cable.connector == "XT30"
    fc = by[("pdb", "fc")].cable
    assert "JST GH" in fc.connector and fc.length_mm == 150
    assert fc.gauge_awg is None  # not named by the source
    for name in ("ROBOTIS OP3", "OpenManipulator-X", "TurtleBot3 Waffle Pi"):
        for c in SPECS[name].wiring.connections:
            if c.cable is not None:
                assert "X3P" in c.cable.connector, (name, c)
                assert c.cable.length_mm is None  # sold by length; the
                # in-robot lengths are not documented
    cam = [c for c in SPECS["Andino"].wiring.connections
           if c.cable is not None]
    assert len(cam) == 1 and "CSI" in cam[0].cable.connector


def _spec_with_cable(cable):
    base = json.loads((REPO / "examples/pathfinder.json").read_text())
    base["wiring"]["connections"][0]["cable"] = cable
    return base


def test_cable_schema_accepts_and_roundtrips():
    good = {"gauge_awg": 14, "connector": "XT60", "length_mm": 120}
    spec = RobotSpec.from_dict(_spec_with_cable(good))
    c = spec.wiring.connections[0].cable
    assert (c.gauge_awg, c.connector, c.length_mm) == (14.0, "XT60", 120.0)
    again = RobotSpec.from_dict(spec.to_dict())
    assert again.wiring.to_dict() == spec.wiring.to_dict()
    # partial cable: only what is named
    spec = RobotSpec.from_dict(_spec_with_cable({"connector": "XT60"}))
    c = spec.wiring.connections[0].cable
    assert c.connector == "XT60" and c.gauge_awg is None \
        and c.length_mm is None
    # explicit null cable is the same as absent
    spec = RobotSpec.from_dict(_spec_with_cable(None))
    assert spec.wiring.connections[0].cable is None
    assert "cable" not in spec.wiring.to_dict()["connections"][0]


def test_cable_schema_rejects_bad_values():
    bad_cables = [
        "XT60",                                   # not an object
        {"gauge_awg": "14"},                      # gauge not a number
        {"gauge_awg": True},                      # bool is not a gauge
        {"gauge_awg": -1},                        # negative gauge
        {"gauge_awg": 99},                        # beyond any real AWG
        {"length_mm": 0},                         # a cable has length
        {"length_mm": -5},
        {"length_mm": "150"},                     # length not a number
        {"connector": ""},                         # empty connector
        {"connector": 42},                        # connector not a string
        {"color": "red"},                         # unknown field
    ]
    for cable in bad_cables:
        try:
            RobotSpec.from_dict(_spec_with_cable(cable))
        except SpecError:
            pass
        else:
            raise AssertionError(f"bad cable accepted: {cable!r}")


def test_uncabled_specs_serialise_without_cable_keys():
    for name in ("TurtleBot3 Burger", "Pathfinder", "Crazyflie 2.1",
                 "Mini Pupper"):
        for c in SPECS[name].wiring.to_dict()["connections"]:
            assert "cable" not in c, name


def test_jetson_orin_nano_in_catalogue():
    cat = Catalog.load()
    p = cat.find_part("jetson_orin_nano")
    assert p.name == "NVIDIA Jetson Orin Nano"
    assert p.part_class == "sbc"
    assert p.buy is None
    assert p.image == "assets/img/parts/jetson_orin_nano.jpg"
    # datasheet facts (NVIDIA DS-11105-001): 5 V module input,
    # 7/15/25 W modes, 69.6 x 45 mm module
    assert "5 V" in p.specs["supply"]
    assert "25 W" in p.specs["power_modes"]
    assert "69.6" in p.specs["size"]
    assert len(cat.parts) == 50


def test_wiring_view_ships_on_robot_and_forge_pages():
    wiring_js = (REPO / "assets/js/wiring.js").read_text()
    app_css = (REPO / "assets/css/app.css").read_text()
    from robotforge.site import render_forge, render_robot_page
    for r in dex.robots:
        if not r.spec_file:
            continue
        page = render_robot_page(r)
        assert "wiring.js" in page, r.name
    assert "wiring.js" in render_forge()
    for marker in ('id="ta-view-wiring"', 'id="ta-wiring"',
                   "RFWiring.onSpecReady", "wiring-logic:start"):
        assert marker in (REPO / "assets/js/robot.js").read_text() \
            or marker in wiring_js, marker
    for marker in (".wv-line.data", ".wv-node", ".wv-table",
                   "@media print", ".wv-printing", ".wv-term"):
        assert marker in app_css, marker
    glossary = json.loads((REPO / "assets/js/glossary.json").read_text())
    for term in ("rail", "bus", "harness", "regulator", "BEC",
                 "ampacity", "PWM", "ESC", "PDB", "TTL", "gauge"):
        assert term in glossary["terms"], term


NODE_DRIVER = """
const fs = require('fs');
const [wiringJs, repo] = process.argv.slice(2);
const src = fs.readFileSync(wiringJs, 'utf8');
const block = src.split('/* == wiring-logic:start == */')[1]
                 .split('/* == wiring-logic:end == */')[0];
eval(block);
const assert = (c, m) => { if (!c) { console.error('FAIL ' + m);
  process.exit(1); } };
const load = f => JSON.parse(fs.readFileSync(
  repo + '/examples/' + f + '.json', 'utf8')).wiring;
const andino = load('andino'), x500 = load('px4-x500');

// layout: every connection drawn exactly once, deterministic
const lay = wvLayout(andino);
assert(lay.edges.filter(Boolean).length === andino.connections.length,
       'every connection gets an edge');
assert(new Set(lay.edges.map(e => e.i)).size === andino.connections.length,
       'edges are unique per connection');
const lay2 = wvLayout(andino);
assert(JSON.stringify(lay) === JSON.stringify(lay2), 'layout deterministic');
assert(lay.depth.battery === 0 && lay.depth.driver === 1 &&
       lay.depth.motors === 2, 'andino depths');
const svg = wvDiagramSVG(andino, 'full');
assert((svg.match(/wv-cable/g) || []).length === andino.connections.length,
       'svg draws every connection once');
assert((svg.match(/wv-node/g) || []).length === andino.nodes.length,
       'svg draws every node once');
assert(svg.includes('wv-line data'), 'data cables carry the data class');
assert(svg.includes('wv-line power'), 'power cables carry the power class');
// trace through the driver: battery/driver/nano/motors, never the lidar
const tr = wvTrace(andino, 'driver');
assert(tr.nodes.includes('battery') && tr.nodes.includes('nano') &&
       tr.nodes.includes('motors'), 'trace covers the driver paths');
assert(!tr.nodes.includes('lidar') && !tr.nodes.includes('regulator'),
       'trace excludes side branches');
const trLabels = tr.conns.map(i => andino.connections[i].from + '>' +
  andino.connections[i].to).sort();
assert(trLabels.join(',') ===
  'battery>driver,controller>nano,controller>nano,driver>motors,' +
  'motors>nano,nano>driver',
  'trace connections are exactly the driver paths: ' + trLabels);
// failure finder: power edges only, reverse reachability
assert(JSON.stringify(wvFailure(andino, 'regulator')) ===
       JSON.stringify(['controller', 'nano', 'lidar']),
       'killing the regulator starves the computer branch');
assert(JSON.stringify(wvFailure(andino, 'driver')) ===
       JSON.stringify(['motors']), 'killing the driver starves the motors');
assert(wvFailure(andino, 'battery').length === 6,
       'killing the battery starves everything powered');
// cable fields: nulls are "not specified", named facts are shown
const fcConn = x500.connections.find(c => c.from === 'pdb' && c.to === 'fc');
assert(wvCableField(fcConn.cable, 'connector').includes('JST GH'),
       'pm02 connector shown');
assert(wvCableField(fcConn.cable, 'length_mm') === '150 mm',
       'pm02 length shown');
assert(wvCableField(fcConn.cable, 'gauge_awg') === 'not specified',
       'unnamed gauge is not specified');
assert(wvCableField(null, 'connector') === 'not specified',
       'no cable record at all is not specified');
assert(wvChipText(x500, 0, 'full').includes('XT60'),
       'full-mode chip names the connector');
assert(wvChipText(x500, 0, 'simple') === 'power \\u00b7 14.8 V',
       'simple chip is kind + volts');
// plain-language callouts, authored from kind + recorded data only
const ci = (w, f, t) => w.connections.findIndex(
  c => c.from === f && c.to === t);
assert(wvCallout(andino, ci(andino, 'regulator', 'controller')) ===
  'Carries 5 V power from the voltage regulator to the computer.',
  'callout: regulator feed');
assert(wvCallout(andino, ci(andino, 'driver', 'motors')).includes('PWM'),
       'callout: PWM drive named');
assert(wvCallout(andino, ci(andino, 'controller', 'camera')) ===
  'Carries CSI data between the computer and the camera.',
  'callout: CSI bus named');
// over-voltage: recorded values only, red is earned
const over = { nodes: [{id:'battery', label:'B', rated_max_v:null},
                       {id:'motors', label:'M', rated_max_v:12}],
  connections: [{from:'battery', to:'motors', kind:'power', volts:24,
                 label:'direct rail'}] };
assert(wvBad(over).has(0), 'over-voltage flagged');
assert(wvBad(andino).size === 0 && wvBad(x500).size === 0,
       'the recorded fleet is clean');
console.log('wiring logic ok');
"""


def test_wiring_logic_in_node():
    node = shutil.which("node")
    if not node:
        return  # no node on this machine; python tests still hold
    with tempfile.TemporaryDirectory() as td:
        script = Path(td) / "wv_driver.js"
        script.write_text(NODE_DRIVER)
        r = subprocess.run(
            [node, str(script), str(REPO / "assets/js/wiring.js"),
             str(REPO)],
            capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stderr
    assert "wiring logic ok" in r.stdout
