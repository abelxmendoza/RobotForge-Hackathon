'use client';
/* The kit.html 3D stage — the React equivalent of kit.html's module
 * script: the generated Burger kit (parametric meshes), the Real
 * model specimen mode (official ROBOTIS STL meshes at their URDF
 * poses, from the pinned source), CAD blueprint mode, auto-rotate,
 * the lerped explode, and click-a-part raycasting. Z-up camera,
 * same lights, same materials, same geometry numbers as vanilla.
 * Three.js is loaded dynamically; any failure reports onFail and
 * the page shows the flat 2D fallback. */
import { useEffect, useRef, useState } from 'react';
import type * as THREE_NS from 'three';
import { ROOT, fetchJSON } from '../forge/model';
import { cableControlPoints, type Point3 } from '@/lib/wire3d';
import type { SimReadyManifest, SpecimenDoc, SpecimenPart } from './burger';
import type { FlowPath } from '@/lib/stageAnimation';
import { cableControlPoints } from '@/lib/wire3d';

/* Living Build Stage state for this scene, computed by the parent
 * from recorded data (lib/stageAnimation): whether each clock may
 * advance this frame (play/pause, tab visibility, on-screen and
 * Wiring-mode gates already applied), the speed multiplier, the
 * layer toggles, and the recorded flow paths to draw. The scene
 * only renders what it is handed — it invents no motion and no
 * electrical values of its own. */
export interface KitLife {
  playing: boolean;
  flowPlaying: boolean;
  speed: number;
  motion: boolean;
  sensors: boolean;
  flow: boolean;
  flows: FlowPath[];
}

/* A bench prop the user placed from the Parts palette: one build
 * list instance, rendered from the prop's actual GLB at the drop
 * point (or a default slot). uid is the build entry's id, so
 * removing the entry removes exactly this holder. */
export interface PlacedProp {
  uid: string;
  file: string;
  pos: [number, number];
  yaw: number;
}

/* The wiring view-model (lib/buildWiring.ts computes it): devices
 * are schematic blocks for build-list entries that expose ports,
 * anchors are world-space points on the blocks' faces, cables are
 * the resolved connections between anchors. Routing and port
 * positions are diagrammatic — the panel badges it verbatim. */
