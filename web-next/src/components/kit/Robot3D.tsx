'use client';
/* 3D take-apart — the React equivalent of assets/js/robot3d.js.
 * Renders the SAME kit the 2D views draw: geometry comes from
 * taGeom3d/taBuildParts in takeapart.ts — this file only turns
 * those units into Three.js meshes. Three.js is imported
 * dynamically on mount, so a load failure or a missing WebGL
 * context lands in onFail and the pane shows "3D unavailable
 * here — the 2D take-apart still works" instead of breaking.
 * Coordinates are the robot's own (x forward, y left, z up),
 * matching kit.html's Z-up convention. */
import { useEffect, useRef } from 'react';
import type * as THREE_NS from 'three';
import type { RobotSpec } from '../forge/model';
import { taBuildParts, taGeom3d } from './takeapart';

type ThreeModule = typeof THREE_NS;

const PALETTE: Record<string, number> = {
  plate: 0x8a5a17, wheel: 0x22262e, mount: 0x3d4656, caster: 0x5b6472,
  lidar: 0x22262e, camera: 0x3d4656, ultrasonic: 0x3d4656,
  frame: 0x3d4656, arm: 0x51606f, rotor: 0x22262e, battery: 0x51606f,
  fc: 0x22262e, body: 0x51606f, leg: 0x3d4656, head: 0x22262e,
  pelvis: 0x3d4656, torso: 0x51606f, base: 0x8a5a17, link: 0x51606f,
  gripper: 0x22262e,
};
const EDGE: Record<string, number> = {
  plate: 0xf59e0b, wheel: 0xe8eaee, mount: 0x9aa3ae, caster: 0x9aa3ae,
  lidar: 0xe8eaee, camera: 0x9aa3ae, ultrasonic: 0x9aa3ae,
  frame: 0xf59e0b, arm: 0x9aa3ae, rotor: 0xe8eaee, battery: 0x9aa3ae,
  fc: 0x34d399, body: 0xf59e0b, leg: 0x9aa3ae, head: 0xe8eaee,
  pelvis: 0x9aa3ae, torso: 0xf59e0b, base: 0xf59e0b, link: 0x9aa3ae,
  gripper: 0xe8eaee,
};

interface Session {
  renderer: THREE_NS.WebGLRenderer;
  scene: THREE_NS.Scene;
  camera: THREE_NS.PerspectiveCamera;
  controls: { update: () => void };
  materials: Record<string, THREE_NS.MeshStandardMaterial>;
  groups: THREE_NS.Group[];
  selected: string | null;
  hover: string | null;
  explode: number;
  refresh?: () => void;
  applyExplode?: () => void;
}

