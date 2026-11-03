"""Take apart / Assemble (Build tab) + 3D turntable.

The feature (web-next/src/lib/takeApart.ts +
components/garage/TakeApartPanel.tsx): a 2D parts diagram the user
can pull apart, whose steps and auto-connect memory derive ONLY
from the selected robot's records — spec.forge (BOM / wiring /
placement), spec.connections (owner-kept maps like Omega1's),
spec.wiring (the bench record), or bare spec component groups
(free canvas, no steps). A robot with no record gets the honest
empty state; nothing here may invent parts, connections or steps.

The derivation module is pure and import-free, so the node harness
copies it verbatim and drives it (the forgeEngine pattern). The 3D
turntable reuses the existing viewers (TwinView / ScanView /
OverviewTurntable) — pinned structurally: the panel must not grow
its own renderer, and model resolution is twin → attached scan →
spec-built stage → none, with the reduced-motion guard living in
the reused viewers.
"""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web-next"
LIB = WEB / "src" / "lib"
GARAGE = WEB / "src" / "components" / "garage"

TA = (LIB / "takeApart.ts").read_text()
PANEL = (GARAGE / "TakeApartPanel.tsx").read_text()
GARAGE_TSX = (GARAGE / "Garage.tsx").read_text()
TWIN_TSX = (GARAGE / "Omega1Twin.tsx").read_text()
APP_CSS = (ROOT / "assets/css/app.css").read_text()
INTENTS = json.loads((ROOT / "assets/js/chat-intents.json").read_text())


# ------------------------------------------------------------- source pins

def test_lib_is_pure_and_import_free():
    assert not any(line.startswith("import") for line in TA.splitlines())
    for name in ("deriveTakeApart", "assembleSteps", "disassembleSteps",
                 "explodedPos", "restoredCount", "resolveModelSource", "layoutHome"):
        assert f"export function {name}" in TA


def test_panel_mounted_in_build_tab():
    assert "import TakeApartPanel from './TakeApartPanel';" in GARAGE_TSX
    build_at = GARAGE_TSX.index("tab === 'build' && <ForgeBuild")
    mount_at = GARAGE_TSX.index("<TakeApartPanel")
    assert mount_at > build_at
    assert "onNeedSpecs={() => setTab('specs')}" in GARAGE_TSX


def test_panel_strings_and_honesty_copy():
    for s in ("Take apart / Assemble", "PARTS DIAGRAM",
              "not a 3D physics scene",
              "Assemble all", "Take all apart", "Snap back:",
              "Step {current.n} of {current.total}:",
              "connections made",
              "No recorded build to take apart yet.",
              "RobotForge does not invent",
              "view-only: dragging a part never changes the",
              "a tidy layout computed for this diagram",
              "the Forge Engine’s recorded placement",
              "no steps to walk",
              "snaps in"):
        assert s in PANEL, s


def test_turntable_reuse_and_resolution_order():
    # Reuse only: no private renderer, no direct three import.
    assert "WebGLRenderer" not in PANEL
    assert "from 'three'" not in PANEL and 'from "three"' not in PANEL
    for viewer in ("import TwinView from './TwinView';",
                   "import ScanView from './ScanView';",
                   "import OverviewTurntable, { hasBody } from './OverviewTurntable';"):
        assert viewer in PANEL
    # Resolution order is the lib function's, twin → scan → stage.
    body = TA[TA.index("export function resolveModelSource"):]
    assert body.index("isOmega1") < body.index("scanFormat") < body.index("hasDims")
    for s in ("No 3D model for this robot yet",
              "360° turntable — drag to orbit",
              "Viewing only: taking apart happens on the diagram below.",
              "point preview — the shape your scanner captured, not a photoreal model",
              "Hide the 3D turntable", "Show the 3D turntable"):
        assert s in PANEL, s


def test_reused_viewers_carry_the_reduced_motion_guard():
    for viewer in ("TwinView.tsx", "ScanView.tsx"):
        assert "prefers-reduced-motion" in (GARAGE / viewer).read_text()


def test_twin_build_pane_points_at_the_stored_copy():
    assert "Take it apart, put it back" in TWIN_TSX
    assert "this twin is a fixed specimen and stays assembled" in TWIN_TSX
    assert "Add Omega1 to your Garage" in TWIN_TSX