export type SceneWireType = 'power' | 'data' | 'signal';
export interface SceneWirePort {
  key: string;
  type: SceneWireType;
  anchor: Point3;
}
export interface SceneWireDevice {
  uid: string;
  name: string;
  center: [number, number];
  size: [number, number, number];
  ports: SceneWirePort[];
}
export interface SceneWireConn {
  id: string;
  type: SceneWireType;
  a: Point3;
  b: Point3;
  lane: number;
}
export interface WiringSceneView {
  devices: SceneWireDevice[];
  conns: SceneWireConn[];
  pendingPort: string | null;
  selectedConn: string | null;
}

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
  dropsGroup: THREE_NS.Group;
  wiringGroup: THREE_NS.Group;
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
  placedProps,
  wiring,
  life,
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
  onCanvasDrop,
  onPortClick,
  onWireClick,
}: {
  explodeTarget: number;
  spin: boolean;
  cad: boolean;
  real: boolean;
  propsOn: boolean;
  placedProps: PlacedProp[];
  wiring: WiringSceneView | null;
  life?: KitLife;
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
  onCanvasDrop: (itemKey: string, pos: [number, number]) => void;
  onPortClick: (portKey: string) => void;
  onWireClick: (connId: string | null) => void;
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
    onCanvasDrop,
    onPortClick,
    onWireClick,
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
    onCanvasDrop,
    onPortClick,
    onWireClick,
  };
  const [sceneReady, setSceneReady] = useState(false);
  const glbCacheRef = useRef<Map<string, THREE_NS.Object3D>>(new Map());
  const holdersRef = useRef<Map<string, THREE_NS.Object3D>>(new Map());
  const targetRef = useRef(explodeTarget);
  targetRef.current = explodeTarget;
  const lifeRef = useRef(life);
  lifeRef.current = life;
  const cadRef = useRef(cad);
  cadRef.current = cad;
  const realRef = useRef(real);
  realRef.current = real;
  const wiringRef = useRef(wiring);
  wiringRef.current = wiring;
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
        /* Environment-lit PBR: a neutral room environment gives the
         * standard materials something real to reflect, which is
         * most of the "lifelike" gap over flat hemisphere light. */
        const { RoomEnvironment } = await import(
          'three/addons/environments/RoomEnvironment.js'
        );
        const pmrem = new THREE.PMREMGenerator(renderer);
        const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
        scene.environment = envTex;
        (scene as unknown as { environmentIntensity: number }).environmentIntensity = 0.35;
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
        /* Radial fade ring: the stage disc melts into the page
         * background instead of ending at a hard circle edge. */
        const fadeCanvas = document.createElement('canvas');
        fadeCanvas.width = 256;
        fadeCanvas.height = 256;
        const fctx = fadeCanvas.getContext('2d');
        if (fctx) {
          const grad = fctx.createRadialGradient(128, 128, 80, 128, 128, 128);
          grad.addColorStop(0, 'rgba(27,30,36,1)');
          grad.addColorStop(1, 'rgba(27,30,36,0)');
          fctx.fillStyle = grad;
          fctx.fillRect(0, 0, 256, 256);
        }
        const fadeTex = new THREE.CanvasTexture(fadeCanvas);
        const fade = new THREE.Mesh(
          new THREE.CircleGeometry(0.85, 64),
          new THREE.MeshBasicMaterial({
            map: fadeTex,
            transparent: true,
            depthWrite: false,
          }),
        );
        fade.position.z = -0.002;
        scene.add(fade);
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

        /* Living Build Stage registry: the moving pieces the tick
         * animates, collected while the kit is built. Everything
         * here is driven by lib/stageAnimation's recorded-data
         * capability map via the parent's `life` prop — the scene
         * itself decides nothing about what may move. */
        const anim = {
          wheelMeshes: [] as THREE_NS.Mesh[],
          lidarPivot: null as THREE_NS.Group | null,
          sweepGroup: null as THREE_NS.Group | null,
          ledMat: null as THREE_NS.MeshStandardMaterial | null,
          driverLedMat: null as THREE_NS.MeshStandardMaterial | null,
          time: 0,
          flowTime: 0,
          flowGroup: new THREE.Group(),
          flowItems: [] as {
            path: FlowPath;
            variant: number;
            tube: THREE_NS.Mesh;
            pulse: THREE_NS.Mesh;
            curve: THREE_NS.CatmullRomCurve3 | null;
          }[],
          flowSig: '',
          envTex,
          pmrem,
        };

        const robot = new THREE.Group();
        scene.add(robot);
        scene.add(anim.flowGroup);
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
        /* The SoC gets its own material instance: its emissive is
         * the board's status LED, blinked by the tick while the
         * stage clock runs (the recorded blink track for boards). */
        anim.ledMat = new THREE.MeshStandardMaterial({
          color: 0xd4af37,
          roughness: 0.3,
          metalness: 0.9,
          emissive: 0x22cc66,
          emissiveIntensity: 0.6,
        });
        mesh(new THREE.BoxGeometry(0.014, 0.014, 0.004), anim.ledMat, 0.005, -0.012, 0.16, g);
        // driver board
        g = part('driver', [0.055, 0, 0.05]);
        mesh(new RoundedBoxGeometry(0.045, 0.045, 0.005, 2, 0.002), M.red, 0.045, 0, 0.153, g);
        mesh(new THREE.BoxGeometry(0.016, 0.016, 0.004), M.dark, 0.045, 0, 0.158, g);
        /* Driver output indicator: lit only while its load motors
         * (the wheels) are actually animating — output state tied
         * to the load, never a free-running decoration. */
        anim.driverLedMat = new THREE.MeshStandardMaterial({
          color: 0x33150a,
          roughness: 0.4,
          emissive: 0xff7722,
          emissiveIntensity: 0.25,
        });
        mesh(new THREE.BoxGeometry(0.006, 0.006, 0.003), anim.driverLedMat, 0.058, -0.014, 0.157, g);
        // lidar turret: drum + ring + hub sit in a pivot at the
        // turret axis so the recorded scan_joint sweep can turn
        // them; the post stays fixed in the lidar group.
        g = part('lidar', [0, 0, 0.16]);
        mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.02, 24), M.dark, 0.045, 0, 0.165, g);
        const lidarPivot = new THREE.Group();
        lidarPivot.position.set(0.045, 0, 0);
        g.add(lidarPivot);
        anim.lidarPivot = lidarPivot;
        mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.034, 36), M.dark, 0, 0, 0.192, lidarPivot);
        mesh(new THREE.TorusGeometry(0.035, 0.0026, 10, 40), M.hub, 0, 0, 0.2, lidarPivot).rotation.x = Math.PI / 2;
        mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.036, 16), M.hub, 0, 0, 0.192, lidarPivot);
        /* A rim notch so the turret's rotation is visible, aligned
         * with the sweep wedge's leading edge below. */
        mesh(new THREE.BoxGeometry(0.008, 0.036, 0.01), M.hub, 0.03, 0, 0.192, lidarPivot);
        /* Sensor layer: sweep wedge + faint scan disc at the lidar
         * height, rotated with the turret. The Burger's lidar
         * range IS recorded (3.5 m), but at stage scale the wedge
         * is drawn to the stage edge and the panel states the
         * recorded range in words — the wedge is a direction
         * indicator, not a to-scale range plot. */
        const sweepGroup = new THREE.Group();
        sweepGroup.position.set(0.045, 0, 0.192);
        const sweepDisc = new THREE.Mesh(
          new THREE.CircleGeometry(0.5, 48),
          new THREE.MeshBasicMaterial({
            color: 0xf59e0b,
            transparent: true,
            opacity: 0.07,
            depthWrite: false,
            side: THREE.DoubleSide,
          }),
        );
        const sweepWedge = new THREE.Mesh(
          new THREE.CircleGeometry(0.5, 24, 0, 0.55),
          new THREE.MeshBasicMaterial({
            color: 0xf59e0b,
            transparent: true,
            opacity: 0.2,
            depthWrite: false,
            side: THREE.DoubleSide,
          }),
        );
        const sweepEdge = new THREE.Mesh(
          new THREE.BoxGeometry(0.5, 0.003, 0.001),
          new THREE.MeshBasicMaterial({
            color: 0xffc46b,
            transparent: true,
            opacity: 0.85,
            depthWrite: false,
          }),
        );
        sweepEdge.position.set(0.25, 0, 0);
        sweepGroup.add(sweepDisc, sweepWedge, sweepEdge);
        sweepGroup.visible = false;
        /* The sweep layer must never intercept part picking: a
         * stage-wide disc would swallow every click as "lidar". */
        sweepGroup.traverse((o) => {
          (o as THREE_NS.Mesh).raycast = () => {};
        });
        g.add(sweepGroup);
        anim.sweepGroup = sweepGroup;
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
          /* A spoke on the tire's rim, in the tire's own geometry
           * space (radial plane XZ, axle Y): when the tick spins
           * the tire about its axle the spoke makes the turn
           * visible instead of a featureless cylinder rolling. */
          const spoke = new THREE.Mesh(
            new THREE.BoxGeometry(0.016, 0.023, 0.005),
            M.hub,
          );
          spoke.position.set(0.02, 0, 0);
          spoke.castShadow = true;
          tire.add(spoke);
          anim.wheelMeshes.push(tire, hub);
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

        /* Palette placements live in their own group too: models
         * the user dropped or asked for, one holder per build-list
         * entry, synced by the effect below. Independent of the
         * bench-props toggle — those are dressing, these are the
         * user's build. */
        const dropsGroup = new THREE.Group();
        scene.add(dropsGroup);

        /* The wiring layer: schematic device blocks, port markers
         * and cable tubes for the build list — rebuilt wholesale
         * by the effect below whenever the view-model changes.
         * Independent of the kit groups: explode and CAD mode
         * never touch it, and its picking is checked before the
         * robot's while wiring mode is on. */
        const wiringGroup = new THREE.Group();
        wiringGroup.visible = false;
        scene.add(wiringGroup);

        const st: SceneState = {
          THREE,
          renderer,
          scene,
          camera,
          controls: controls as unknown as SceneState['controls'],
          robot,
          specimenGroup,
          propsGroup,
          dropsGroup,
          wiringGroup,
          ground,
          grid,
          groups,
          pickMeshes: [],
        };
        (st as unknown as { STLLoaderCtor: unknown }).STLLoaderCtor = STLLoader;
        (st as unknown as { anim: typeof anim }).anim = anim;
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
          /* Wiring mode takes the click first: a port marker, a
           * cable, or — on empty space — a background click that
           * clears the pending selection. The robot/specimen
           * picking below stays out of the way while it's on. */
          if (wiringRef.current) {
            const hits = ray.intersectObjects(wiringGroup.children, true);
            let o: THREE_NS.Object3D | null = hits.length ? hits[0].object : null;
            let portKey: string | null = null;
            let connId: string | null = null;
            while (o) {
              if (o.userData.portKey) { portKey = o.userData.portKey as string; break; }
              if (o.userData.connId) { connId = o.userData.connId as string; break; }
              o = o.parent;
            }
            if (portKey) cbRef.current.onPortClick(portKey);
            else cbRef.current.onWireClick(connId);
            return;
          }
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

        /* Palette drag-and-drop: a card dragged from the Parts
         * palette carries the item key; the drop point raycasts to
         * the ground plane (z=0) so a placed model lands where it
         * was dropped. The parent decides what the item does —
         * models join the scene, model-less parts only the list. */
        const onDragOver = (e: DragEvent) => {
          if (
            e.dataTransfer &&
            Array.from(e.dataTransfer.types).includes('application/x-rf-palette')
          ) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
          }
        };
        const onDrop = (e: DragEvent) => {
          e.preventDefault();
          const itemKey =
            e.dataTransfer?.getData('application/x-rf-palette') ||
            e.dataTransfer?.getData('text/plain');
          if (!itemKey) return;
          const r = canvas.getBoundingClientRect();
          ptr.set(
            ((e.clientX - r.left) / r.width) * 2 - 1,
            -((e.clientY - r.top) / r.height) * 2 + 1,
          );
          ray.setFromCamera(ptr, camera);
          const groundPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
          const hitPoint = new THREE.Vector3();
          if (ray.ray.intersectPlane(groundPlane, hitPoint)) {
            cbRef.current.onCanvasDrop(itemKey, [hitPoint.x, hitPoint.y]);
          }
        };
        canvas.addEventListener('dragover', onDragOver);
        canvas.addEventListener('drop', onDrop);

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

        /* ---- Living Build Stage: flow paths + per-frame life ----
         * Anchors are the recorded wiring nodes' stage positions;
         * each rides its part group's explode offset so the cables
         * follow the kit as it opens. Node ids come from the spec
         * wiring the parent derived paths from (battery / driver /
         * controller / lidar / motors); the motors node fans out
         * to both recorded motor positions. Unknown node → the
         * path is skipped, never approximated. */
        const FLOW_ANCHORS: Record<string, { key: string; pts: [number, number, number][] }> = {
          battery: { key: 'battery', pts: [[0, 0, 0.105]] },
          driver: { key: 'driver', pts: [[0.045, 0, 0.153]] },
          controller: { key: 'sbc', pts: [[-0.02, 0, 0.155]] },
          lidar: { key: 'lidar', pts: [[0.045, 0, 0.192]] },
          motors: {
            key: 'motors',
            pts: [
              [0, 0.062, 0.036],
              [0, -0.062, 0.036],
            ],
          },
        };
        const anchorPoint = (
          node: string,
          variant: number,
        ): THREE_NS.Vector3 | null => {
          const a = FLOW_ANCHORS[node];
          if (!a) return null;
          const p = a.pts[Math.min(variant, a.pts.length - 1)];
          const grp = groups[a.key];
          const off = grp ? grp.position : new THREE.Vector3();
          /* motor children ride their own explode offset too */
          const extraY =
            node === 'motors' ? Math.sign(p[1]) * explodeCurRef.current * 0.028 : 0;
          return new THREE.Vector3(p[0] + off.x, p[1] + off.y + extraY, p[2] + off.z);
        };
        const buildFlowItems = (flows: FlowPath[]) => {
          for (const it of anim.flowItems) {
            anim.flowGroup.remove(it.tube, it.pulse);
            it.tube.geometry.dispose();
            (it.tube.material as THREE_NS.Material).dispose();
            (it.pulse.material as THREE_NS.Material).dispose();
            it.pulse.geometry.dispose();
          }
          anim.flowItems = [];
          for (const path of flows) {
            const toA = FLOW_ANCHORS[path.to];
            const variants = toA ? toA.pts.length : 1;
            for (let v = 0; v < variants; v++) {
              const color = new THREE.Color(path.color);
              const tube = new THREE.Mesh(
                new THREE.BufferGeometry(),
                new THREE.MeshBasicMaterial({
                  color,
                  transparent: true,
                  opacity: 0.38,
                }),
              );
              tube.raycast = () => {};
              const pulse = new THREE.Mesh(
                new THREE.SphereGeometry(0.0042, 10, 8),
                new THREE.MeshBasicMaterial({
                  color,
                  transparent: true,
                  opacity: 0.5 + path.intensity * 0.5,
                }),
              );
              pulse.raycast = () => {};
              anim.flowGroup.add(tube, pulse);
              anim.flowItems.push({ path, variant: v, tube, pulse, curve: null });
            }
          }
          anim.flowSig = '__built__';
        };
        const updateFlow = () => {
          const life = lifeRef.current;
          const show =
            !!life && life.flow && !realRef.current && !cadRef.current;
          anim.flowGroup.visible = show && anim.flowItems.length > 0;
          if (!show) return;
          /* rebuild tube geometry only when an endpoint actually
           * moved (explode lerp, mode switch) — a handful of small
           * tubes, rebuilt on change, never per frame */
          const sig = anim.flowItems
            .map((it) => {
              const a = anchorPoint(it.path.from, 0);
              const b = anchorPoint(it.path.to, it.variant);
              return a && b
                ? `${a.x.toFixed(3)},${a.y.toFixed(3)},${a.z.toFixed(3)}>${b.x.toFixed(3)},${b.y.toFixed(3)},${b.z.toFixed(3)}`
                : 'x';
            })
            .join('|');
          if (sig !== anim.flowSig) {
            anim.flowSig = sig;
            anim.flowItems.forEach((it, i) => {
              const a = anchorPoint(it.path.from, 0);
              const b = anchorPoint(it.path.to, it.variant);
              if (!a || !b) {
                it.curve = null;
                it.tube.visible = false;
                it.pulse.visible = false;
                return;
              }
              const pts = cableControlPoints(
                [a.x, a.y, a.z],
                [b.x, b.y, b.z],
                i,
              ).map((p) => new THREE.Vector3(p[0], p[1], p[2]));
              it.curve = new THREE.CatmullRomCurve3(pts);
              it.tube.geometry.dispose();
              it.tube.geometry = new THREE.TubeGeometry(it.curve, 24, 0.0016, 6);
              it.tube.visible = true;
              it.pulse.visible = true;
            });
          }
          for (const it of anim.flowItems) {
            if (!it.curve) continue;
            const phase =
              (anim.flowTime * it.path.pulsePerSec +
                anim.flowItems.indexOf(it) * 0.37) %
              1;
            it.pulse.position.copy(it.curve.getPointAt(phase));
          }
        };

        let raf = 0;
        let lastReported = -1;
        let lastStamp = performance.now();
        const tick = () => {
          raf = requestAnimationFrame(tick);
          const now = performance.now();
          const dt = Math.min((now - lastStamp) / 1000, 0.05);
          lastStamp = now;
          explodeCurRef.current += (targetRef.current - explodeCurRef.current) * 0.12;
          if (Math.abs(targetRef.current - explodeCurRef.current) < 0.001)
            explodeCurRef.current = targetRef.current;
          applyExplode(explodeCurRef.current);
          applySpecimenExplode(explodeCurRef.current);
          if (Math.abs(explodeCurRef.current - lastReported) > 0.0005) {
            lastReported = explodeCurRef.current;
            cbRef.current.onExplodeCur(explodeCurRef.current);
          }
          /* Stage life: two clocks (mechanical + flow), each
           * already gated by the parent. Life applies to the
           * generated kit only — the Real specimen keeps its
           * recorded URDF poses and CAD mode stays a blueprint. */
          const life = lifeRef.current;
          const onKit = !realRef.current && !cadRef.current;
          if (life && onKit) {
            if (anim.flowItems.length === 0 && life.flows.length > 0)
              buildFlowItems(life.flows);
            if (life.playing && life.motion) {
              const step = dt * life.speed;
              anim.time += step;
              const dAngle = step * 2.4;
              const spinAxis = new THREE.Vector3(0, 1, 0);
              for (const m of anim.wheelMeshes) m.rotateOnAxis(spinAxis, dAngle);
              if (anim.lidarPivot) anim.lidarPivot.rotation.z = anim.time * 1.6;
              if (anim.ledMat)
                anim.ledMat.emissiveIntensity =
                  Math.sin(anim.time * 5) > 0 ? 1.8 : 0.25;
              if (anim.driverLedMat)
                anim.driverLedMat.emissiveIntensity =
                  1.3 + Math.sin(anim.time * 9.6) * 0.8;
            } else {
              if (anim.ledMat) anim.ledMat.emissiveIntensity = 0.6;
              if (anim.driverLedMat) anim.driverLedMat.emissiveIntensity = 0.25;
            }
            if (anim.sweepGroup) {
              anim.sweepGroup.visible = life.sensors;
              anim.sweepGroup.rotation.z = anim.time * 1.6;
            }
            if (life.flowPlaying) anim.flowTime += dt * life.speed;
          } else {
            if (anim.sweepGroup) anim.sweepGroup.visible = false;
            if (anim.ledMat) anim.ledMat.emissiveIntensity = 0.6;
            if (anim.driverLedMat) anim.driverLedMat.emissiveIntensity = 0.25;
          }
          updateFlow();
          controls.update();
          resize();
          renderer.render(scene, camera);
        };
        applyExplode(0);
        tick();
        cbRef.current.onReady();
        setSceneReady(true);

        cleanup = () => {
          cancelAnimationFrame(raf);
          canvas.removeEventListener('pointerdown', onDown);
          canvas.removeEventListener('pointerup', onUp);
          canvas.removeEventListener('dragover', onDragOver);
          canvas.removeEventListener('drop', onDrop);
          controls.dispose();
          anim.envTex.dispose();
          anim.pmrem.dispose();
          fadeTex.dispose();
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

  /* Palette placements: reconcile dropsGroup with the build list.
   * One holder per entry uid; each prop file loads once and is
   * cloned per instance (clones share geometry/materials with the
   * cached original, which is never added to the scene itself).
   * Same orientation as the bench props: glTF +Y maps to scene +Z
   * via the +90° X tilt, the holder stands on z=0 at the entry's
   * position with the manifest's yaw. Holders are not pickable —
   * picking only intersects the robot and specimen groups — and
   * the explode/CAD machinery never touches this group. */
  useEffect(() => {
    const st = sceneRef.current;
    if (!st || !sceneReady) return;
    let cancelled = false;
    (async () => {
      try {
        const { GLTFLoader } = await import(
          'three/addons/loaders/GLTFLoader.js'
        );
        const loader = new GLTFLoader();
        const THREE = st.THREE;
        const want = new Map(placedProps.map((p) => [p.uid, p]));
        holdersRef.current.forEach((holder, uid) => {
          if (!want.has(uid)) {
            st.dropsGroup.remove(holder);
            holdersRef.current.delete(uid);
          }
        });
        for (const p of placedProps) {
          if (cancelled) return;
          if (holdersRef.current.has(p.uid)) continue;
          let proto = glbCacheRef.current.get(p.file);
          if (!proto) {
            const gltf = await loader.loadAsync(
              ROOT + 'catalog/props/simready/' + p.file,
            );
            if (cancelled) return;
            proto = gltf.scene;
            glbCacheRef.current.set(p.file, proto);
          }
          const inner = new THREE.Group();
          inner.rotation.x = Math.PI / 2;
          inner.add(proto.clone(true));
          const holder = new THREE.Group();
          holder.position.set(p.pos[0], p.pos[1], 0);
          holder.rotation.z = p.yaw;
          holder.add(inner);
          holder.traverse((m) => {
            const mm = m as THREE_NS.Mesh;
            if ((mm as { isMesh?: boolean }).isMesh) {
              mm.castShadow = true;
              mm.receiveShadow = true;
            }
          });
          st.dropsGroup.add(holder);
          holdersRef.current.set(p.uid, holder);
        }
      } catch {
        /* A model that fails to load simply does not appear; the
         * build-list entry remains and says the part is in the
         * build — the palette card's preview states the same
         * failure honestly on its own surface. */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [placedProps, sceneReady]);

  /* Wiring layer: rebuild the group from the view-model. Devices
   * are small enough (a build list, not a world) that a wholesale
   * rebuild per change beats incremental sync — and it can never
   * drift from the stored connections. Blocks are translucent
   * with edge lines and a name sprite: schematic furniture, not
   * pretend hardware. Cables are tubes over the shared harness
   * curve (lib/wire3d.ts), coloured by type. */
  useEffect(() => {
    const st = sceneRef.current;
    if (!st || !sceneReady) return;
    const THREE = st.THREE;
    const group = st.wiringGroup;
    group.traverse((m) => {
      const mesh = m as THREE_NS.Mesh;
      if ((mesh as { isMesh?: boolean }).isMesh) {
        mesh.geometry?.dispose();
        const mat = mesh.material as THREE_NS.Material;
        if (mat) {
          const sm = mat as THREE_NS.SpriteMaterial;
          if (sm.map) sm.map.dispose();
          mat.dispose();
        }
      }
    });
    group.clear();
    group.visible = !!wiring;
    if (!wiring) return;

    const COLORS: Record<SceneWireType, number> = {
      power: 0xef4444,
      data: 0x38bdf8,
      signal: 0xfacc15,
    };
    const labelSprite = (text: string) => {
      const cv = document.createElement('canvas');
      cv.width = 256;
      cv.height = 52;
      const ctx = cv.getContext('2d');
      if (ctx) {
        ctx.font = '600 25px -apple-system, "Segoe UI", Roboto, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = 'rgba(0,0,0,0.9)';
        ctx.shadowBlur = 6;
        ctx.fillStyle = '#e8eaed';
        const label = text.length > 24 ? text.slice(0, 23) + '…' : text;
        ctx.fillText(label, 128, 27);
      }
      const tex = new THREE.CanvasTexture(cv);
      const spr = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: tex, transparent: true }),
      );
      spr.scale.set(0.115, 0.023, 1);
      return spr;
    };

    for (const dev of wiring.devices) {
      const [cx, cy] = dev.center;
      const [w, d, h] = dev.size;
      const holder = new THREE.Group();
      holder.position.set(cx, cy, 0);
      const block = new THREE.Mesh(
        new THREE.BoxGeometry(w, d, h),
        new THREE.MeshStandardMaterial({
          color: 0x39424f,
          roughness: 0.75,
          metalness: 0.1,
          transparent: true,
          opacity: 0.88,
        }),
      );
      block.position.z = h / 2;
      block.castShadow = true;
      holder.add(block);
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(block.geometry),
        new THREE.LineBasicMaterial({ color: 0x8b95a5 }),
      );
      edges.position.z = h / 2;
      holder.add(edges);
      const label = labelSprite(dev.name);
      label.position.set(0, 0, h + 0.02);
      holder.add(label);
      for (const port of dev.ports) {
        const marker = new THREE.Mesh(
          new THREE.SphereGeometry(
            wiring.pendingPort === port.key ? 0.009 : 0.0058,
            14,
            10,
          ),
          new THREE.MeshBasicMaterial({ color: COLORS[port.type] }),
        );
        marker.position.set(...port.anchor);
        marker.userData.portKey = port.key;
        group.add(marker);
      }
      group.add(holder);
    }
    for (const conn of wiring.conns) {
      const pts = cableControlPoints(conn.a, conn.b, conn.lane).map(
        (p) => new THREE.Vector3(...p),
      );
      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(
          new THREE.CatmullRomCurve3(pts),
          24,
          wiring.selectedConn === conn.id ? 0.0038 : 0.0023,
          6,
        ),
        new THREE.MeshBasicMaterial({ color: COLORS[conn.type] }),
      );
      tube.userData.connId = conn.id;
      group.add(tube);
    }
  }, [wiring, sceneReady]);

  return <canvas id="view3d" ref={canvasRef} />;
}
