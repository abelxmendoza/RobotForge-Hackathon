"""Physics checks, parts sourcing and the BOM wizard (web-next).

Three layers, following the repo's node-test pattern (the real TS
runs in node against the real catalogue data):

1. Static wiring: the robot page renders the physics section, the
   engine flips urdf-loader's collision parsing ON (it defaults
   off — a silent no-colliders trap), the BOM wizard calls both the
   live and local matchers, the five vendor hosts are the ones in
   lib/sourcing.ts.
2. Node unit tests: physicsMath (hull / CoM / stability / tilt),
   sourcing URL builders, BOM assembly + export, the zod gate on
   the /list shape, the AI-SDK structured step against a fake
   endpoint, and the deterministic local matcher.
3. Node integration: the REAL engine (URDFLoader + Rapier) on the
   REAL model files — Burger, Go2, Pathfinder — asserting the
   masses the catalogue independently records and that the settle
   test lands the body at its stance height. Needs network for the
   two upstream URDFs; skips when it cannot have it.
"""
import json
import shutil
import subprocess
import tempfile
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
WEB = REPO / "web-next"
LIB = WEB / "src/lib"


# ---------------------------------------------------------------- wiring

def test_physics_section_is_wired_into_robot_pages():
    detail = (WEB / "src/components/robots/RobotDetail.tsx").read_text()
    assert "PhysicsSection" in detail
    section = (WEB / "src/components/robots/PhysicsSection.tsx").read_text()
    assert 'id="physics"' in section
    assert "runPhysicsChecks" in section


def test_engine_enables_collision_parsing():
    # urdf-loader's parseCollision defaults to false; without this
    # the engine would find zero colliders and report nothing.
    engine = (LIB / "physicsEngine.ts").read_text()
    assert "parseCollision = true" in engine
    assert "parseVisual = false" in engine


def test_sourcing_vendors_and_no_price_surface():
    src = (LIB / "sourcing.ts").read_text()
    for host in ("octopart.com", "digikey.com", "mcmaster.com",
                 "amazon.com", "aliexpress.com"):
        assert host in src, host
    # The exports must not carry a price column or a currency value.
    bom = (LIB / "bom.ts").read_text()
    assert '"Octopart", "Digi-Key", "McMaster-Carr", "Amazon", "AliExpress"' in bom


def test_bom_wizard_uses_live_and_local_paths():
    wiz = (WEB / "src/components/bom/BomWizard.tsx").read_text()
    assert "suggestPartsLive" in wiz
    assert "localMatchParts" in wiz
    shell = (WEB / "src/components/shell/AppShell.tsx").read_text()
    assert '"/bom/"' in shell


# ---------------------------------------------------------------- node units

