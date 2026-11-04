"""Library ownership, source deduplication and explicit robot associations."""
from pathlib import Path
import subprocess
ROOT=Path(__file__).resolve().parents[1]
def test_parts_library(tmp_path):
    lib=ROOT/'web-next/src/lib'
    for name in ['partsLibrary','inventory']:
        (tmp_path/f'{name}.ts').write_text((lib/f'{name}.ts').read_text().replace("from './inventory'", "from './inventory.ts'"))
    (tmp_path/'package.json').write_text('{"type":"module"}')
    (tmp_path/'run.mjs').write_text('''
import assert from 'node:assert/strict';
import {libraryItems,catalogItems,parseLibraryCommand,changeLibrary,robotMatches,categoryFor,saveCadDesign,mergeLibraryExport} from './partsLibrary.ts';
import {partReality} from './inventory.ts';
const old={id:'p',name:'Battery',category:'battery',quantity:2,reality:'real',specs:{},status:'confirmed',source:'manual',chat:[],createdAt:'t'};
const web={id:'web1',name:'Web motor',category:'actuators',specs:{voltage_v:12},provenance:{sourceUrl:'https://example.test/motor',fetchedAt:'t',sourceKind:'scrape'},verification:'WEB-SOURCED — UNVERIFIED'};
const cat=catalogItems([{id:'motor1',name:'Gearmotor',part_class:'actuators',specs:{voltage_v:12}}]);
assert.equal(categoryFor('actuators','MG996R Servo'),'servo');
assert.equal(libraryItems([old],[web])[0].quantity,2);
assert.equal(libraryItems([],[web])[0].ownership,'wishlist');
assert.equal(partReality(libraryItems([],[web])[0]),'sim_only');
const robots=[{id:'r',name:'Omega1',versions:[{spec:{forge:{bom:[{partId:'motor1'}]}}}]}];
assert.equal(robotMatches(cat[0],robots)[0].kind,'suggested');
assert.equal(robotMatches({...cat[0],catalog_part_id:'unknown'},robots).length,0);
for(const q of ['Would you save Gearmotor?','Do not save Gearmotor to my wishlist'])assert.equal(parseLibraryCommand(q),null);
let result=changeLibrary([],[],cat,robots,parseLibraryCommand('Save "Gearmotor" to my wishlist'),'t','new');
assert.equal(result.parts[0].ownership,'wishlist');
assert.equal(partReality(result.parts[0]),'sim_only');
result=changeLibrary(result.parts,[],cat,robots,parseLibraryCommand('I own 4 "Gearmotor"'),'t','unused');
assert.equal(result.parts.length,1);assert.equal(result.parts[0].quantity,4);assert.equal(partReality(result.parts[0]),'real');
result=changeLibrary(result.parts,[],cat,robots,parseLibraryCommand('Plan "Gearmotor" for "Omega1"'),'t','unused');
assert.equal(result.parts[0].robot_links[0].kind,'planned');
assert.equal(robotMatches(result.parts[0],robots)[0].kind,'planned');
assert.throws(()=>changeLibrary([old,{...old,id:'p2'}],[],cat,robots,parseLibraryCommand('Mark "Battery" as wishlist'),'t','x'),/unique/i);
assert.throws(()=>changeLibrary(result.parts,[],cat,[{...robots[0],archivedAt:'t'}],parseLibraryCommand('Plan "Gearmotor" for "Omega1"'),'t','x'),/robot/i);
const savedWeb=changeLibrary([], [web],cat,robots,parseLibraryCommand('Mark "Web motor" as owned'),'t','w').parts;
assert.equal(libraryItems(savedWeb,[web]).length,1);
assert.equal(savedWeb[0].source_url,web.provenance.sourceUrl);
const rename=parseLibraryCommand('Rename part "Gearmotor" to "Bench motor"');
const renamed=changeLibrary(result.parts,[],cat,robots,rename,'t','x').parts;
assert.equal(renamed[0].name,'Bench motor');
const category=parseLibraryCommand('Set category of "Bench motor" to Sensors');
assert.equal(changeLibrary(renamed,[],cat,robots,category,'t','x').parts[0].category,'sensor');
const voltage=parseLibraryCommand('Set "Bench motor" voltage to 12 V');
assert.equal(changeLibrary(renamed,[],cat,robots,voltage,'t','x').parts[0].specs.voltage_v,12);
assert.equal(parseLibraryCommand('Set "Bench motor" voltage to -12 V'),null);
const cad={filename:'mounting_plate.scad',template:'mounting_plate',params:[{key:'length_mm',value:80}],source:'cube([80,60,3]);'};
const designs=saveCadDesign([],cad,'make a plate','t','d');
assert.equal(designs[0].origin,'custom');assert.equal(designs[0].ownership,'wishlist');
const rev=saveCadDesign(designs,{...cad,source:'cube([100,60,3]);'},'make it longer','t2','unused','d');
assert.equal(rev.length,1);assert.equal(rev[0].design.versions.length,2);assert.equal(designs[0].design.versions.length,1);
const owned=[{...designs[0],ownership:'owned',reality:'real',quantity:3}];
const fork=saveCadDesign(owned,cad,'make a revision','t3','revision','d');
assert.equal(fork.length,2);assert.equal(fork[0].quantity,3);assert.equal(fork[1].ownership,'wishlist');
const tree=[{...old,id:'parent',robot_id:'r'}, {...old,id:'child',parent_id:'parent',robot_id:'r'}];
const moved=changeLibrary(tree,[],cat,robots,parseLibraryCommand('Make "parent" shared'),'t','x').parts;
assert.equal(moved[1].parent_id,'parent');assert.equal(moved[1].robot_id,null);assert.deepEqual(moved[1].robot_links,[]);
const planned=changeLibrary(tree,[],cat,robots,parseLibraryCommand('Plan "parent" for "Omega1"'),'t','x').parts;
assert.deepEqual(planned[1].robot_links,planned[0].robot_links);
assert.equal(parseLibraryCommand('Save https://example.test/model to my wishlist'),null);
const archived=changeLibrary(tree,[],cat,robots,parseLibraryCommand('Archive part "parent"'),'now','x').parts;
assert.equal(archived[0].archivedAt,'now');assert.equal(archived[1].parent_id,null);
assert.equal(partReality(archived[0]),'real');
assert.throws(()=>changeLibrary(archived,[],cat,robots,parseLibraryCommand('Mark "parent" as owned'),'t','x'),/Restore/);
assert.equal(libraryItems(archived,[]).length,1);
const restored=changeLibrary(archived,[],cat,robots,parseLibraryCommand('Restore part "parent"'),'t','x').parts;
assert.equal(restored[0].archivedAt,undefined);
const nested=changeLibrary([{...old,id:'parent'}, {...old,id:'child'}],[],cat,robots,parseLibraryCommand('Nest "child" inside "parent"'),'t','x').parts;
assert.equal(nested[1].parent_id,'parent');
assert.throws(()=>changeLibrary(nested,[],cat,robots,parseLibraryCommand('Nest "parent" inside "child"'),'t','x'),/itself/);
const imported=mergeLibraryExport({format:'robotforge-library-v1',parts:[...designs,old],webParts:[web]},[],[]);
assert.equal(imported.added,3);assert.equal(imported.parts[0].design.versions.length,1);
assert.equal(imported.parts[0].ownership,'wishlist');
assert.equal(mergeLibraryExport({format:'robotforge-library-v1',parts:[...designs,old],webParts:[web]},imported.parts,imported.web).added,0);
assert.equal(old.quantity,2);
''')
    r=subprocess.run(['node','--experimental-strip-types',str(tmp_path/'run.mjs')],capture_output=True,text=True)
    assert r.returncode==0,r.stdout+r.stderr
