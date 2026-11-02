#!/usr/bin/env python3
"""Convert ProjectSim USD assets (USDC) to web GLBs.

Used for the Omega1 digital twin (docs/omega1/TWIN.md): reads the
downloaded ProjectSim USD files and writes the GLBs committed under
assets/omega1-twin/. Requires: pip install usd-core trimesh pillow
fast-simplification. Input is a JSON jobs file: [[usd_path, glb_path], ...]


Route: pxr (usd-core) reads the stage -> per-mesh geometry is extracted
with world transforms, triangulated, regrouped by USD link (rover) and
material bucket, and rebuilt as a trimesh Scene -> GLB (Y-up).
Only the material's base-colour texture is carried over (downscaled);
metallic/roughness/normal maps are dropped for the web build.
Collision-purpose meshes (under any `Collisions` prim) are excluded.
"""
import json
import sys
from pathlib import Path

import numpy as np
import trimesh
from PIL import Image
from pxr import Usd, UsdGeom, UsdShade, Gf

# Z-up (USD) -> Y-up (glTF): x'=x, y'=z, z'=-y. Proper rotation (det +1).
Z_TO_Y = np.array([[1, 0, 0], [0, 0, 1], [0, -1, 0]], dtype=np.float64)

TEX_MAX = 1024


def shader_inputs(mat_prim):
    """Return the UsdPreviewSurface inputs of a material prim."""
    mat = UsdShade.Material(mat_prim)
    surf = mat.GetSurfaceOutput()
    if not surf:
        return {}
    src = surf.GetConnectedSource()
    if not src or not src[0]:
        return {}
    shader = UsdShade.Shader(src[0])
    out = {}
    for inp in shader.GetInputs():
        v = inp.Get()
        if v is not None:
            out[inp.GetBaseName()] = ('value', v)
            continue
        conn = inp.GetConnectedSource()
        if conn and conn[0]:
            sh2 = UsdShade.Shader(conn[0])
            f = sh2.GetInput('file')
            if f and f.Get() is not None:
                out[inp.GetBaseName()] = ('texture', str(f.Get().path))
    return out


def resolve_tex(usd_dir: Path, asset_path: str) -> Path:
    p = asset_path.replace('@', '')
    return (usd_dir / p).resolve()


def load_texture(path: Path) -> Image.Image:
    im = Image.open(path).convert('RGB')
    if max(im.size) > TEX_MAX:
        im.thumbnail((TEX_MAX, TEX_MAX), Image.LANCZOS)
    return im