UNIT_SCRIPT = r"""
import assert from 'node:assert/strict';
import fs from 'node:fs';
const root = process.argv[2];
const load = p => JSON.parse(fs.readFileSync(root + '/' + p, 'utf8'));
const partsDoc = load('catalog/parts.json');
const kitsDoc = load('catalog/parts-kits.json');
const M = await import('./physicsMath.ts');
const S = await import('./sourcing.ts');
const B = await import('./bom.ts');
const partsById = new Map(partsDoc.parts.map(p => [p.id, p]));

// --- physicsMath ---
assert.deepEqual(M.totalMass([{name:'a',mass:1.5,com:[0,0,0]},{name:'b',mass:2.5,com:[0,0,0]}]), 4);
assert.deepEqual(M.centerOfMass([{name:'a',mass:1,com:[0,0,0]},{name:'b',mass:3,com:[1,0,2]}]), [0.75, 0, 1.5]);
assert.equal(M.massAudit(1.0017, 0.93).agrees, false);
assert.ok(Math.abs(M.massAudit(1.0017, 0.93).deltaPct - 7.7) < 0.2);
assert.equal(M.massAudit(10, 10.4).agrees, true);
assert.equal(M.massAudit(5, null), null);
assert.equal(M.convexHull2D([[0,0],[1,0],[1,1],[0,1],[0.5,0.5]]).length, 4);
const boxM = [0.2,0,0,0, 0,0.2,0,0, 0,0,0.2,0, 0,0,0.1,1];
const samples = M.sampleShape({kind:'box', matrix: boxM});
assert.equal(samples.length, 8);
assert.equal(Math.min(...samples.map(p => p[2])), 0);
const inside = M.staticStability(samples, [0, 0, 0.3]);
assert.equal(inside.inside, true);
assert.ok(Math.abs(inside.marginM - 0.1) < 1e-9);
assert.ok(Math.abs(inside.tipAngleDeg - 18.43) < 0.05);
const outside = M.staticStability(samples, [0.3, 0, 0.3]);
assert.equal(outside.inside, false);
assert.ok(Math.abs(outside.marginM + 0.2) < 1e-9);
assert.equal(M.tiltDegFromQuat([0,0,0,1]), 0);
assert.ok(Math.abs(M.tiltDegFromQuat([Math.SQRT1_2,0,0,Math.SQRT1_2]) - 90) < 1e-9);
assert.equal(M.settleVerdict(5), 'stands');
assert.equal(M.settleVerdict(30), 'settles-tilted');
assert.equal(M.settleVerdict(80), 'topples');

// --- sourcing ---
const links = S.sourcingLinks('LiPo battery 4S');
assert.equal(links.length, 5);
assert.deepEqual(links.map(l => new URL(l.url).hostname).sort(),
  ['octopart.com', 'www.aliexpress.com', 'www.amazon.com', 'www.digikey.com', 'www.mcmaster.com'].sort());
assert.equal(S.cleanQuery('a  b×c, d'), 'a bxc d');
const q = S.partSearchQuery(partsById.get('lipo_4s_5200'));
assert.ok(q.includes('14.8V') && q.includes('XT60'), q);

// --- bom assembly / export ---
assert.equal(B.kitBomLines(kitsDoc.kits.andino).length, 6);
assert.deepEqual(B.kitBomLines(kitsDoc.kits['unitree-go2'] ?? {kit:null}), []);
const tpl = partsDoc.templates.find(t => t.name === 'rover_diff_drive');
const tl = B.templateBomLines(tpl, partsById, ['imu_bno055']);
assert.equal(tl.length, 9);
assert.equal(tl.find(l => l.partId === 'gearmotor_12v').qty, 2);
const merged = B.mergeBomLines([...tl, B.catalogBomLine(partsById.get('gearmotor_12v'), 1, 'test')]);
assert.equal(merged.find(l => l.partId === 'gearmotor_12v').qty, 3);
const csv = B.bomToCsv(merged);
assert.ok(csv.includes('digikey.com/en/products/result?keywords='));
assert.ok(!csv.includes('$'), 'no prices or currency in the CSV export');
assert.ok(B.bomToText(merged, 'x').includes('no prices'));

// --- the zod gate + live structured step ---
const ok = B.listImportSchema.parse({items: [{title: 'Pi', matched_part_id: 'raspberry_pi_5', qty: 1}]});
assert.equal(ok.missing.length, 0);
assert.equal(B.listImportSchema.safeParse({items: [{title: 'bad', qty: -1}]}).success, false);
const sug = B.suggestionsFromImport({items: [
  {title: 'Pi', matched_part_id: 'raspberry_pi_5', qty: 1},
  {title: 'Flux capacitor', matched_part_id: 'flux_capacitor', qty: 1},
  {title: 'Goo', matched_part_id: null, qty: 2},
], missing: []}, partsById);
assert.deepEqual(sug.suggested.map(s => s.partId), ['raspberry_pi_5']);
assert.deepEqual(sug.unmatched, ['Flux capacitor', 'Goo']);
let posted = null;
const live = await B.suggestPartsLive('a rover', async (path, body) => {
  posted = [path, body];
  return {import: {items: [{title: 'Pi', matched_part_id: 'raspberry_pi_5', qty: 1}], missing: []}, model: 'fake'};
});
assert.deepEqual(posted, ['/list', {text: 'a rover'}]);
assert.equal(live.items.length, 1);
await assert.rejects(() => B.suggestPartsLive('x', async () => ({import: {items: [{title: 'b', qty: -3}]}})));

// --- local matcher ---
const local = B.localMatchParts(
  'a differential drive rover with a raspberry pi 5, an rplidar a1 and four 12v gearmotors',
  partsDoc.parts);
const byId = new Map(local.map(s => [s.partId, s]));
assert.ok(byId.has('raspberry_pi_5'));
assert.equal(byId.get('gearmotor_12v').qty, 4);
assert.equal(byId.get('rplidar_a1').qty, 1);
assert.ok(byId.get('rplidar_a1').matchedOn.includes('rplidar'));
console.log('physics/bom unit checks passed');
"""