def test_css_present():
    for s in (".ta-canvas{", ".ta-part{", ".ta-line.on{", ".ta-twin-note{",
              "min-height:48px", "@media (max-width:640px)"):
        assert s in APP_CSS, s


def test_chat_guidance_topic():
    topics = {t["id"]: t for t in INTENTS["topics"]}
    # 'take_apart' is the pre-existing CAD-kit topic; the Garage Build
    # panel gets its own id — ids must stay unique (test_chat pins it).
    assert "build_take_apart" in topics
    ans = topics["build_take_apart"]["answer"]
    assert "Build tab" in ans and "Take apart / Assemble panel" in ans
    assert "auto-connect" in ans.lower() or "Assemble all" in ans
    assert "view-only" in ans
    assert "instead of inventing a build" in ans
    # The guidance must not claim any detection/invention capability.
    low = ans.lower()
    assert "detect" not in low
    assert "How do I take my robot apart?" in INTENTS["suggestions"]
    assert "How do I take my robot apart?" in topics["build_take_apart"]["samples"]


# ------------------------------------------------------- behaviour (node)

def test_derivation_behaviour(tmp_path):
    node = shutil.which("node")
    if not node:
        pytest.skip("Node is unavailable")
    (tmp_path / "takeApart.ts").write_text(TA)
    (tmp_path / "package.json").write_text('{"type":"module"}')
    script = """
import assert from 'node:assert/strict';
import { deriveTakeApart, assembleSteps, disassembleSteps, explodedPos,
         restoredCount, resolveModelSource, isHomeAt } from './takeApart.ts';

// --- Forge Engine robot: BOM parts, wiring steps, recorded placement home
const forgeSpec = { forge: {
  bom: [ {partId:'bat', qty:1, source:'catalogue'},
         {partId:'drv', qty:1, source:'catalogue'},
         {partId:'mot', qty:2, source:'catalogue'} ],
  placement: [ {partId:'bat', role:'Battery', pos_mm:[-80,0,20]},
               {partId:'drv', role:'Motor driver', pos_mm:[0,0,30]},
               {partId:'mot', role:'Motor', pos_mm:[60,40,10]} ],
  wiring: [ {from:'bat', to:'drv', kind:'power', connector:'XT60'},
            {from:'drv', to:'mot', kind:'power', connector:'screw terminals'},
            {from:'ghost', to:'mot', kind:'data', connector:'n/a'} ],
} };
const fm = deriveTakeApart(forgeSpec);
assert.equal(fm.source, 'forge');
assert.equal(fm.homeSource, 'placement');
assert.deepEqual(fm.parts.map(p=>p.id), ['bat','drv','mot']);
assert.equal(fm.parts.find(p=>p.id==='mot').detail, 'Motor · ×2');
assert.equal(fm.connections.length, 2); // ghost endpoint dropped, not invented
const fa = assembleSteps(fm);
assert.equal(fa[0].text, 'Connect Battery → Motor driver — XT60');
assert.equal(fa[1].conn, 1);
const fd = disassembleSteps(fm);
assert.equal(fd.length, 2);
assert.equal(fd[0].conn, 1);            // exact reverse of the recorded order
assert.equal(fd[0].verb, 'disconnect');
assert.equal(fd[0].text, 'Disconnect Motor driver → Motor — screw terminals');
assert.equal(fd[1].conn, 0);

// Partial placement falls back to the labelled layout, never mixed.
const partial = deriveTakeApart({ forge: { bom: forgeSpec.forge.bom,
  placement: [forgeSpec.forge.placement[0]], wiring: [] } });
assert.equal(partial.homeSource, 'layout');

// --- Stored Omega1 shape: spec.connections, endpoints are the parts
const conns = [
  ['Battery (2× 18650 in series)','PCA9685 PWM hat','Power — 7.4 V nominal pack'],
  ['PCA9685 PWM hat','Front-left motor','I2C 0x40 · PWM ch 1 fwd / ch 0 back · 50 Hz'],
  ['PCA9685 PWM hat','Rear-left motor','I2C 0x40 · PWM ch 2 fwd / ch 3 back · 50 Hz'],
  ['PCA9685 PWM hat','Front-right motor','I2C 0x40 · PWM ch 7 fwd / ch 6 back · 50 Hz'],
  ['PCA9685 PWM hat','Rear-right motor','I2C 0x40 · PWM ch 5 fwd / ch 4 back · 50 Hz'],
  ['PCA9685 PWM hat','Pan servo','PWM ch 8'],
  ['PCA9685 PWM hat','Tilt servo','PWM ch 9'],
  ['Raspberry Pi 4B','HC-SR04','GPIO 27 TRIG · GPIO 22 ECHO · front'],
  ['Raspberry Pi 4B','Line-tracking IR ×3','GPIO 14 / 15 / 23'],
  ['Raspberry Pi 4B','ADS1115 battery ADC','I2C 0x48'],
  ['Raspberry Pi 4B','OV5647 camera','CSI'],
].map(([from,to,detail]) => ({ from, to, detail, evidence:'DOCUMENTED' }));
const om = deriveTakeApart({ name:'Omega1', connections: conns });
assert.equal(om.source, 'connections');
assert.equal(om.homeSource, 'layout');
assert.equal(om.connections.length, 11);
assert.equal(om.parts.length, 13);
const oa = assembleSteps(om);
assert.equal(oa[0].text, 'Connect Battery (2× 18650 in series) → PCA9685 PWM hat — Power — 7.4 V nominal pack');
const od = disassembleSteps(om);
assert.ok(od.every((s,i) => s.conn === 10 - i && s.verb === 'disconnect'));

// Layout is deterministic: same spec, same homes.
assert.deepEqual(deriveTakeApart({ connections: conns }).home, om.home);

// --- Wiring-bench record
const wm = deriveTakeApart({ wiring: {
  nodes: [{id:'pack', label:'Battery pack'}, {id:'buck', label:'5 V buck'}],
  connections: [{from:'pack', to:'buck', kind:'power', label:'pack lead'}] } });
assert.equal(wm.source, 'wiring');
assert.equal(assembleSteps(wm)[0].text, 'Connect Battery pack → 5 V buck — pack lead');

// --- Bare spec: parts but no connections -> free canvas, no steps
const sm = deriveTakeApart({ battery:{chemistry:'liion', voltage_v:7.4},
  motor:{count:2, kind:'dc_gearmotor'}, wheel:{count:4, driven:true},
  sensors:[{kind:'ultrasonic', position:'front'}] });
assert.equal(sm.source, 'spec');
assert.equal(sm.connections.length, 0);
assert.equal(sm.parts.length, 4);
assert.equal(assembleSteps(sm).length, 0);

// --- No record at all
const none = deriveTakeApart({});
assert.equal(none.source, 'none');
assert.equal(none.parts.length, 0);
assert.equal(deriveTakeApart(null).source, 'none');

// --- Explode + restored bookkeeping on a simple chain A -> B -> C
const chain = deriveTakeApart({ connections: [
  {from:'A', to:'B', detail:'d1'}, {from:'B', to:'C', detail:'d2'} ] });
const pos = { ...chain.home };
assert.equal(restoredCount(chain, pos), 2);
const ex = explodedPos(chain, 'C');
assert.ok(!isHomeAt(ex, chain.home.C));
assert.ok(ex.x >= 10 && ex.x <= 90 && ex.y >= 12 && ex.y <= 76);
assert.deepEqual(explodedPos(chain, 'C'), ex); // deterministic
pos.C = ex;
assert.equal(restoredCount(chain, pos), 1);
pos.C = { ...chain.home.C };
assert.equal(restoredCount(chain, pos), 2);   // the memory: it goes back

// --- 3D model resolution order: twin -> scan -> stage -> none
assert.equal(resolveModelSource({ isOmega1:true,  scanFormat:'glb', hasDims:true  }), 'twin');
assert.equal(resolveModelSource({ isOmega1:false, scanFormat:'ply', hasDims:true  }), 'scan');
assert.equal(resolveModelSource({ isOmega1:false, scanFormat:null,  hasDims:true  }), 'stage');
assert.equal(resolveModelSource({ isOmega1:false, scanFormat:null,  hasDims:false }), 'none');

console.log('take-apart behaviour OK');
"""
    (tmp_path / "check.mjs").write_text(script)
    out = subprocess.run([node, "check.mjs"], cwd=tmp_path,
                         capture_output=True, text=True, timeout=120)
    assert out.returncode == 0, out.stderr + out.stdout
    assert "take-apart behaviour OK" in out.stdout
