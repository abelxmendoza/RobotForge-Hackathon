'use client';
/* The kit.html 3D stage — the React equivalent of kit.html's module
 * script: the generated Burger kit (parametric meshes), the Real
 * model specimen mode (official ROBOTIS STL meshes at their URDF
 * poses, from the pinned source), CAD blueprint mode, auto-rotate,
 * the lerped explode, and click-a-part raycasting. Z-up camera,
 * same lights, same materials, same geometry numbers as vanilla.
 * Three.js is loaded dynamically; any failure reports onFail and
 * the page shows the flat 2D fallback. */
import { useEffect, useRef } from 'react';
import type * as THREE_NS from 'three';
import { ROOT, fetchJSON } from '../forge/model';
import type { SimReadyManifest, SpecimenDoc, SpecimenPart } from './burger';

type ThreeModule = typeof THREE_NS;

const EXPLODE_DIRS: Record<string, [number, number, number]> = {
  lidar: [0, 0, 1],
  sbc: [0, 0, 0.55],
  driver: [0.5, 0, 0.35],
  chassis: [0, 0, 0.1],
  battery: [0, 0, -0.55],
  motors: [0, 0, 0],
  wheels: [0, 0, 0],
  caster: [0, 0, -0.8],
};

interface SceneState {
  THREE: ThreeModule;
  renderer: THREE_NS.WebGLRenderer;
  scene: THREE_NS.Scene;
  camera: THREE_NS.PerspectiveCamera;
  controls: {
    update: () => void;
    autoRotate: boolean;
    dispose: () => void;
  };
  robot: THREE_NS.Group;
  specimenGroup: THREE_NS.Group;
  propsGroup: THREE_NS.Group;
  ground: THREE_NS.Mesh;
  grid: THREE_NS.Object3D;
  groups: Record<string, THREE_NS.Group>;
  pickMeshes: never[];
}

interface SpecimenRec {
  obj: THREE_NS.Object3D;
  home: THREE_NS.Vector3;
  dir: THREE_NS.Vector3;
  data: SpecimenPart;
}

