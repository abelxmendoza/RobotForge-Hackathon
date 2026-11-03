"""Web knowledge loop + CAD generation (2026-11-03, Abel's order:
the full loop, staged PR). Chat-driven only — no new UI: a pasted
product page becomes a structured proposal IN CHAT, an explicit
"yes" lands it in the browser-local web parts store, confirmed
records feed the Forge Engine's catalogue view flagged
WEB-SOURCED — UNVERIFIED, robot-directed proposals apply as new
versions with engine checks re-run, and chat-stated dimensions
generate parametric OpenSCAD (ESTIMATED/PLANNED).

What is pinned here:

- lib/webParts.ts and lib/cadGen.ts are pure, zero-import modules
  (the webIntent/forgeEngine convention), driven in node below.
- Proposal honesty, enforced by validateWebProposal: a numeric
  spec must carry the exact fetched-text snippet it was read from
  (its basis); a price must literally appear in the fetched text;
  the verification label is exact. A search result can never
  become a proposal — one page, one source.
- Intent is conservative: questions never produce proposals; the
  confirm/discard classifier is a closed set.
- The store is pure list ops over rf.webparts.v1; mergeCatalogue
  never lets a web record shadow a built-in catalogue id.
- Engine integration: a build that adds a web part gains the
  'unverified-web-parts' WARN (existing severity) naming it; a
  built-in-only build has no such check.
- CAD: four templates, chat-stated dimensions become parameters,
  unspecified parameters fall back to defaults LABELED as defaults
  in the source, and the header stamps ESTIMATED / PLANNED.
- Integration pins (source): ChatDock owns propose/confirm/land,
  gated off in demo; the Create panel and the Workshop Modify box
  pass the merged catalogue; the wrench layer stays untouched.

Skips (no node) follow the established convention: the source
assertions below still run.
"""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web-next"
LIB = WEB / "src" / "lib"
SRC = WEB / "src"

WEBPARTS = (LIB / "webParts.ts").read_text()
CADGEN = (LIB / "cadGen.ts").read_text()
ENGINE_TS = (LIB / "forgeEngine.ts").read_text()
CHATDOCK = (SRC / "components/chat/ChatDock.tsx").read_text()
CREATE = (SRC / "components/chat/ComposerCreate.tsx").read_text()
GARAGE_TSX = (SRC / "components/garage/Garage.tsx").read_text()
STORE_TS = (LIB / "store.ts").read_text()
DEMOMODE = (LIB / "demoMode.ts").read_text()
CATALOGUE = json.loads((ROOT / "catalog/parts.json").read_text())


# --- Source pins (always run) -------------------------------------------

def test_new_libs_are_pure_and_zero_import():
    for src in (WEBPARTS, CADGEN):
        assert "import " not in src
        assert "window" not in src and "document" not in src
    for fn in ("buildWebProposal", "validateWebProposal", "classifyProposalReply",
               "detectWebAddIntent", "proposalToRecord", "addWebRecord",
               "mergeCatalogue", "toCataloguePart", "recordWebAddition",
               "formatProposalText", "formatSavedText"):
        assert ("export function " + fn) in WEBPARTS, fn
    for fn in ("parseCadRequest", "generateCad", "cadFromText"):
        assert ("export function " + fn) in CADGEN, fn
    assert "rf.webparts.v1" in WEBPARTS
    assert "WEB-SOURCED — UNVERIFIED" in WEBPARTS


def test_engine_flags_web_parts_with_existing_warn():
    assert "web_sourced" in ENGINE_TS
    assert "'unverified-web-parts', verdict: 'WARN'" in ENGINE_TS
    # No new severity was invented for this.
    assert "ForgeVerdict = 'PASS' | 'WARN' | 'ERROR' | 'NOT_CHECKED'" in ENGINE_TS


