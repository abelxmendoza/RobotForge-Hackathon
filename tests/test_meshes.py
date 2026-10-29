import json
from pathlib import Path
import xml.etree.ElementTree as ET

import pytest

from robotforge.cli import main
from robotforge.meshes import box, cylinder, inspect_mesh, write_bundle
from robotforge.schema import RobotSpec, SpecError
from robotforge.twin import generate_sdf
from robotforge.urdf import generate_urdf

ROOT = Path(__file__).resolve().parents[1]


def spec():
    return RobotSpec.from_json((ROOT/'examples/pathfinder.json').read_text())


def test_topology_dimensions_and_corruption():
    vertices, faces = box([.4,.3,.1])
    report = inspect_mesh(vertices, faces)
    assert report['valid'] and report['volume_m3'] == pytest.approx(.012)
    assert report['dimensions_m'] == pytest.approx([.4,.3,.1])
    assert inspect_mesh(*cylinder(.05,.032))['valid']
    assert not inspect_mesh(vertices, faces[:-1])['valid']
    assert not inspect_mesh(vertices, [f[::-1] for f in faces])['valid']
    assert not inspect_mesh(vertices, faces+[(0,0,1)])['valid']
    assert not inspect_mesh([(float('nan'),0,0)], [(0,0,0)])['valid']


def test_bundle_preserves_physics_and_resolves_meshes(tmp_path):
    robot = spec()
    manifest = write_bundle(robot,tmp_path)
    before = ET.fromstring(generate_sdf(robot))
    after = ET.parse(tmp_path/'model.sdf').getroot()
    # Visuals are the sole model difference. Sensor visuals live on the
    # chassis; there are no new masses, joints, contacts or inertias.
    for root in (before,after):
        for link in root.findall('.//link'):
            for visual in link.findall('visual'):
                link.remove(visual)
    assert ET.tostring(before) == ET.tostring(after)
    for file,tag in [('robot.urdf','mesh'),('model.sdf','mesh')]:
        for mesh in ET.parse(tmp_path/file).findall('.//'+tag):
            uri = mesh.get('filename') or mesh.findtext('uri')
            assert (tmp_path/uri).is_file()
    assert all(x['valid'] and x['license'] for x in manifest['assets'])
    assert manifest['physics_verified'] is False
    assert any(p['assumed'] for p in manifest['parts'])
    first = (tmp_path/'assets.json').read_bytes()
    write_bundle(robot,tmp_path)
    assert (tmp_path/'assets.json').read_bytes() == first
    assert json.loads(first)['units'] == 'm'


def test_camera_lidar_and_script_escaping(tmp_path):
    robot = spec()
    robot.name = '</script><script>alert(1)</script>'
    sensor_type = type(robot.sensors[0])
    robot.sensors = [sensor_type(kind='camera',position='front'),sensor_type(kind='lidar',position='top')]
    result = write_bundle(robot,tmp_path)
    assert len([p for p in result['parts'] if p['assumed']]) == 2
    assert '<script>alert(1)' not in (tmp_path/'viewer.html').read_text()
    ET.parse(tmp_path/'model.sdf')


def test_cli_and_unsupported_layout(tmp_path):
    assert main(['assets',str(ROOT/'examples/pathfinder.json'),'--out-dir',str(tmp_path)]) == 0
    robot = spec()
    robot.wheel.count = 6
    with pytest.raises(SpecError):
        write_bundle(robot,tmp_path/'unsupported')
    assert not (tmp_path/'unsupported').exists()