def mesh_geometry(prim, xcache, usd_dir, tex_cache):
    """Extract one USD mesh -> (group, bucket_key, vertices, faces, uvs, color)."""
    mesh = UsdGeom.Mesh(prim)
    pts = np.asarray(mesh.GetPointsAttr().Get(), dtype=np.float64)
    if len(pts) == 0:
        return None
    counts = np.asarray(mesh.GetFaceVertexCountsAttr().Get(), dtype=np.int64)
    indices = np.asarray(mesh.GetFaceVertexIndicesAttr().Get(), dtype=np.int64)

    # World transform -> numpy 4x4
    m = xcache.GetLocalToWorldTransform(prim)
    M = np.array([[m[i][j] for j in range(4)] for i in range(4)], dtype=np.float64).T
    world = (M[:3, :3] @ pts.T).T + M[:3, 3]
    world = world @ Z_TO_Y.T

    # UV primvar 'st'
    pv_api = UsdGeom.PrimvarsAPI(prim)
    st = pv_api.GetPrimvar('st')
    uvs = None
    st_interp = None
    if st and st.Get():
        uvs = np.asarray(st.Get(), dtype=np.float64)
        st_interp = st.GetInterpolation()

    # Triangulate (fan) keeping corner -> (point idx, uv idx)
    corners_p, corners_uv = [], []
    offset = 0
    for c in counts:
        face_idx = indices[offset:offset + c]
        if st_interp == 'faceVarying':
            face_uv = list(range(offset, offset + c))
        elif st_interp == 'vertex':
            face_uv = list(face_idx)
        else:
            face_uv = [None] * c
        for k in range(1, c - 1):
            corners_p += [face_idx[0], face_idx[k], face_idx[k + 1]]
            corners_uv += [face_uv[0], face_uv[k], face_uv[k + 1]]
        offset += c
    corners_p = np.asarray(corners_p, dtype=np.int64)

    # Material bucket
    bound = UsdShade.MaterialBindingAPI(prim).ComputeBoundMaterial()[0]
    bucket = 'default'
    tex_img = None
    color = np.array([0.72, 0.75, 0.79], dtype=np.float64)
    if bound:
        inputs = shader_inputs(bound)
        dc = inputs.get('diffuseColor')
        if dc and dc[0] == 'texture':
            tex_path = resolve_tex(usd_dir, dc[1])
            if tex_path.exists():
                bucket = f'tex:{tex_path.name}'
                if bucket not in tex_cache:
                    tex_cache[bucket] = load_texture(tex_path)
                tex_img = tex_cache[bucket]
            elif dc[1]:
                bucket = 'default'
        elif dc and dc[0] == 'value':
            v = dc[1]
            color = np.array([v[0], v[1], v[2]], dtype=np.float64)
            bucket = 'col:' + ','.join(f'{x:.3f}' for x in color)

    path = str(prim.GetPath())
    parts = [s for s in path.split('/') if s]
    group = parts[1] if len(parts) > 2 else 'part'

    if tex_img is not None and uvs is not None and len(corners_uv) and corners_uv[0] is not None:
        uv_arr = np.asarray([uvs[i] for i in corners_uv], dtype=np.float64)
        uv_arr[:, 1] = 1.0 - uv_arr[:, 1]  # USD st origin bottom-left vs image top-left handling in trimesh
        key = list(zip(corners_p.tolist(), corners_uv))
        uniq = {}
        verts, uv_out, faces = [], [], []
        for n, k in enumerate(key):
            if k not in uniq:
                uniq[k] = len(verts)
                verts.append(world[k[0]])
                uv_out.append(uv_arr[n])
            faces.append(uniq[k])
        geo = trimesh.Trimesh(vertices=np.array(verts), faces=np.array(faces).reshape(-1, 3), process=False)
        geo.visual = trimesh.visual.TextureVisuals(uv=np.array(uv_out), image=tex_img)
        return group, bucket, geo

    # Untextured: weld by point index, flat colour via vertex colours
    faces = corners_p.reshape(-1, 3)
    geo = trimesh.Trimesh(vertices=world, faces=faces, process=False)
    rgba = np.zeros((len(world), 4), dtype=np.uint8)
    rgba[:, :3] = np.clip(color * 255, 0, 255).astype(np.uint8)
    rgba[:, 3] = 255
    geo.visual = trimesh.visual.ColorVisuals(geo, vertex_colors=rgba)
    return group, bucket, geo


def convert(usd_path: Path, out_path: Path):
    stage = Usd.Stage.Open(str(usd_path))
    scale = UsdGeom.GetStageMetersPerUnit(stage)
    xcache = UsdGeom.XformCache()
    tex_cache: dict = {}
    buckets: dict = {}  # (group, bucket) -> [geometries]
    skipped = 0
    for prim in stage.Traverse():
        if prim.GetTypeName() != 'Mesh':
            continue
        p = str(prim.GetPath())
        if '/Collisions/' in p or p.endswith('/Collisions'):
            skipped += 1
            continue
        img = UsdGeom.Imageable(prim)
        if img and img.GetPurposeAttr().Get() in ('guide',):
            skipped += 1
            continue
        r = mesh_geometry(prim, xcache, usd_path.parent, tex_cache)
        if r is None:
            continue
        group, bucket, geo = r
        if scale != 1.0:
            geo.vertices *= scale
        buckets.setdefault((group, bucket), []).append(geo)

    scene = trimesh.Scene()
    for group in sorted({g for g, _ in buckets}):
        scene.graph.update(frame_to=group, frame_from=scene.graph.base_frame,
                           matrix=np.eye(4))
    total_faces = 0
    for (group, bucket), geos in sorted(buckets.items()):
        merged = trimesh.util.concatenate(geos)
        if len(merged.faces) > 20000:
            try:
                cand = merged.simplify_quadric_decimation(
                    face_count=int(len(merged.faces) * 0.5))
                # fast-simplification can silently drop texture visuals;
                # a textured bucket keeps its texture or is not simplified.
                if isinstance(merged.visual, trimesh.visual.TextureVisuals) and \
                        not isinstance(cand.visual, trimesh.visual.TextureVisuals):
                    print(f'  simplify reverted ({bucket}): texture would be lost')
                else:
                    merged = cand
            except Exception as e:  # keep the undecimated mesh rather than fail
                print(f'  simplify skipped ({bucket}): {e}')
        total_faces += len(merged.faces)
        name = f'{group}__{abs(hash(bucket)) % 99999:05d}'
        scene.add_geometry(merged, node_name=name, geom_name=name, parent_node_name=group)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    scene.export(str(out_path), file_type='glb')
    size = out_path.stat().st_size
    print(f'{out_path.name}: groups={len(set(x for x, _ in buckets))} buckets={len(buckets)} '
          f'faces={total_faces} skipped_collision={skipped} size={size/1e6:.2f} MB')
    return size


