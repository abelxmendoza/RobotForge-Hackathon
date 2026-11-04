"""Web pictures for parts (Wrench finds, proposals) and the generated 3D
models every part gets in the part modal."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
LIB = ROOT / "web-next/src/lib"


def _run(tmp_path, script):
    (tmp_path / "package.json").write_text('{"type":"module"}')
    (tmp_path / "run.mjs").write_text(script)
    r = subprocess.run(["node", "--experimental-strip-types", str(tmp_path / "run.mjs")],
                       capture_output=True, text=True, cwd=tmp_path)
    assert r.returncode == 0, r.stdout + r.stderr


def test_web_pictures_store_and_finds(tmp_path):
    if not shutil.which("node"):
        pytest.skip("node unavailable")
    (tmp_path / "webParts.ts").write_text((LIB / "webParts.ts").read_text())
    _run(tmp_path, r"""
import assert from 'node:assert/strict';
import {extractImagesFromText,storeFromUrl,webFindsFromSearch,buildWebProposal,proposalToRecord,validateWebProposal} from './webParts.ts';
const md = `# TB6612FNG carrier
![logo](https://www.pololu.com/images/logo.png)
![board](https://a.pololu-files.com/picture/0J4617.1200x627.jpg?c=1)
![](/relative/only.jpg)
![tiny](https://x.test/img/32x32/thumb.png)
![anim](https://x.test/spin.gif)
Also https://cdn.example.com/p/back.webp here.
Price $5.49. Operating voltage: 4.5 V`;
const imgs = extractImagesFromText(md);
assert.deepEqual(imgs, ['https://a.pololu-files.com/picture/0J4617.1200x627.jpg?c=1', 'https://cdn.example.com/p/back.webp']);
assert.equal(storeFromUrl('https://www.pololu.com/product/713'), 'Pololu');
assert.equal(storeFromUrl('https://shop.example.org/x'), 'shop.example.org');
const p = buildWebProposal({mode:'scrape', url:'https://www.pololu.com/product/713', title:'TB6612FNG', markdown: md}, '2026-11-04T00:00:00Z');
assert.deepEqual(p.images, imgs);
assert.equal(p.store, 'Pololu');
// a picture that is not on the page fails the honesty gate
assert.ok(validateWebProposal({...p, images:['https://evil.test/made-up.jpg']}, md).some(e => e.includes('picture')));
const rec = proposalToRecord(p, 't');
assert.equal(rec.images.length, 2); assert.equal(rec.store, 'Pololu');
const finds = webFindsFromSearch({mode:'search', results:[{url:'https://www.adafruit.com/product/2448', title:'TB6612 breakout', markdown:'![x](https://cdn-shop.adafruit.com/2448.jpg) $4.95'}, {url:'not a url'}]});
assert.equal(finds.length, 1);
assert.deepEqual(finds[0], {url:'https://www.adafruit.com/product/2448', title:'TB6612 breakout', store:'Adafruit', image:'https://cdn-shop.adafruit.com/2448.jpg', price:'$4.95'});
assert.deepEqual(webFindsFromSearch({mode:'scrape'}), []);
""")


def test_every_part_kind_gets_a_3d_model_inside_its_size(tmp_path):
    three = ROOT / "web-next/node_modules/three/build/three.module.js"
    if not shutil.which("node") or not three.exists():
        pytest.skip("Optional web dependencies unavailable")
    (tmp_path / "componentSkin.ts").write_text((ROOT / "web-next/src/components/kit/componentSkin.ts").read_text())
    (tmp_path / "partModel3d.ts").write_text((LIB / "partModel3d.ts").read_text()
                                             .replace("'../components/kit/componentSkin'", "'./componentSkin.ts'"))
    _run(tmp_path, f"""
import assert from 'node:assert/strict';
import * as THREE from {json.dumps(str(three))};
import {{partShape,buildPartModel,disposeModel}} from './partModel3d.ts';
const parts = [['LiPo 3S 2200','battery'],['12V gearmotor','motor'],['2207 1960KV brushless','motor'],['NEMA 17 stepper','motor'],
 ['MG996R servo','servo'],['Wheel','wheel',{{diameter_m:0.1,width_m:0.032}}],['5040 propeller','other',{{diameter_mm:127}}],['Raspberry Pi 5','computer'],
 ['Jetson Orin Nano','computer'],['ESP32 DevKit','controller'],['TB6612 motor driver','motor_driver'],['5V buck converter','power'],
 ['ELRS receiver','radio'],['RealSense D435','sensor'],['Pi camera module','sensor'],['RPLIDAR A1','sensor'],['HC-SR04 ultrasonic','sensor'],
 ['BNO055 IMU','sensor'],['Mounting plate','frame',{{length_mm:80,width_mm:60,height_mm:3}}],['XT60 pigtail','cable'],['Screwdriver','tool'],
 ['E-stop button','other'],['Mystery widget','other']];
const kinds = new Set();
for (const [name, category, specs] of parts) {{
  const shape = partShape({{name, category, specs}});
  kinds.add(shape.kind);
  const g = buildPartModel(THREE, shape);
  const b = new THREE.Box3().setFromObject(g);
  assert.ok(!b.isEmpty(), name);
  ['x','y','z'].forEach((a, i) => {{
    assert.ok(b.max[a] <= shape.size[i] / 2 * 1.02 + 1e-6 && -b.min[a] <= shape.size[i] / 2 * 1.02 + 1e-6, name + ' outside its envelope on ' + a);
  }});
  disposeModel(g);
}}
assert.equal(kinds.size, parts.length, 'each sample maps to its own kind');
let s = partShape({{name:'Wheel', category:'wheel', specs:{{diameter_m:0.1, width_m:0.032}}}});
assert.equal(s.sizeBasis, 'specs'); assert.deepEqual(s.size.map(v => Math.round(v*1000)), [100, 32, 100]);
s = partShape({{name:'Mounting plate', category:'frame', specs:{{length_mm:80, width_mm:60, height_mm:3}}}});
assert.deepEqual(s.size.map(v => Math.round(v*1000)), [80, 60, 3]);
assert.equal(partShape({{name:'Odd thing', category:'other'}}).sizeBasis, 'typical');
""")
