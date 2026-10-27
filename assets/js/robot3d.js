/* 3D take-apart (ES module; loaded only on robot pages, behind the
   importmap the generator emits). Renders the SAME kit the 2D views
   draw: geometry comes from taGeom3d/taBuildParts in robot.js —
   this file only turns those units into Three.js meshes. Three.js
   is pinned (0.160.0, jsDelivr — the same version kit.html ships)
   and imported dynamically inside activate(), so a CDN failure or a
   missing WebGL context lands in opts.onFail and the page shows
   "3D unavailable here — the 2D take-apart still works" instead of
   breaking. Coordinates are the robot's own (x forward, y left,
   z up), matching kit.html's Z-up convention. */
'use strict';

const PALETTE = {
  plate: 0x8a5a17, wheel: 0x22262e, mount: 0x3d4656, caster: 0x5b6472,
  lidar: 0x22262e, camera: 0x3d4656, ultrasonic: 0x3d4656,
  frame: 0x3d4656, arm: 0x51606f, rotor: 0x22262e, battery: 0x51606f,
  fc: 0x22262e, body: 0x51606f, leg: 0x3d4656, head: 0x22262e,
  pelvis: 0x3d4656, torso: 0x51606f, base: 0x8a5a17, link: 0x51606f,
  gripper: 0x22262e
};
const EDGE = {
  plate: 0xf59e0b, wheel: 0xe8eaee, mount: 0x9aa3ae, caster: 0x9aa3ae,
  lidar: 0xe8eaee, camera: 0x9aa3ae, ultrasonic: 0x9aa3ae,
  frame: 0xf59e0b, arm: 0x9aa3ae, rotor: 0xe8eaee, battery: 0x9aa3ae,
  fc: 0x34d399, body: 0xf59e0b, leg: 0x9aa3ae, head: 0xe8eaee,
  pelvis: 0x9aa3ae, torso: 0xf59e0b, base: 0xf59e0b, link: 0x9aa3ae,
  gripper: 0xe8eaee
};

let S = null; // session state, built on first successful activate()

