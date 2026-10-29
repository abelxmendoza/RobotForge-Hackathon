"""Dependency-free rover mesh bundles. Metres, right-handed Z-up.

Visual refinement never replaces the motion gate's primitive collisions or
inertias. These are spec-shaped approximations, not calibrated CAD.
"""
from __future__ import annotations

import hashlib
import json
import math
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path

from .schema import RobotSpec, SpecError, spec_is_estimated
from .urdf import generate_urdf
from .twin import generate_sdf, generate_world
from .validate import has_errors, validate


def box(size):
    x, y, z = (v / 2 for v in size)
    vertices = [(-x,-y,-z),(x,-y,-z),(x,y,-z),(-x,y,-z),
                (-x,-y,z),(x,-y,z),(x,y,z),(-x,y,z)]
    faces = [(0,2,1),(0,3,2),(4,5,6),(4,6,7),(0,1,5),(0,5,4),
             (1,2,6),(1,6,5),(2,3,7),(2,7,6),(3,0,4),(3,4,7)]
    return vertices, faces


def cylinder(radius, length, segments=48):
    vertices = [(radius*math.cos(i*2*math.pi/segments),
                 radius*math.sin(i*2*math.pi/segments), z)
                for z in (-length/2, length/2) for i in range(segments)]
    vertices += [(0,0,-length/2),(0,0,length/2)]
    faces = []
    for i in range(segments):
        j = (i+1) % segments
        faces += [(2*segments,j,i),(2*segments+1,i+segments,j+segments),
                  (i,j,j+segments),(i,j+segments,i+segments)]
    return vertices, faces


def inspect_mesh(vertices, faces):
    errors = []
    if not vertices or not faces:
        return {"valid": False, "errors": ["empty mesh"]}
    if any(not math.isfinite(x) for v in vertices for x in v):
        return {"valid": False, "errors": ["non-finite vertex"]}
    edges = Counter()
    volume = 0.0
    for face in faces:
        if len(face) != 3 or any(i < 0 or i >= len(vertices) for i in face):
            errors.append("invalid triangle index")
            continue
        a, b, c = (vertices[i] for i in face)
        u = [b[i]-a[i] for i in range(3)]
        v = [c[i]-a[i] for i in range(3)]
        cross = (u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0])
        if sum(x*x for x in cross) <= 1e-28:
            errors.append("degenerate triangle")
        bc = (b[1]*c[2]-b[2]*c[1], b[2]*c[0]-b[0]*c[2], b[0]*c[1]-b[1]*c[0])
        volume += sum(a[i]*bc[i] for i in range(3))/6
        for i,j in zip(face, (face[1],face[2],face[0])):
            edges[(i,j)] += 1
    watertight = all(n == 1 and edges[(j,i)] == 1 for (i,j),n in edges.items())
    if not watertight:
        errors.append("open, non-manifold or inconsistently wound surface")
    if volume <= 0:
        errors.append("non-positive signed volume")
    bounds = [[min(v[i] for v in vertices) for i in range(3)],
              [max(v[i] for v in vertices) for i in range(3)]]
    return {"valid": not errors, "errors": sorted(set(errors)), "watertight": watertight,
            "vertices": len(vertices), "triangles": len(faces), "bounds_m": bounds,
            "dimensions_m": [bounds[1][i]-bounds[0][i] for i in range(3)], "volume_m3": volume}


def _obj(vertices, faces):
    return '# RobotForge procedural mesh; units: metres; SPDX-License-Identifier: Apache-2.0\n' + ''.join(
        'v '+' '.join(f'{x:.12g}' for x in v)+'\n' for v in vertices) + ''.join(
        'f '+' '.join(str(i+1) for i in f)+'\n' for f in faces)