export default function KitScene({
  explodeTarget,
  spin,
  cad,
  real,
  propsOn,
  selectedSpecimen,
  onReady,
  onFail,
  onSelectGenerated,
  onSelectSpecimen,
  onSpecimenLoaded,
  onSpecimenError,
  onPropsLoaded,
  onPropsError,
  onExplodeCur,
}: {
  explodeTarget: number;
  spin: boolean;
  cad: boolean;
  real: boolean;
  propsOn: boolean;
  selectedSpecimen: string | null;
  onReady: () => void;
  onFail: () => void;
  onSelectGenerated: (key: string) => void;
  onSelectSpecimen: (id: string) => void;
  onSpecimenLoaded: (doc: SpecimenDoc) => void;
  onSpecimenError: () => void;
  onPropsLoaded: (doc: SimReadyManifest) => void;
  onPropsError: () => void;
  onExplodeCur: (v: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cbRef = useRef({
    onReady,
    onFail,
    onSelectGenerated,
    onSelectSpecimen,
    onSpecimenLoaded,
    onSpecimenError,
    onPropsLoaded,
    onPropsError,
    onExplodeCur,
  });
  cbRef.current = {
    onReady,
    onFail,
    onSelectGenerated,
    onSelectSpecimen,
    onSpecimenLoaded,
    onSpecimenError,
    onPropsLoaded,
    onPropsError,
    onExplodeCur,
  };
  const targetRef = useRef(explodeTarget);
  targetRef.current = explodeTarget;
  const realRef = useRef(real);
  realRef.current = real;
  const sceneRef = useRef<SceneState | null>(null);
  const specimenRef = useRef<Map<string, SpecimenRec>>(new Map());
  const specimenStateRef = useRef({ loaded: false, loading: false });
  const propsStateRef = useRef({ loaded: false, loading: false });
  const cadMatsRef = useRef<Map<THREE_NS.Mesh, THREE_NS.Material | THREE_NS.Material[]>>(new Map());
  const savedEmissiveRef = useRef<Map<THREE_NS.Mesh, number>>(new Map());
  const selectedKeyRef = useRef<string | null>(null);
  const explodeCurRef = useRef(0);

  /* ------- specimen helpers (used by effects below) ------- */
  const applySpecimenEmissive = (id: string | null) => {
    specimenRef.current.forEach((rec, pid) => {
      rec.obj.traverse((m) => {
        const mesh = m as THREE_NS.Mesh;
        const mat = mesh.material as THREE_NS.MeshStandardMaterial | undefined;
        if ((mesh as { isMesh?: boolean }).isMesh && mat && mat.emissive) {
          mat.emissive.setHex(pid === id ? 0x664400 : 0x000000);
        }
      });
    });
  };

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | null = null;
    (async () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      try {
        const THREE = (await import('three')) as unknown as ThreeModule;
        const { OrbitControls } = await import(
          'three/addons/controls/OrbitControls.js'
        );
        const { RoundedBoxGeometry } = await import(
          'three/addons/geometries/RoundedBoxGeometry.js'
        );
        const { STLLoader } = await import(
          'three/addons/loaders/STLLoader.js'
        );
        if (disposed) return;

        const renderer = new THREE.WebGLRenderer({
          canvas,
          antialias: true,
          alpha: true,
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.05;

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(42, 2, 0.01, 20);
        camera.up.set(0, 0, 1);
        camera.position.set(0.34, -0.42, 0.3);
        const controls = new OrbitControls(camera, canvas);
        controls.target.set(0, 0, 0.085);
        controls.enableDamping = true;
        /* Two-finger pan on a phone-sized canvas loses the robot
         * off-screen too easily; rotate + pinch-zoom stay. */
        controls.enablePan = window.innerWidth >= 768;
        controls.minDistance = 0.15;
        controls.maxDistance = 1.4;
        controls.autoRotateSpeed = 2.2;

        scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x1a1c20, 0.9));
        const key = new THREE.DirectionalLight(0xffffff, 2.2);
        key.position.set(0.35, -0.25, 0.6);
        key.castShadow = true;
        key.shadow.mapSize.set(2048, 2048);
        /* ±0.8 (not ±0.35) so the SimReady bench props around the
         * stage sit inside the shadow camera too. */
        key.shadow.camera.left = -0.8;
        key.shadow.camera.bottom = -0.8;
        key.shadow.camera.right = 0.8;
        key.shadow.camera.top = 0.8;
        key.shadow.radius = 4;
        scene.add(key);
        const rim = new THREE.DirectionalLight(0xf59e0b, 0.7);
        rim.position.set(-0.4, 0.35, 0.25);
        scene.add(rim);

        const ground = new THREE.Mesh(
          new THREE.CircleGeometry(0.55, 64),
          new THREE.MeshStandardMaterial({
            color: 0x1b1e24,
            roughness: 0.95,
          }),
        );
        ground.rotation.x = 0;
        ground.receiveShadow = true;
        scene.add(ground);
        const grid = new THREE.PolarGridHelper(0.5, 12, 6, 64, 0x2c313a, 0x23262e);
        grid.rotation.x = Math.PI / 2;
        grid.position.z = 0.001;
        scene.add(grid);

        const M = {
          slate: new THREE.MeshStandardMaterial({ color: 0x51606f, roughness: 0.55, metalness: 0.35 }),
          dark: new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.7, metalness: 0.2 }),
          rubber: new THREE.MeshStandardMaterial({ color: 0x17181a, roughness: 0.92 }),
          hub: new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.4, metalness: 0.5 }),
          green: new THREE.MeshStandardMaterial({ color: 0x1d7a3d, roughness: 0.5, metalness: 0.15 }),
          red: new THREE.MeshStandardMaterial({ color: 0xa12622, roughness: 0.5, metalness: 0.15 }),
          silver: new THREE.MeshStandardMaterial({ color: 0xb9c0c8, roughness: 0.3, metalness: 0.85 }),
          pack: new THREE.MeshStandardMaterial({ color: 0xc78f1b, roughness: 0.55, metalness: 0.25 }),
          white: new THREE.MeshStandardMaterial({ color: 0xe8eaed, roughness: 0.35 }),
          gold: new THREE.MeshStandardMaterial({ color: 0xd4af37, roughness: 0.3, metalness: 0.9 }),
        };
        const mesh = (
          geo: THREE_NS.BufferGeometry,
          mat: THREE_NS.Material,
          x = 0,
          y = 0,
          z = 0,
          parent: THREE_NS.Object3D,
        ) => {
          const m = new THREE.Mesh(geo, mat);
          m.position.set(x, y, z);
          m.castShadow = true;
          m.receiveShadow = true;
          parent.add(m);
          return m;
        };

        const robot = new THREE.Group();
        scene.add(robot);
        const groups: Record<string, THREE_NS.Group> = {};
        const part = (keyName: string, dir: [number, number, number]) => {
          const g = new THREE.Group();
          g.userData = {
            key: keyName,
            dir: new THREE.Vector3(...dir),
            home: new THREE.Vector3(),
          };
          robot.add(g);
          groups[keyName] = g;
          return g;
        };
        // chassis: two plates
        let g = part('chassis', [0, 0, 0.015]);
        mesh(new RoundedBoxGeometry(0.178, 0.138, 0.01, 3, 0.003), M.slate, 0, 0, 0.075, g);
        mesh(new RoundedBoxGeometry(0.178, 0.138, 0.01, 3, 0.003), M.slate, 0, 0, 0.145, g);
        // battery between plates
        g = part('battery', [0, 0, -0.055]);
        mesh(new RoundedBoxGeometry(0.095, 0.06, 0.035, 2, 0.004), M.pack, 0, 0, 0.105, g);
        // sbc on top plate
        g = part('sbc', [0, 0, 0.085]);
        mesh(new RoundedBoxGeometry(0.085, 0.056, 0.006, 2, 0.002), M.green, -0.02, 0, 0.155, g);
        mesh(new THREE.BoxGeometry(0.03, 0.02, 0.008), M.dark, -0.03, 0, 0.162, g);
        mesh(new THREE.BoxGeometry(0.014, 0.014, 0.004), M.gold, 0.005, -0.012, 0.16, g);
        // driver board
        g = part('driver', [0.055, 0, 0.05]);
        mesh(new RoundedBoxGeometry(0.045, 0.045, 0.005, 2, 0.002), M.red, 0.045, 0, 0.153, g);
        mesh(new THREE.BoxGeometry(0.016, 0.016, 0.004), M.dark, 0.045, 0, 0.158, g);
        // lidar turret
        g = part('lidar', [0, 0, 0.16]);
        mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.02, 24), M.dark, 0.045, 0, 0.165, g);
        mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.034, 36), M.dark, 0.045, 0, 0.192, g);
        mesh(new THREE.TorusGeometry(0.035, 0.0026, 10, 40), M.hub, 0.045, 0, 0.2, g).rotation.x = Math.PI / 2;
        mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.036, 16), M.hub, 0.045, 0, 0.192, g);
        // motors inboard of wheels
        g = part('motors', [0, 0, 0]);
        for (const s of [1, -1]) {
          const mtr = mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.032, 20), M.silver, 0, s * 0.062, 0.036, g);
          mtr.rotation.x = Math.PI / 2;
          mtr.userData.side = s;
        }
        // wheels
        g = part('wheels', [0, 0, 0]);
        for (const s of [1, -1]) {
          const w = new THREE.Group();
          w.position.set(0, s * 0.08, 0.036);
          w.userData.side = s;
          g.add(w);
          const tire = mesh(new THREE.CylinderGeometry(0.033, 0.033, 0.021, 36), M.rubber, 0, 0, 0, w);
          tire.rotation.x = Math.PI / 2;
          const hub = mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.023, 20), M.hub, 0, 0, 0, w);
          hub.rotation.x = Math.PI / 2;
        }
        // casters front/rear
        g = part('caster', [0, 0, -0.085]);
        for (const s of [1, -1]) {
          mesh(new THREE.SphereGeometry(0.0165, 24, 18), M.white, s * 0.062, 0, 0.0165, g).userData.side = s;
        }

        const specimenGroup = new THREE.Group();
        specimenGroup.visible = false;
        scene.add(specimenGroup);

        /* SimReady bench props live in their own group: environment
         * dressing around the stage, independent of the generated
         * kit and the specimen — loaded lazily by the effect below. */
        const propsGroup = new THREE.Group();
        propsGroup.visible = false;
        scene.add(propsGroup);

        const st: SceneState = {
          THREE,
          renderer,
          scene,
          camera,
          controls: controls as unknown as SceneState['controls'],
          robot,
          specimenGroup,
          propsGroup,
          ground,
          grid,
          groups,
          pickMeshes: [],
        };
        (st as unknown as { STLLoaderCtor: unknown }).STLLoaderCtor = STLLoader;
        sceneRef.current = st;

        const applyExplode = (e: number) => {
          for (const [k, gr] of Object.entries(groups)) {
            const d = EXPLODE_DIRS[k];
            gr.position.set(d[0] * e * 0.1, d[1] * e * 0.1, d[2] * e * 0.16);
            if (k === 'wheels')
              gr.children.forEach((w) => {
                w.position.y = (w.userData.side as number) * (0.08 + e * 0.055);
              });
            if (k === 'motors')
              gr.children.forEach((m) => {
                m.position.y = (m.userData.side as number) * (0.062 + e * 0.028);
              });
            if (k === 'caster')
              gr.children.forEach((c) => {
                c.position.x = (c.userData.side as number) * (0.062 + e * 0.03);
              });
          }
        };
        const applySpecimenExplode = (e: number) => {
          specimenRef.current.forEach((rec) => {
            rec.obj.position.set(
              rec.home.x + rec.dir.x * e,
              rec.home.y + rec.dir.y * e,
              rec.home.z + rec.dir.z * e,
            );
          });
        };
        (st as unknown as { applyExplode: typeof applyExplode }).applyExplode = applyExplode;
        (st as unknown as { applySpecimenExplode: typeof applySpecimenExplode }).applySpecimenExplode = applySpecimenExplode;

        const selectGenerated = (keyName: string) => {
          selectedKeyRef.current = keyName;
          for (const [k, gr] of Object.entries(groups)) {
            gr.traverse((m) => {
              const mm = m as THREE_NS.Mesh;
              if (!(mm as { isMesh?: boolean }).isMesh) return;
              const mat = mm.material as THREE_NS.MeshStandardMaterial;
              if (!mat || !mat.emissive) return;
              if (!savedEmissiveRef.current.has(mm))
                savedEmissiveRef.current.set(mm, mat.emissive.getHex());
              mat.emissive.setHex(
                k === keyName ? 0x664400 : (savedEmissiveRef.current.get(mm) as number),
              );
            });
          }
          cbRef.current.onSelectGenerated(keyName);
        };
        (st as unknown as { selectGenerated: typeof selectGenerated }).selectGenerated = selectGenerated;

        const ray = new THREE.Raycaster();
        const ptr = new THREE.Vector2();
        let downAt: [number, number] | null = null;
        const onDown = (e: PointerEvent) => {
          downAt = [e.clientX, e.clientY];
        };
        const onUp = (e: PointerEvent) => {
          if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 10) return;
          downAt = null;
          const r = canvas.getBoundingClientRect();
          ptr.set(
            ((e.clientX - r.left) / r.width) * 2 - 1,
            -((e.clientY - r.top) / r.height) * 2 + 1,
          );
          ray.setFromCamera(ptr, camera);
          if (realRef.current) {
            const hits = ray.intersectObjects(specimenGroup.children, true);
            if (hits.length && hits[0].object.userData.partId) {
              const id = hits[0].object.userData.partId as string;
              applySpecimenEmissive(id);
              cbRef.current.onSelectSpecimen(id);
            }
            return;
          }
          const hits = ray.intersectObjects(robot.children, true);
          if (!hits.length) return;
          let o: THREE_NS.Object3D | null = hits[0].object;
          while (o && !o.userData.key) o = o.parent;
          if (o) selectGenerated(o.userData.key as string);
        };
        canvas.addEventListener('pointerdown', onDown);
        canvas.addEventListener('pointerup', onUp);

        const resize = () => {
          const w = canvas.clientWidth;
          const h = canvas.clientHeight;
          if (
            canvas.width !== Math.floor(w * renderer.getPixelRatio()) ||
            canvas.height !== Math.floor(h * renderer.getPixelRatio())
          ) {
            renderer.setSize(w, h, false);
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
          }
        };

        let raf = 0;
        let lastReported = -1;
        const tick = () => {
          raf = requestAnimationFrame(tick);
          explodeCurRef.current += (targetRef.current - explodeCurRef.current) * 0.12;
          if (Math.abs(targetRef.current - explodeCurRef.current) < 0.001)
            explodeCurRef.current = targetRef.current;
          applyExplode(explodeCurRef.current);
          applySpecimenExplode(explodeCurRef.current);
          if (Math.abs(explodeCurRef.current - lastReported) > 0.0005) {
            lastReported = explodeCurRef.current;
            cbRef.current.onExplodeCur(explodeCurRef.current);
          }
          controls.update();
          resize();
          renderer.render(scene, camera);
        };
        applyExplode(0);
        tick();
        cbRef.current.onReady();

        cleanup = () => {
          cancelAnimationFrame(raf);
          canvas.removeEventListener('pointerdown', onDown);
          canvas.removeEventListener('pointerup', onUp);
          controls.dispose();
          renderer.dispose();
          sceneRef.current = null;
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
  }, []);

  /* spin */
  useEffect(() => {
    const st = sceneRef.current;
    if (st) st.controls.autoRotate = spin;
  }, [spin]);

  /* CAD blueprint mode */
  useEffect(() => {
    const st = sceneRef.current;
    if (!st) return;
    const THREE = st.THREE;
    st.scene.background = cad ? new THREE.Color(0x10233b) : null;
    st.ground.visible = !cad;
    st.grid.visible = true;
    st.robot.traverse((m) => {
      const mm = m as THREE_NS.Mesh;
      if (!(mm as { isMesh?: boolean }).isMesh) return;
      if (cad) {
        if (!cadMatsRef.current.has(mm)) cadMatsRef.current.set(mm, mm.material);
        mm.material = new THREE.MeshStandardMaterial({
          color: 0xdfe9f5,
          roughness: 0.85,
          flatShading: true,
        });
        if (!mm.userData.edges) {
          const eg = new THREE.LineSegments(
            new THREE.EdgesGeometry(mm.geometry, 25),
            new THREE.LineBasicMaterial({ color: 0x4da3ff }),
          );
          mm.add(eg);
          mm.userData.edges = eg;
        }
        (mm.userData.edges as THREE_NS.Object3D).visible = true;
        mm.castShadow = false;
      } else {
        if (cadMatsRef.current.has(mm))
          mm.material = cadMatsRef.current.get(mm) as THREE_NS.Material;
        if (mm.userData.edges)
          (mm.userData.edges as THREE_NS.Object3D).visible = false;
        mm.castShadow = true;
      }
    });
  }, [cad]);

  /* real model mode: visibility + lazy specimen load */
  useEffect(() => {
    const st = sceneRef.current;
    if (!st) return;
    st.robot.visible = !real;
    st.specimenGroup.visible = real;
    if (!real) return;
    const sst = specimenStateRef.current;
    if (sst.loaded || sst.loading) return;
    sst.loading = true;
    (async () => {
      try {
        const doc = (
          await fetchJSON<{ specimen: SpecimenDoc }>(
            'catalog/specimens/turtlebot3-burger.json',
          )
        ).specimen;
        const THREE = st.THREE;
        const STLLoaderCtor = (
          st as unknown as { STLLoaderCtor: new () => { loadAsync: (u: string) => Promise<THREE_NS.BufferGeometry> } }
        ).STLLoaderCtor;
        const loader = new STLLoaderCtor();
        const specimenMaterial = (p: SpecimenPart) => {
          let color = new THREE.Color(0x51606f);
          if (p.color_rgba)
            color = new THREE.Color(p.color_rgba[0], p.color_rgba[1], p.color_rgba[2]);
          if (p.tier === 'COLLISION_BOX') color = new THREE.Color(0xf59e0b);
          if (p.tier === 'FRAME_ONLY') color = new THREE.Color(0xd4af37);
          return new THREE.MeshStandardMaterial({
            color,
            roughness: 0.6,
            metalness: 0.25,
            transparent: p.tier === 'COLLISION_BOX',
            opacity: p.tier === 'COLLISION_BOX' ? 0.55 : 1,
          });
        };
        for (const p of doc.parts) {
          let obj: THREE_NS.Object3D;
          if (p.tier === 'REAL_MESH') {
            const geo = await loader.loadAsync(p.mesh_url as string);
            const m = new THREE.Mesh(geo, specimenMaterial(p));
            m.scale.setScalar(p.scale as number);
            obj = m;
          } else if (p.tier === 'COLLISION_BOX') {
            obj = new THREE.Mesh(
              new THREE.BoxGeometry(...(p.collision_box_m as [number, number, number])),
              specimenMaterial(p),
            );
          } else {
            obj = new THREE.Mesh(
              new THREE.OctahedronGeometry(0.009),
              specimenMaterial(p),
            );
          }
          obj.position.set(...p.position);
          obj.quaternion.set(...p.quaternion);
          (obj as THREE_NS.Mesh).castShadow = true;
          obj.userData.partId = p.id;
          st.specimenGroup.add(obj);
          specimenRef.current.set(p.id, {
            obj,
            home: new THREE.Vector3(...p.position),
            dir: new THREE.Vector3(...p.explode),
            data: p,
          });
        }
        sst.loaded = true;
        cbRef.current.onSpecimenLoaded(doc);
      } catch {
        cbRef.current.onSpecimenError();
      } finally {
        sst.loading = false;
      }
    })();
  }, [real]);

  /* specimen selection driven from the part list */
  useEffect(() => {
    applySpecimenEmissive(selectedSpecimen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSpecimen]);

  /* SimReady bench props: visibility + lazy manifest-driven load.
   * External NVIDIA assets (CC BY 4.0) used as bench dressing only —
   * they are not kit parts, they are never raycast-pickable, and the
   * explode/CAD machinery never touches them. The manifest (with
   * per-prop attribution) is fetched from the same public folder the
   * build materializes the models into. */
  useEffect(() => {
    const st = sceneRef.current;
    if (!st) return;
    st.propsGroup.visible = propsOn;
    if (!propsOn) return;
    const pst = propsStateRef.current;
    if (pst.loaded || pst.loading) return;
    pst.loading = true;
    (async () => {
      try {
        const doc = await fetchJSON<SimReadyManifest>(
          'catalog/props/simready/props.json',
        );
        const { GLTFLoader } = await import(
          'three/addons/loaders/GLTFLoader.js'
        );
        const loader = new GLTFLoader();
        const THREE = st.THREE;
        for (const p of doc.props) {
          const gltf = await loader.loadAsync(
            ROOT + 'catalog/props/simready/' + p.file,
          );
          /* glTF is Y-up with the prop standing on y=0; this scene is
           * Z-up. Tilting +90° about X maps glTF +Y to scene +Z, so
           * the prop stands on the floor (z=0) at its native scale. */
          const inner = new THREE.Group();
          inner.rotation.x = Math.PI / 2;
          inner.add(gltf.scene);
          const holder = new THREE.Group();
          holder.position.set(p.position_xy_m[0], p.position_xy_m[1], 0);
          holder.rotation.z = p.rotation_y_rad;
          holder.add(inner);
          holder.traverse((m) => {
            const mm = m as THREE_NS.Mesh;
            if ((mm as { isMesh?: boolean }).isMesh) {
              mm.castShadow = true;
              mm.receiveShadow = true;
            }
          });
          st.propsGroup.add(holder);
        }
        pst.loaded = true;
        cbRef.current.onPropsLoaded(doc);
      } catch {
        cbRef.current.onPropsError();
      } finally {
        pst.loading = false;
      }
    })();
  }, [propsOn]);

  return <canvas id="view3d" ref={canvasRef} />;
}