def test_chatdock_owns_the_loop_and_demo_is_inert():
    for marker in ("pendingWebProposal", "proposeFromWeb", "landWebProposal",
                   "classifyProposalReply(q)", "buildWebProposal(body",
                   "proposalToRecord(pending.proposal", "recordWebAddition(",
                   "runEngineChecks(newSpec, catalogue)"):
        assert marker in CHATDOCK, marker
    # The interception is demo-gated, and so is the CAD branch.
    assert "!demoRef.current && detectWebAddIntent(q)" in CHATDOCK
    assert "cadFromText(q)" in CHATDOCK
    # Reset clears the pending proposal with the other pendings.
    assert "pendingWebProposal.current = null;" in CHATDOCK
    # The save is deterministic caller code: the proposal path never
    # routes through the live model.
    propose = CHATDOCK[CHATDOCK.index("const proposeFromWeb"):CHATDOCK.index("const landWebProposal")]
    assert "liveChat" not in propose and "proposeViaLive" not in propose


def test_engine_call_sites_pass_the_merged_catalogue():
    assert "mergeCatalogue(" in CREATE and "engineCatalogue()" in CREATE
    assert "generateRobot(brief, engineCatalogue())" in CREATE
    assert "applyModification(spec, text, engineCatalogue())" in CREATE
    assert "mergeCatalogue(" in GARAGE_TSX
    assert "applyModification(draft, text, catalogue)" in GARAGE_TSX
    # The download pattern for the .scad hand-off lives in store.ts.
    assert "export function downloadText(" in STORE_TS
    # Demo isolation: the web parts store gets a demo twin like
    # every other visitor-data store.
    assert "'rf.webparts.v1'," in DEMOMODE


def test_wrench_layer_untouched_by_the_loop():
    engine = (SRC / "components/chat/engine.ts").read_text()
    wrench = (SRC / "components/chat/wrench.ts").read_text()
    for src in (engine, wrench):
        assert "webParts" not in src and "cadGen" not in src


# --- Behaviour in node ----------------------------------------------------