def write_bundle(spec: RobotSpec, directory: Path):
    if has_errors(validate(spec)):
        raise SpecError('mesh export requires a valid spec')
    expected = 2 if spec.drivetrain == 'differential' else 4
    if spec.drivetrain not in ('differential', 'skid_steer') or spec.wheel.count != expected:
        raise SpecError('mesh bundles currently support differential (2 wheels) and skid_steer (4 wheels) rovers')
    directory.mkdir(parents=True, exist_ok=True)
    (directory/'meshes').mkdir(exist_ok=True)
    report = {"schema_version": 1, "units": "m", "robot": spec.name,
              "estimated": spec_is_estimated(spec),
              "spec_sha256": hashlib.sha256(json.dumps(spec.to_dict(), sort_keys=True).encode()).hexdigest(), "physics_verified": False,
              "scope": "Spec-shaped visual approximation. Primitive collisions and original inertias preserved. Sensor sizes are assumptions; sensors are visual only.",
              "assets": [], "parts": []}
    urdf = ET.fromstring(generate_urdf(spec))
    sdf = ET.fromstring(generate_sdf(spec))
    model = sdf.find('model')
    meshes = {}

    def asset(key, shape, dimensions, segments=48):
        if key in meshes:
            return meshes[key]
        vertices, faces = box(dimensions) if shape == 'box' else cylinder(*dimensions, segments)
        check = inspect_mesh(vertices, faces)
        expected_dimensions = list(dimensions) if shape == 'box' else [2*dimensions[0],2*dimensions[0],dimensions[1]]
        if any(not math.isclose(actual, expected, rel_tol=1e-9, abs_tol=1e-12)
               for actual, expected in zip(check.get('dimensions_m', []), expected_dimensions)):
            raise SpecError(f'mesh {key}: dimensions differ from requested geometry')
        check['expected_dimensions_m'] = expected_dimensions
        if not check['valid']:
            raise SpecError(f'mesh {key}: {check["errors"]}')
        filename = f'meshes/{key}.obj'
        text = _obj(vertices, faces)
        (directory/filename).write_text(text)
        entry = {"file": filename, "role": "collision reference" if key.endswith("-collision") else "visual", "source": "RobotForge procedural generator", "license": "Apache-2.0",
                 "sha256": hashlib.sha256(text.encode()).hexdigest(), **check}
        report['assets'].append(entry)
        meshes[key] = (filename, vertices, faces)
        return meshes[key]

    # Replace visual geometry only, using the existing poses verbatim.
    for link in model.findall('link'):
        visual = link.find('visual')
        geometry = visual.find('geometry')
        shape = geometry[0]
        if shape.tag == 'sphere':
            continue  # passive caster primitives stay unchanged
        dims = [float(v) for v in shape.findtext('size').split()] if shape.tag == 'box' else [float(shape.findtext('radius')), float(shape.findtext('length'))]
        key = 'chassis' if shape.tag == 'box' else 'wheel'
        filename, vertices, faces = asset(key, shape.tag, dims)
        asset(key+'-collision', shape.tag, dims, 12)
        geometry.clear()
        ET.SubElement(ET.SubElement(geometry,'mesh'),'uri').text = filename
        pose = [float(v) for v in link.findtext('pose').split()]
        vp = [float(v) for v in visual.findtext('pose','0 0 0 0 0 0').split()]
        report['parts'].append({"name":link.get('name'), "asset":filename, "xyz":pose[:3], "rpy":vp[3:],
                                "vertices":vertices, "faces":faces, "assumed":False})
    for link in urdf.findall('link'):
        geometry = link.find('visual/geometry')
        key = 'chassis' if link.get('name') == 'base_link' else 'wheel'
        geometry.clear()
        ET.SubElement(geometry,'mesh',filename=f'meshes/{key}.obj')

    # Cosmetic sensors: no mass or collision is invented for the gate.
    for i,sensor in enumerate(spec.sensors):
        kind = sensor.kind.lower()
        if not any(k in kind for k in ('camera','lidar','laser','ultrasonic')):
            continue
        lidar = 'lidar' in kind or 'laser' in kind
        key = f'sensor-{i}'
        filename, vertices, faces = asset(key, 'cylinder' if lidar else 'box',
                                          [.035,.025] if lidar else [.025,.05,.025])
        xyz = [0.0,0.0,spec.ground_clearance_m+spec.height_m+.02]
        if sensor.position == 'front': xyz[0] = spec.length_m/2
        if sensor.position == 'rear': xyz[0] = -spec.length_m/2
        if sensor.position == 'left': xyz[1] = spec.width_m/2
        if sensor.position == 'right': xyz[1] = -spec.width_m/2
        report['parts'].append({"name":sensor.kind, "asset":filename,"xyz":xyz,"rpy":[0,0,0],
                                "vertices":vertices,"faces":faces,"assumed":True})
        sv = ET.SubElement(model.find("link[@name='base_link']"),'visual',name=key)
        relative = [xyz[0],xyz[1],xyz[2]-(spec.ground_clearance_m+spec.height_m/2)]
        ET.SubElement(sv,'pose').text = ' '.join(map(str,relative))+' 0 0 0'
        ET.SubElement(ET.SubElement(ET.SubElement(sv,'geometry'),'mesh'),'uri').text = filename
        ul = ET.SubElement(urdf,'link',name=key)
        ET.SubElement(ET.SubElement(ET.SubElement(ul,'visual'),'geometry'),'mesh',filename=filename)
        uj = ET.SubElement(urdf,'joint',name=key+'-joint',type='fixed')
        ET.SubElement(uj,'parent',link='base_link')
        ET.SubElement(uj,'child',link=key)
        ET.SubElement(uj,'origin',xyz=' '.join(map(str,[xyz[0],xyz[1],xyz[2]-(spec.ground_clearance_m+spec.height_m/2)])))
    (directory/'robot.urdf').write_text(ET.tostring(urdf,encoding='unicode'))
    (directory/'model.sdf').write_text(ET.tostring(sdf,encoding='unicode'))
    (directory/'world.sdf').write_text(generate_world(spec,str((directory/'model.sdf').resolve())))
    (directory/'spec.json').write_text(json.dumps(spec.to_dict(),indent=2)+'\n')
    from .mesh_viewer import viewer_html
    (directory/'viewer.html').write_text(viewer_html(report))
    # Large triangle data stays in the self-contained viewer, not the audit manifest.
    manifest = {**report, 'parts': [{k:v for k,v in p.items() if k not in ('vertices','faces')} for p in report['parts']]}
    (directory/'assets.json').write_text(json.dumps(manifest,indent=2)+'\n')
    return manifest