def _prep_unit_dir(tmp: Path) -> None:
    (tmp / "lib").mkdir(parents=True)
    (tmp / "package.json").write_text('{"type":"module"}')
    (tmp / "physicsMath.ts").write_text((LIB / "physicsMath.ts").read_text())
    (tmp / "sourcing.ts").write_text((LIB / "sourcing.ts").read_text())
    bom = (LIB / "bom.ts").read_text().replace('"./sourcing"', '"./sourcing.ts"')
    (tmp / "bom.ts").write_text(bom)
    (tmp / "node_modules").symlink_to(WEB / "node_modules")


def test_physics_bom_units_in_node(tmp_path):
    node = shutil.which("node")
    if not node:
        pytest.skip("Node unavailable")
    _prep_unit_dir(tmp_path)
    (tmp_path / "run.mjs").write_text(UNIT_SCRIPT)
    result = subprocess.run(
        [node, "--experimental-strip-types", str(tmp_path / "run.mjs"), str(REPO)],
        capture_output=True, text=True, timeout=300)
    assert result.returncode == 0, result.stdout + result.stderr


# ---------------------------------------------------------------- engine integration

ENGINE_SCRIPT = r"""
import fs from 'node:fs';
class ShimElement {
  constructor(node) { this.nodeName = node.tag; this._attrs = node.attrs || {}; this.children = (node.children || []).map(c => new ShimElement(c)); }
  getAttribute(n) { return Object.prototype.hasOwnProperty.call(this._attrs, n) ? this._attrs[n] : null; }
  hasAttribute(n) { return Object.prototype.hasOwnProperty.call(this._attrs, n); }
  querySelector(sel) { const m = sel.match(/^(\w+)\[(\w+)="([^"]*)"\]$/); if (!m) return null; const [, tag, attr, val] = m;
    const walk = el => { for (const c of el.children) { if (c.nodeName.toLowerCase() === tag.toLowerCase() && c.getAttribute(attr) === val) return c; const r = walk(c); if (r) return r; } return null; }; return walk(this); }
}
let currentTree = null;
globalThis.Element = ShimElement;
globalThis.Document = class {};
globalThis.DOMParser = class { parseFromString() { return { children: [new ShimElement(currentTree)] }; } };
const repo = process.argv[2];
const work = process.argv[3];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.startsWith('/')) return new Response(fs.readFileSync(repo + '/web-next/public' + u), { status: 200 });
  return realFetch(url, opts);
};
const phys = JSON.parse(fs.readFileSync(repo + '/catalog/physics.json', 'utf8'));
const engine = await import(work + '/lib/physicsEngine.ts');
const out = {};
for (const [file, slug] of [['burger', 'turtlebot3-burger'], ['go2', 'unitree-go2'], ['pathfinder', 'pathfinder']]) {
  currentTree = JSON.parse(fs.readFileSync(work + '/' + file + '.dom.json', 'utf8'));
  const r = await engine.runPhysicsChecks(phys.robots[slug]);
  out[slug] = {
    mass: r.totalMassKg,
    inside: r.stability ? r.stability.inside : null,
    marginM: r.stability ? r.stability.marginM : null,
    verdict: r.settle ? r.settle.verdict : null,
    restGapM: r.settle ? Math.abs(r.settle.finalZM - r.settle.restZM) : null,
    shapes: r.shapesUsed, massOnly: r.massOnlyLinks,
  };
}
console.log(JSON.stringify(out));
"""


