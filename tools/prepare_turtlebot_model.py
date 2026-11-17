"""Partition pinned ROBOTIS STL shells without changing any triangles. Input directory contains the four original meshes; writes model.json."""
import struct,collections,json
from pathlib import Path
import argparse,hashlib
parser=argparse.ArgumentParser();parser.add_argument('directory',type=Path);args=parser.parse_args()
b=(args.directory/'burger_base.stl').read_bytes();n=struct.unpack_from('<I',b,80)[0]
parent=list(range(n))
def root(a):
 while parent[a]!=a:
  parent[a]=parent[parent[a]];a=parent[a]
 return a
verts={};triangles=[]
for i in range(n):
 vs=struct.unpack_from('<9f',b,84+i*50+12);triangles.append(vs)
 for j in (0,3,6):
  key=tuple(round(x,3) for x in vs[j:j+3])
  if key in verts:
   a,c=root(i),root(verts[key]);parent[a]=c
  else:verts[key]=i
comps=collections.defaultdict(list)
for i in range(n):comps[root(i)].append(i)
print('triangles',n,'components',len(comps))
out=[]
for inds in comps.values():
 axes=[[triangles[i][j] for i in inds for j in range(a,9,3)] for a in range(3)]
 lo=[round(min(v),3) for v in axes];hi=[round(max(v),3) for v in axes]
 out.append({'triangles':len(inds),'min':lo,'max':hi,'center':[round((a+c)/2,3) for a,c in zip(lo,hi)],'indices':inds})
out.sort(key=lambda x:-x['triangles'])
# Source shells are preserved exactly. Names/materials/inspection groups are
# RobotForge annotations, not a new manufacturer BOM or service sequence.
parts={}
def add(key,name,color,explode):
 parts[key]={'id':key,'name':name,'color':color,'explode':explode,'file':'burger_base.stl','position':[-.032,0,.010],'scale':.001,'ranges':[],'shellCount':0,'evidence':'manufacturer mesh; RobotForge grouping'}
for i,z in enumerate([0,37.5,85,132.5]):add('plate-'+str(i),['Bottom waffle plate','Motor deck waffle plate','Computer deck waffle plate','Lidar deck waffle plate'][i],'#252d32',[0,0,.06+i*.05])
for key,name,color,e in [
 ('motor-left','Left DYNAMIXEL drive assembly','#30383f',[0,.14,0]),('motor-right','Right DYNAMIXEL drive assembly','#30383f',[0,-.14,0]),
 ('battery','Battery and retaining hardware','#252c35',[-.17,0,0]),('caster','Rear caster assembly','#9ba0a6',[-.14,0,-.025]),
 ('opencr','OpenCR controller and connectors','#247e6b',[-.16,0,.11]),('pi','Raspberry Pi board and connectors','#237e58',[.16,0,.18]),
 ('lower-pillars','Lower plate supports','#a5a8ac',[0,0,.10]),('middle-pillars','Middle plate supports','#a5a8ac',[0,0,.20]),('upper-pillars','Upper plate supports','#a5a8ac',[0,0,.30])]:add(key,name,color,e)
for i in range(4):add('hardware-'+str(i),['Bottom deck fasteners','Motor deck fasteners','Computer deck fasteners','Lidar deck fasteners'][i],'#9ba0a6',[.10 if i%2 else -.10,0,.08+i*.07])

def ranges(indices):
 result=[]
 for i in sorted(indices):
  if result and result[-1][0]+result[-1][1]==i:result[-1][1]+=1
  else:result.append([i,1])
 return result
for i,c in enumerate(out):
 x,y,z=c['center']
 if i<4:key='plate-'+str(i)
 elif i in [9,84,85,86,87,253]:key='caster'
 elif i in range(176,180):key='lower-pillars'
 elif i in [180,181,188,189]:key='middle-pillars'
 elif i in range(182,188):key='upper-pillars'
 elif i==132 or i in [11,12,13,14,15,36,252]:key='battery'
 elif z<38 and abs(y)>34 and i not in range(96,112):key='motor-left' if y>0 else 'motor-right'
 elif i in [19,20,21,22,31,32,33,34,39] or (48<z<84 and abs(x)<55 and abs(y)<40):key='opencr'
 elif i in [6,10,16,17,18,23,24,25,26,35,133] or (98<z<132 and abs(x)<62 and abs(y)<46):key='pi'
 else:key='hardware-'+str(min(range(4),key=lambda j:abs(z-[4.5,42,89.5,137][j])))
 parts[key]['ranges']+=ranges(c['indices']);parts[key]['shellCount']+=1
# The separate manufacturer wheel and scanner meshes use their recorded URDF poses.
for key,name,file,pos,explode,color in [
 ('wheel-left','Left wheel and tire','left_tire.stl',[0,.08,.033],[0,.22,0],'#202328'),
 ('wheel-right','Right wheel and tire','right_tire.stl',[0,-.08,.033],[0,-.22,0],'#202328'),
 ('lidar','LDS-01 laser scanner','lds.stl',[-.032,0,.182],[0,0,.4],'#252a30')]:
 add(key,name,color,explode);p=parts[key];p.update(file=file,position=pos,ranges=[[0,struct.unpack_from('<I',(args.directory/file).read_bytes(),80)[0]]],shellCount=1)
revision='fc817ce3073af1d6032397c64504134882af5e9a'
paths={'burger_base.stl':'bases/burger_base.stl','left_tire.stl':'wheels/left_tire.stl','right_tire.stl':'wheels/right_tire.stl','lds.stl':'sensors/lds.stl'}
sources=[{'file':f,'url':f'https://raw.githubusercontent.com/ROBOTIS-GIT/turtlebot3/{revision}/turtlebot3_description/meshes/{p}','sha256':hashlib.sha256((args.directory/f).read_bytes()).hexdigest(),'license':'Apache-2.0'} for f,p in paths.items()]
order=['lidar','hardware-3','plate-3','pi','upper-pillars','hardware-2','plate-2','opencr','middle-pillars','hardware-1','plate-1','battery','wheel-left','wheel-right','motor-left','motor-right','lower-pillars','hardware-0','caster','plate-0']
manifest={'schema':'robotforge.detailed-model.v1','robot':'TurtleBot3 Burger','revisionLabel':'ROBOTIS reference · LDS-01 / Pi-era geometry','sourceRevision':revision,'sources':sources,'sourceShells':len(out),'sourceTriangles':n,'assemblyEvidence':'Interpretive inspection order and separation paths. Source mesh geometry and URDF placements are preserved; grouping is not a verified physical assembly procedure. Cables and unpublished internals are not invented.','parts':list(parts.values()),'teardown':order}
(args.directory/'model.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(f'Preserved {n} base triangles, {len(out)} source shells, {len(parts)} inspectable groups')
