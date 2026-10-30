"""Inventory stock counts, robot assignment, imports and stale chat proposals."""
import json
import shutil
import subprocess
from pathlib import Path
import pytest
ROOT=Path(__file__).resolve().parents[1]
def test_inventory_management(tmp_path):
    node=shutil.which('node')
    if not node: pytest.skip('Node unavailable')
    src=ROOT/'web-next/src/lib/inventory.ts'
    (tmp_path/'run.mjs').write_text(f'''
import assert from 'node:assert/strict';
import {{categoryHint,matchesInventory,countedPart,importedPart,parseInventoryCommand,proposeInventory,applyInventory,applyUpdate}} from {json.dumps(str(src))};
const p={{id:'p1',name:'Jetson',category:'computer',quantity:2,specs:{{model_number:'Orin Nano'}},photo:null,read_from_label:[],condition:'used',confidence:'owner',status:'confirmed',question:'',chat:[],createdAt:'t',source:'manual',robot_id:'r1',stock_location:'Shelf A'}};
assert.equal(categoryHint('motor_driver_L298N.jpg'),'motor_driver');
assert.equal(categoryHint('IMG001.jpg'),'other');
assert.equal(matchesInventory(p,'orin shelf','computer','r1'),true);
assert.equal(matchesInventory(p,'orin','battery','r1'),false);
assert.equal(matchesInventory(p,'','all','unassigned'),false);
assert.equal(countedPart(p,0,'now').quantity,0);assert.equal(countedPart(p,3,'now').last_counted_at,'now');
for(const value of [-1,1.5,Infinity,NaN])assert.throws(()=>countedPart(p,value,'t'));
assert.equal(applyUpdate(p,{{quantity:0}}).quantity,0);
const op=proposeInventory([p],[{{id:'r1',name:'Omega1'}}],parseInventoryCommand('set inventory "Jetson" quantity to 0'));
const next=applyInventory([p],op,'now');assert.equal(next[0].quantity,0);assert.equal(p.quantity,2);
assert.throws(()=>applyInventory(next,op,'later'),/changed/);
const assign=proposeInventory([p],[{{id:'r2',name:'Rover'}}],parseInventoryCommand('assign inventory "Jetson" to "Rover"'));
assert.equal(applyInventory([p],assign,'t')[0].robot_id,'r2');
assert.throws(()=>proposeInventory([p,{{...p,id:'p2'}}],[],{{kind:'quantity',name:'Jetson',quantity:1}}),/unique/);
assert.equal(parseInventoryCommand('list my parts for "Omega1"').robotName,'Omega1');
const restored=importedPart({{...p,photo_full:'big photo',photo:'https://tracking.example/image.png'}});
assert.equal(restored.photo,null);assert.equal(restored.photo_full,undefined);assert.equal(restored.robot_id,'r1');
assert.throws(()=>importedPart({{...p,quantity:-1}}));
assert.throws(()=>importedPart({{...p,category:'madeup'}}));
''')
    result=subprocess.run([node,'--experimental-strip-types',str(tmp_path/'run.mjs')],capture_output=True,text=True)
    assert result.returncode==0,result.stdout+result.stderr