function build(opts, THREE, OrbitControls) {
  const host = document.getElementById('ta-3d');
  if (!host) throw new Error('no #ta-3d host');
  const spec = opts.spec;
  const built = taBuildParts(spec);           // robot.js (global)
  const units = taGeom3d(spec, built.parts, built.pos);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 2, 0.01, 30);
  camera.up.set(0, 0, 1);
  const span = Math.max(spec.length_m, spec.width_m, spec.height_m * 0.75, 0.2);
  camera.position.set(span * 1.25, -span * 1.45, span * 1.0);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, spec.height_m * 0.45);
  controls.enableDamping = true;
  controls.minDistance = span * 0.4;
  controls.maxDistance = span * 6;

  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x1a1c20, 0.9));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(span, -span * 0.7, span * 1.6);
  key.castShadow = true;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xf59e0b, 0.7);
  rim.position.set(-span, span, span * 0.6);
  scene.add(rim);

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(span * 1.05, 48),
    new THREE.MeshStandardMaterial({ color: 0x1b1e24, roughness: 0.95 }));
  ground.receiveShadow = true;
  scene.add(ground);
  const grid = new THREE.PolarGridHelper(span, 12, 6, 48, 0x2c313a, 0x23262e);
  grid.rotation.x = Math.PI / 2;
  grid.position.z = 0.001;
  scene.add(grid);

  const materials = {}, pickMeshes = [], groups = [];
  units.forEach(u => {
    if (!materials[u.part]) {
      materials[u.part] = new THREE.MeshStandardMaterial({
        color: PALETTE[u.part] || 0x3d4656, roughness: 0.75, metalness: 0.08
      });
    }
    const g = new THREE.Group();
    u.meshes.forEach(m => {
      let geo;
      if (m.kind === 'box') geo = new THREE.BoxGeometry(...m.size);
      else if (m.kind === 'cyl') geo = new THREE.CylinderGeometry(m.size[0], m.size[0], m.size[1], 28);
      else geo = new THREE.SphereGeometry(m.size[0], 24, 18);
      const mesh = new THREE.Mesh(geo, materials[u.part]);
      if (m.kind === 'cyl' && m.axis === 'z') mesh.rotation.x = Math.PI / 2;
      if (m.rot) mesh.rotation.set(m.rot[0], m.rot[1], m.rot[2]);
      mesh.position.set(m.center[0], m.center[1], m.center[2]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.part = u.part;
      if (m.kind === 'box') {
        const edges = new THREE.LineSegments(
          new THREE.EdgesGeometry(geo),
          new THREE.LineBasicMaterial({
            color: EDGE[u.part] || 0x9aa3ae, transparent: true, opacity: 0.6
          }));
        mesh.add(edges);
      }
      g.add(mesh);
      pickMeshes.push(mesh);
    });
    g.userData = { part: u.part, explode: u.explode };
    scene.add(g);
    groups.push(g);
  });

  const st = {
    opts, renderer, scene, camera, controls, materials, pickMeshes, groups,
    explode: opts.explode || 0, selected: null, hover: null, active: false
  };

  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
  function pick(ev) {
    const rect = renderer.domElement.getBoundingClientRect();
    ptr.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    ptr.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    ray.setFromCamera(ptr, camera);
    const hit = ray.intersectObjects(pickMeshes, false)[0];
    return hit ? hit.object.userData.part : null;
  }
  let downAt = null;
  renderer.domElement.addEventListener('pointermove', ev => {
    st.hover = pick(ev);
    renderer.domElement.style.cursor = st.hover ? 'pointer' : '';
    refresh(st);
  });
  renderer.domElement.addEventListener('pointerdown', ev => {
    downAt = [ev.clientX, ev.clientY];
  });
  renderer.domElement.addEventListener('pointerup', ev => {
    if (!downAt) return;
    const moved = Math.hypot(ev.clientX - downAt[0], ev.clientY - downAt[1]);
    downAt = null;
    if (moved > 5) return;               // it was an orbit drag
    const part = pick(ev);
    if (part && st.opts.select) st.opts.select(part);
  });

  function resize() {
    const w = host.clientWidth || 700, h = 430;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  if (window.ResizeObserver) new ResizeObserver(resize).observe(host);
  window.addEventListener('resize', resize);
  return st;
}

function refresh(st) {
  Object.entries(st.materials).forEach(([part, mat]) => {
    if (part === st.selected) {
      mat.emissive.setHex(0xf59e0b); mat.emissiveIntensity = 0.35;
    } else if (part === st.hover) {
      mat.emissive.setHex(0xf59e0b); mat.emissiveIntensity = 0.15;
    } else {
      mat.emissive.setHex(0x000000); mat.emissiveIntensity = 0;
    }
  });
}

function applyExplode(st) {
  const e = st.explode / 1000;
  st.groups.forEach(g => {
    const v = g.userData.explode;
    g.position.set(v[0] * e, v[1] * e, v[2] * e);
  });
}

window.RF3D = {
  async activate(opts) {
    if (S) {
      S.opts = opts;
      S.active = true;
      S.explode = opts.explode || 0;
      applyExplode(S);
      refresh(S);
      S.renderer.setAnimationLoop(() => {
        S.controls.update();
        S.renderer.render(S.scene, S.camera);
      });
      return;
    }
    try {
      if (typeof taBuildParts !== 'function' ||
          typeof taGeom3d !== 'function') {
        throw new Error('take-apart geometry not loaded');
      }
      const THREE = await import('three');
      const { OrbitControls } =
        await import('three/addons/controls/OrbitControls.js');
      S = build(opts, THREE, OrbitControls);
      S.active = true;
      applyExplode(S);
      S.renderer.setAnimationLoop(() => {
        S.controls.update();
        S.renderer.render(S.scene, S.camera);
      });
    } catch (err) {
      S = null;
      if (opts && opts.onFail) opts.onFail(err);
    }
  },
  deactivate() {
    if (!S) return;
    S.active = false;
    S.renderer.setAnimationLoop(null);
  },
  setExplode(mm) {
    if (!S) return;
    S.explode = Number(mm) || 0;
    applyExplode(S);
  },
  setSelected(id) {
    if (!S) return;
    S.selected = id;
    refresh(S);
  }
};