def jpeg_rewrite(glb_path: Path):
    """Re-encode embedded PNG textures as JPEG inside a GLB (smaller)."""
    import io
    import struct
    data = glb_path.read_bytes()
    assert data[:4] == b'glTF'
    jlen = struct.unpack('<I', data[12:16])[0]
    gltf = json.loads(data[20:20 + jlen])
    bin_off = 20 + jlen
    blen = struct.unpack('<I', data[bin_off:bin_off + 4])[0]
    bin_data = data[bin_off + 8:bin_off + 8 + blen]
    if not gltf.get('images'):
        return
    jpg_for_view = {}
    for img in gltf['images']:
        if img.get('mimeType') != 'image/png':
            continue
        bv = gltf['bufferViews'][img['bufferView']]
        raw = bin_data[bv.get('byteOffset', 0):bv.get('byteOffset', 0) + bv['byteLength']]
        im = Image.open(io.BytesIO(raw)).convert('RGB')
        buf = io.BytesIO()
        im.save(buf, format='JPEG', quality=82)
        jpg_for_view[img['bufferView']] = buf.getvalue()
        img['mimeType'] = 'image/jpeg'
    if not jpg_for_view:
        return
    new_views, chunks, cur = [], [], 0
    for i, bv in enumerate(gltf['bufferViews']):
        raw = jpg_for_view.get(i) or bin_data[bv.get('byteOffset', 0):bv.get('byteOffset', 0) + bv['byteLength']]
        nv = {'buffer': 0, 'byteOffset': cur, 'byteLength': len(raw)}
        if 'target' in bv:
            nv['target'] = bv['target']
        if 'byteStride' in bv:
            nv['byteStride'] = bv['byteStride']
        new_views.append(nv)
        chunks.append(raw)
        cur += len(raw)
        pad = (-cur) % 4
        if pad:
            chunks.append(b'\x00' * pad)
            cur += pad
    gltf['bufferViews'] = new_views
    new_bin = b''.join(chunks)
    gltf['buffers'][0]['byteLength'] = len(new_bin)
    js = json.dumps(gltf, separators=(',', ':')).encode()
    js += b' ' * ((-len(js)) % 4)
    out = b'glTF' + struct.pack('<II', 2, 12 + 8 + len(js) + 8 + len(new_bin))
    out += struct.pack('<I', len(js)) + b'JSON' + js
    out += struct.pack('<I', len(new_bin)) + b'BIN\x00' + new_bin
    glb_path.write_bytes(out)


if __name__ == '__main__':
    jobs = json.loads(Path(sys.argv[1]).read_text())
    total = 0
    for usd, out in jobs:
        convert(Path(usd), Path(out))
        jpeg_rewrite(Path(out))
        total += Path(out).stat().st_size
        print(f'  after JPEG textures: {out} = {Path(out).stat().st_size/1e6:.2f} MB')
    print(f'TOTAL GLB: {total/1e6:.2f} MB')