export default function Robot3D({
  spec,
  explode,
  selected,
  onSelect,
  onFail,
}: {
  spec: RobotSpec;
  explode: number;
  selected: string | null;
  onSelect: (id: string) => void;
  onFail: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<Session | null>(null);
  const cbRef = useRef({ onSelect, onFail });
  cbRef.current = { onSelect, onFail };
  const stateRef = useRef({ explode, selected });
  stateRef.current = { explode, selected };

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | null = null;
    (async () => {
      const host = hostRef.current;
      if (!host) return;
      try {
        const THREE = (await import('three')) as unknown as ThreeModule;
        const { OrbitControls } = await import(
          'three/addons/controls/OrbitControls.js'
        );
        if (disposed) return;
        const built = taBuildParts(spec);
        const units = taGeom3d(spec, built.parts, built.pos);

        const renderer = new THREE.WebGLRenderer({
          antialias: true,
          alpha: true,
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.05;
        host.appendChild(renderer.domElement);

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(42, 2, 0.01, 30);
        camera.up.set(0, 0, 1);
        const span = Math.max(
          spec.length_m,
          spec.width_m,
          spec.height_m * 0.75,
          0.2,
        );
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
          new THREE.MeshStandardMaterial({
            color: 0x1b1e24,
            roughness: 0.95,
          }),
        );
        ground.receiveShadow = true;
        scene.add(ground);
        const grid = new THREE.PolarGridHelper(
          span,
          12,
          6,
          48,
          0x2c313a,
          0x23262e,
        );
        grid.rotation.x = Math.PI / 2;
        grid.position.z = 0.001;
        scene.add(grid);

        const materials: Session['materials'] = {};
        const pickMeshes: THREE_NS.Mesh[] = [];
        const groups: THREE_NS.Group[] = [];
        units.forEach((u) => {
          if (!materials[u.part]) {
            materials[u.part] = new THREE.MeshStandardMaterial({
              color: PALETTE[u.part] || 0x3d4656,
              roughness: 0.75,
              metalness: 0.08,
            });
          }
          const g = new THREE.Group();
          u.meshes.forEach((m) => {
            let geo: THREE_NS.BufferGeometry;
            if (m.kind === 'box') geo = new THREE.BoxGeometry(...m.size);
            else if (m.kind === 'cyl')
              geo = new THREE.CylinderGeometry(m.size[0], m.size[0], m.size[1], 28);
            else geo = new THREE.SphereGeometry(m.size[0], 24, 18);
            const mesh = new THREE.Mesh(geo, materials[u.part]);
            if (m.kind === 'cyl' && m.axis === 'z')
              mesh.rotation.x = Math.PI / 2;
            if (m.rot) mesh.rotation.set(m.rot[0], m.rot[1], m.rot[2]);
            mesh.position.set(m.center[0], m.center[1], m.center[2]);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            mesh.userData.part = u.part;
            if (m.kind === 'box') {
              const edges = new THREE.LineSegments(
                new THREE.EdgesGeometry(geo),
                new THREE.LineBasicMaterial({
                  color: EDGE[u.part] || 0x9aa3ae,
                  transparent: true,
                  opacity: 0.6,
                }),
              );
              mesh.add(edges);
            }
            g.add(mesh);
            pickMeshes.push(mesh);
          });
          g.userData = { part: u.part, explode: u.explode };
          scene.add(g);
          groups.push(g);
        });

        const st: Session = {
          renderer,
          scene,
          camera,
          controls: controls as unknown as Session['controls'],
          materials,
          groups,
          selected: stateRef.current.selected,
          hover: null,
          explode: stateRef.current.explode,
        };
        sessionRef.current = st;

        const refresh = () => {
          Object.entries(st.materials).forEach(([part, mat]) => {
            if (part === st.selected) {
              mat.emissive.setHex(0xf59e0b);
              mat.emissiveIntensity = 0.35;
            } else if (part === st.hover) {
              mat.emissive.setHex(0xf59e0b);
              mat.emissiveIntensity = 0.15;
            } else {
              mat.emissive.setHex(0x000000);
              mat.emissiveIntensity = 0;
            }
          });
        };
        const applyExplode = () => {
          const e = st.explode / 1000;
          st.groups.forEach((g) => {
            const v = g.userData.explode as [number, number, number];
            g.position.set(v[0] * e, v[1] * e, v[2] * e);
          });
        };
        st.refresh = refresh;
        st.applyExplode = applyExplode;
        applyExplode();
        refresh();

        const ray = new THREE.Raycaster();
        const ptr = new THREE.Vector2();
        const pick = (ev: PointerEvent): string | null => {
          const rect = renderer.domElement.getBoundingClientRect();
          ptr.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
          ptr.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
          ray.setFromCamera(ptr, camera);
          const hit = ray.intersectObjects(pickMeshes, false)[0];
          return hit ? (hit.object.userData.part as string) : null;
        };
        let downAt: [number, number] | null = null;
        const onMove = (ev: PointerEvent) => {
          st.hover = pick(ev);
          renderer.domElement.style.cursor = st.hover ? 'pointer' : '';
          refresh();
        };
        const onDown = (ev: PointerEvent) => {
          downAt = [ev.clientX, ev.clientY];
        };
        const onUp = (ev: PointerEvent) => {
          if (!downAt) return;
          const moved = Math.hypot(
            ev.clientX - downAt[0],
            ev.clientY - downAt[1],
          );
          downAt = null;
          if (moved > 5) return; // it was an orbit drag
          const part = pick(ev);
          if (part) cbRef.current.onSelect(part);
        };
        renderer.domElement.addEventListener('pointermove', onMove);
        renderer.domElement.addEventListener('pointerdown', onDown);
        renderer.domElement.addEventListener('pointerup', onUp);

        const resize = () => {
          const w = host.clientWidth || 700;
          const h = 430;
          renderer.setSize(w, h);
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
        };
        resize();
        let ro: ResizeObserver | null = null;
        if (window.ResizeObserver) {
          ro = new ResizeObserver(resize);
          ro.observe(host);
        }
        window.addEventListener('resize', resize);

        renderer.setAnimationLoop(() => {
          controls.update();
          renderer.render(scene, camera);
        });

        cleanup = () => {
          renderer.setAnimationLoop(null);
          if (ro) ro.disconnect();
          window.removeEventListener('resize', resize);
          renderer.domElement.removeEventListener('pointermove', onMove);
          renderer.domElement.removeEventListener('pointerdown', onDown);
          renderer.domElement.removeEventListener('pointerup', onUp);
          controls.dispose();
          renderer.dispose();
          if (renderer.domElement.parentElement === host) {
            host.removeChild(renderer.domElement);
          }
          sessionRef.current = null;
        };
        if (disposed) cleanup();
      } catch {
        if (!disposed) cbRef.current.onFail();
      }
    })();
    return () => {
      disposed = true;
      if (cleanup) cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec]);

  useEffect(() => {
    const st = sessionRef.current;
    if (st) {
      st.explode = explode;
      if (st.applyExplode) st.applyExplode();
    }
  }, [explode]);

  useEffect(() => {
    const st = sessionRef.current;
    if (st) {
      st.selected = selected;
      if (st.refresh) st.refresh();
    }
  }, [selected]);

  return <div ref={hostRef} />;
}