DRIVER = """
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as wp from './webParts.ts';
import * as cad from './cadGen.ts';
import { generateRobot, applyModification, runEngineChecks, syncPlannedPart } from './forgeEngine.ts';
const here = fileURLToPath(new URL('.', import.meta.url));
const cat = JSON.parse(readFileSync(here + 'parts.json', 'utf8')).parts;

const MD = [
  '# Acme Dual Motor Driver X2',
  '',
  'Dual-channel H-bridge motor driver board.',
  '',
  'Operating voltage: 4.5-13.5 V',
  'Continuous output current: 1.2 A per channel',
  'Weight: 7 g',
  '',
  'Now $12.95 each.',
].join('\\n');
const scrape = { mode: 'scrape', url: 'https://example.com/acme-x2', title: 'Acme Dual Motor Driver X2', markdown: MD };
const AT = '2026-11-03T12:00:00.000Z';

// --- Proposal build + validation --------------------------------
const p = wp.buildWebProposal(scrape, AT);
assert.ok(p, 'proposal built from a scrape');
assert.equal(p.name, 'Acme Dual Motor Driver X2');
assert.equal(p.category, 'drivers');
assert.equal(p.kind, 'part');
assert.equal(p.specs.voltage_v.value, '4.5-13.5');
assert.ok(MD.includes(p.specs.voltage_v.sourceText), 'voltage basis is literal page text');
assert.equal(p.specs.current_a.value, 1.2);
assert.equal(p.specs.mass_g.value, 7);
assert.deepEqual(p.priceEstimate, { amountUsd: 12.95, text: '$12.95' });
assert.equal(p.provenance.sourceUrl, 'https://example.com/acme-x2');
assert.equal(p.provenance.sourceKind, 'scrape');
assert.equal(p.verification, 'WEB-SOURCED — UNVERIFIED');
assert.deepEqual(wp.validateWebProposal(p, MD), []);

// A search result is never a record source.
assert.equal(wp.buildWebProposal({ mode: 'search', query: 'x', results: [] }, AT), null);
// No page text, no proposal.
assert.equal(wp.buildWebProposal({ ...scrape, markdown: '  ' }, AT), null);

// Rejection: a numeric spec whose basis is not in the page.
const forged = JSON.parse(JSON.stringify(p));
forged.specs.voltage_v = { value: 24, sourceText: '24 V' };
assert.ok(wp.validateWebProposal(forged, MD).some((e) => e.includes('voltage_v')), 'unbased numeric spec rejected');
// Rejection: a price that is not literally on the page.
const forgedPrice = JSON.parse(JSON.stringify(p));
forgedPrice.priceEstimate = { amountUsd: 1, text: '$1.00' };
assert.ok(wp.validateWebProposal(forgedPrice, MD).length > 0, 'invented price rejected');
// Rejection: the verification label may not be upgraded.
const upgraded = JSON.parse(JSON.stringify(p));
upgraded.verification = 'VERIFIED';
assert.ok(wp.validateWebProposal(upgraded, MD).length > 0, 'label upgrade rejected');
// Conversion keeps the stated snippet as its basis.
const conv = wp.extractSpecsFromText('Peak current: 1500 mA\\nTorque: 5 kg-cm');
assert.equal(conv.current_a.value, 1.5);
assert.equal(conv.current_a.sourceText, '1500 mA');
assert.equal(conv.stall_torque_nm.value, 0.49);

// --- Intent + reply classification --------------------------------
assert.deepEqual(wp.detectWebAddIntent('add this motor https://example.com/x'), { kind: 'add' });
assert.deepEqual(wp.detectWebAddIntent('use this driver for Omega1 https://example.com/x'),
  { kind: 'robot', robotName: 'Omega1' });
assert.deepEqual(wp.detectWebAddIntent('add this to my build https://example.com/x'), { kind: 'add' });
assert.equal(wp.detectWebAddIntent('what does this page say about drivers? https://example.com/x'), null);
assert.equal(wp.detectWebAddIntent('how do I use this driver?'), null);
assert.equal(wp.detectWebAddIntent('tell me about Andino'), null);
assert.equal(wp.classifyProposalReply('yes'), 'confirm');
assert.equal(wp.classifyProposalReply('Save it'), 'confirm');
assert.equal(wp.classifyProposalReply('no'), 'discard');
assert.equal(wp.classifyProposalReply('never mind'), 'discard');
assert.equal(wp.classifyProposalReply('maybe later'), 'ambiguous');
assert.equal(wp.classifyProposalReply('what about the price?'), 'ambiguous');
assert.equal(wp.isShortReply('hmm not sure'), true);
assert.equal(wp.isShortReply('actually let me think about which robot this belongs on first'), false);

// --- Presentation ---------------------------------------------------
const text = wp.formatProposalText(p);
assert.ok(text.includes('Acme Dual Motor Driver X2'));
assert.ok(text.includes('WEB-SOURCED — UNVERIFIED'));
assert.ok(text.includes('https://example.com/acme-x2'));
assert.ok(text.includes('Nothing is saved yet'));
const robotText = wp.formatProposalText(p, { robotName: 'Omega1', changes: [{ path: 'battery.voltage_v', before: 11.1, after: 14.8 }] });
assert.ok(robotText.includes('battery.voltage_v: 11.1 → 14.8'));
assert.ok(robotText.includes('NEW version of “Omega1”'));

// --- Store ops ------------------------------------------------------
const rec = wp.proposalToRecord(p, AT);
assert.ok(rec.id.startsWith('web-'));
assert.equal(rec.specs.voltage_v, '4.5-13.5');
assert.equal(rec.priceEstimate.text, '$12.95');
assert.equal(rec.priceEstimate.sourceUrl, 'https://example.com/acme-x2');
let list = wp.addWebRecord([], rec);
assert.equal(list.length, 1);
list = wp.addWebRecord(list, { ...rec, name: 'Acme Dual Motor Driver X2 (rev 2)' });
assert.equal(list.length, 1, 'same id refreshes, never duplicates');
assert.equal(wp.removeWebRecord(list, rec.id).length, 0);

// --- Engine integration ---------------------------------------------
const merged = wp.mergeCatalogue(cat, [rec]);
assert.equal(merged.length, cat.length + 1);
const webEntry = merged.find((x) => x.id === rec.id);
assert.equal(webEntry.web_sourced, true);
assert.equal(webEntry.part_class, 'drivers');
// A web record may never shadow a built-in id.
const shadow = wp.mergeCatalogue(cat, [{ ...rec, id: 'driver_tb6612fng' }]);
assert.equal(shadow.length, cat.length);
assert.equal(shadow.find((x) => x.id === 'driver_tb6612fng').web_sourced, undefined);

// Built-in-only build: no unverified check anywhere.
const plain = generateRobot('build a rover', cat);
assert.ok(!plain.forge.checks.some((c) => c.id === 'unverified-web-parts'));
// Adding the web part by name lands it on the BOM and the checks
// flag it, by name, as a WARN.
const modded = applyModification(plain, 'add Acme Dual Motor Driver X2', merged);
assert.ok(modded, 'generic add-by-name applies to a web part');
assert.ok(modded.spec.forge.bom.some((b) => b.partId === rec.id));
const warn = modded.spec.forge.checks.find((c) => c.id === 'unverified-web-parts');
assert.ok(warn && warn.verdict === 'WARN', 'checks surface the unverified dependency');
assert.ok(warn.detail.includes('Acme Dual Motor Driver X2'));
assert.ok(warn.detail.includes('UNVERIFIED'));
assert.ok(modded.summary.includes('UNVERIFIED'));
// Unknown and ambiguous adds still refuse.
assert.equal(applyModification(plain, 'add a flux capacitor', merged), null);
assert.equal(applyModification(modded.spec, 'add Acme Dual Motor Driver X2', merged), null, 'no duplicate adds');

// Confirmed proposal paths must update the same engine BOM/checks as chat mods.
const synced = syncPlannedPart(plain, webEntry, merged);
assert.ok(synced.forge.bom.some((b) => b.partId === rec.id));
assert.equal(synced.forge.checks.find((c) => c.id === 'unverified-web-parts').verdict,'WARN');
assert.ok(synced.forge.checks.find((c) => c.id === 'unpowered').detail.includes(rec.id));
const pack = {id:'web_pack24',name:'24 V pack',part_class:'batteries',specs:{voltage_v:24,capacity_mah:5000},web_sourced:true};
const packCat = [...cat,pack];
const replaced = syncPlannedPart({...plain,battery:{...plain.battery,voltage_v:24}},pack,packCat,'battery');
assert.equal(replaced.forge.ids.battery,pack.id);
assert.ok(replaced.forge.bom.some((b) => b.partId === pack.id));
assert.ok(!replaced.forge.bom.some((b) => b.partId === plain.forge.ids.battery));
assert.ok(replaced.forge.wiring.some((w) => w.from === pack.id && w.volts === 24));
assert.ok(replaced.forge.checks.some((c) => c.id.includes('voltage-') && c.verdict === 'ERROR'));
assert.deepEqual(replaced.forge.checks,runEngineChecks(replaced,packCat));
assert.notEqual(plain.forge.ids.battery,pack.id,'original version remains unchanged');

// --- Robot additions --------------------------------------------------
const add1 = wp.recordWebAddition({ name: 'Omega1' }, rec);
assert.equal(add1.already, false);
assert.equal(add1.spec.added_parts.length, 1);
assert.ok(add1.spec.added_parts[0].recorded_from.startsWith('web — https://'));
assert.equal(add1.spec.added_parts[0].verification, 'WEB-SOURCED — UNVERIFIED');
const add2 = wp.recordWebAddition(add1.spec, rec);
assert.equal(add2.already, true);
assert.equal(add2.spec.added_parts.length, 1);

// --- CAD ---------------------------------------------------------------
const plate = cad.cadFromText('make a mounting plate 80x60, 3mm thick, M4 holes');
assert.equal(plate.template, 'mounting_plate');
assert.equal(plate.filename, 'mounting_plate.scad');
assert.ok(plate.source.includes('length_mm = 80;'));
assert.ok(plate.source.includes('width_mm = 60;'));
assert.ok(plate.source.includes('thickness_mm = 3;'));
assert.ok(plate.source.includes('hole_dia_mm = 4.2;'));
assert.ok(plate.source.includes('ESTIMATED / PLANNED'));
assert.ok(plate.source.includes('(DEFAULT — not specified, change if needed)'), 'unspecified params are labeled defaults');
assert.ok(plate.defaultsUsed.includes('Hole inset'));
assert.ok(plate.summary.includes('ESTIMATED'));
const bracket = cad.cadFromText('design an l-bracket 50x40');
assert.equal(bracket.template, 'l_bracket');
assert.ok(bracket.source.includes('leg_a_mm = 50;'));
const wheel = cad.cadFromText('make a wheel disc, 100mm diameter, 6mm bore');
assert.equal(wheel.template, 'wheel_disc');
assert.ok(wheel.source.includes('diameter_mm = 100;'));
assert.ok(wheel.source.includes('bore_dia_mm = 6;'));
assert.ok(wheel.source.includes('if (bolt_circle_dia_mm > 0)'), 'no bolt holes at a zero bolt circle');
const spacer = cad.cadFromText('generate a spacer 25mm long');
assert.equal(spacer.template, 'spacer');
assert.ok(spacer.source.includes('length_mm = 25;'));
const boredSpacer = cad.cadFromText('make a spacer 20mm long, bore diameter 3.2mm');
assert.ok(boredSpacer.source.includes('bore_dia_mm = 3.2;'));
assert.ok(boredSpacer.defaultsUsed.includes('Outer diameter'));
assert.ok(!boredSpacer.source.includes('outer_dia_mm = 3.2;'));
for (const qualifier of ['bore Ø3.2mm','hub diameter 4mm','bolt-circle diameter 30mm']) {
  const qualified = cad.cadFromText('make a spacer 20mm long, ' + qualifier);
  assert.ok(qualified.defaultsUsed.includes('Outer diameter'),qualifier);
}
// Every template generates a parameter-headed source with no params given.
for (const t of ['mounting plate', 'l bracket', 'wheel disc', 'spacer']) {
  const r = cad.cadFromText('make a ' + t);
  assert.ok(r && r.source.includes('$fn = 64;') && r.defaultsUsed.length > 0, t);
}
// Negatives: questions and robot talk are not CAD asks.
assert.equal(cad.parseCadRequest('what is a tb6612fng?'), null);
assert.equal(cad.parseCadRequest('tell me about Andino'), null);
assert.equal(cad.parseCadRequest("make Omega1's wheels bigger"), null);
assert.equal(cad.parseCadRequest('build a rover with lidar'), null);
assert.equal(cad.parseCadRequest('search the web for mounting plates'), null);

console.log('web-knowledge-loop driver: all assertions passed');
"""


def test_web_knowledge_loop_behaviour(tmp_path):
    node = shutil.which("node")
    if not node:
        pytest.skip("Node is unavailable")
    (tmp_path / "webParts.ts").write_text(WEBPARTS)
    (tmp_path / "cadGen.ts").write_text(CADGEN)
    (tmp_path / "forgeEngine.ts").write_text(ENGINE_TS)
    (tmp_path / "parts.json").write_text(json.dumps(CATALOGUE))
    (tmp_path / "package.json").write_text('{"type":"module"}')
    (tmp_path / "drive.mjs").write_text(DRIVER)
    r = subprocess.run([node, str(tmp_path / "drive.mjs")],
                       capture_output=True, text=True, timeout=300)
    assert r.returncode == 0, r.stdout + r.stderr
    assert "all assertions passed" in r.stdout