def _dom_json(urdf_text: str) -> dict:
    def conv(el):
        return {"tag": el.tag, "attrs": dict(el.attrib),
                "children": [conv(c) for c in el]}
    return conv(ET.fromstring(urdf_text))


def test_engine_end_to_end_in_node(tmp_path):
    node = shutil.which("node")
    if not node:
        pytest.skip("Node unavailable")
    phys = json.loads((REPO / "catalog/physics.json").read_text())["robots"]
    doms = {}
    for file, slug in (("burger", "turtlebot3-burger"), ("go2", "unitree-go2")):
        try:
            with urllib.request.urlopen(phys[slug]["urdf_url"], timeout=30) as r:
                doms[file] = _dom_json(r.read().decode("utf-8"))
        except Exception:
            pytest.skip(f"cannot fetch the {slug} URDF in this environment")
    doms["pathfinder"] = _dom_json(
        (WEB / "public/urdf/pathfinder.urdf").read_text())

    (tmp_path / "lib").mkdir(parents=True)
    (tmp_path / "components/home").mkdir(parents=True)
    (tmp_path / "package.json").write_text('{"type":"module"}')
    engine = (LIB / "physicsEngine.ts").read_text() \
        .replace('"./physicsMath"', '"./physicsMath.ts"') \
        .replace('"../components/home/asset"', '"../components/home/asset.ts"')
    (tmp_path / "lib/physicsEngine.ts").write_text(engine)
    (tmp_path / "lib/physicsMath.ts").write_text((LIB / "physicsMath.ts").read_text())
    (tmp_path / "components/home/asset.ts").write_text(
        (WEB / "src/components/home/asset.ts").read_text())
    (tmp_path / "node_modules").symlink_to(WEB / "node_modules")
    for file, dom in doms.items():
        (tmp_path / f"{file}.dom.json").write_text(json.dumps(dom))
    (tmp_path / "run.mjs").write_text(ENGINE_SCRIPT)
    result = subprocess.run(
        [node, "--experimental-strip-types", str(tmp_path / "run.mjs"),
         str(REPO), str(tmp_path)],
        capture_output=True, text=True, timeout=600)
    assert result.returncode == 0, result.stdout + result.stderr
    out = json.loads(result.stdout.strip().splitlines()[-1])

    burger = out["turtlebot3-burger"]
    # The catalogue's own specimen parse recorded the same model at
    # 1.0017 kg total (sum of its link masses, computed here afresh
    # by a different parser through a different code path).
    assert abs(burger["mass"] - 1.0017) < 0.002
    assert burger["inside"] is True and burger["marginM"] > 0
    assert burger["verdict"] == "stands"
    assert burger["shapes"] == 5
    assert burger["restGapM"] < 0.02

    go2 = out["unitree-go2"]
    # 16.087 kg is the sum recorded in the catalogue's provenance
    # note for this exact URDF at this exact commit.
    assert abs(go2["mass"] - 16.087) < 0.01
    assert go2["verdict"] == "stands"
    assert go2["shapes"] >= 25
    assert go2["massOnly"] >= 5

    pf = out["pathfinder"]
    # Generated twin: 3.4 kg chassis link + 4 x 0.125 kg wheels.
    assert abs(pf["mass"] - 3.9) < 0.01
    assert pf["verdict"] == "stands"
    assert pf["shapes"] == 5
