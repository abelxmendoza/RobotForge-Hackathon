'use client';
/* One three.js stage for Scan Studio: the live point cloud from the
 * bridge (push frames through `onReady`'s update function), or a
 * finished PLY scan (pass `ply`). Orbit with drag, zoom with scroll. */
import { useEffect, useRef, useState } from 'react';
import { isZUpRobotForgeScan } from '@/lib/scan3d';

export type PushPoints = (xyz: Float32Array, rgb: Uint8Array) => void;

export default function PointStage({ ply, onReady, label, height = 320 }: {
  ply?: ArrayBuffer;
  onReady?: (push: PushPoints) => void;
  label: string;
  height?: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | null = null;
    (async () => {
      try {
        const THREE = await import('three');
        const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
        if (disposed || !host.current) return;
        const el = host.current;
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        el.appendChild(renderer.domElement);
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x081321);
        scene.add(new THREE.HemisphereLight(0xffffff, 0x223344, 1.2));
        const dir = new THREE.DirectionalLight(0xffffff, 1.2);
        dir.position.set(1, 2, 1.5);
        scene.add(dir);
        const camera = new THREE.PerspectiveCamera(45, 4 / 3, 0.005, 50);
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;

        let object: import('three').Object3D | null = null;
        if (ply) {
          const { PLYLoader } = await import('three/addons/loaders/PLYLoader.js');
          const geo = new PLYLoader().parse(ply);
          if (isZUpRobotForgeScan(ply)) geo.rotateX(-Math.PI / 2); // stored z-up; the viewer is y-up
          const colors = Boolean(geo.getAttribute('color'));
          geo.computeBoundingBox();
          const bb = geo.boundingBox!;
          const size = bb.getSize(new THREE.Vector3());
          const span = Math.max(size.x, size.y, size.z) || 1;
          if (geo.index) {
            if (!geo.getAttribute('normal')) geo.computeVertexNormals();
            object = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: colors, roughness: 0.85 }));
          } else {
            object = new THREE.Points(geo, new THREE.PointsMaterial({ size: span / 260, vertexColors: colors }));
          }
          scene.add(object);
          const grid = new THREE.GridHelper(span * 2, 20, 0x2a4a66, 0x16283a);
          grid.position.y = bb.min.y;
          scene.add(grid);
          const centre = bb.getCenter(new THREE.Vector3());
          controls.target.copy(centre);
          camera.position.set(centre.x + span * 1.3, centre.y + span * 0.8, centre.z + span * 1.3);
        } else {
          // Live view: the camera's own point of view, metres, y up, looking down -z.
          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
          geo.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(0), 3, true));
          object = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.006, vertexColors: true }));
          scene.add(object);
          controls.target.set(0, 0, -0.6);
          camera.position.set(0.35, 0.25, 0.15);
          const pts = object as import('three').Points;
          onReady?.((xyz, rgb) => {
            pts.geometry.setAttribute('position', new THREE.BufferAttribute(xyz, 3));
            pts.geometry.setAttribute('color', new THREE.BufferAttribute(rgb, 3, true));
            pts.geometry.computeBoundingSphere();
          });
        }

        const resize = () => {
          const w = el.clientWidth || 480;
          renderer.setSize(w, height);
          camera.aspect = w / height;
          camera.updateProjectionMatrix();
        };
        resize();
        const ro = new ResizeObserver(resize);
        ro.observe(el);
        renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
        cleanup = () => {
          ro.disconnect();
          renderer.setAnimationLoop(null);
          controls.dispose();
          scene.traverse((o) => {
            const m = o as import('three').Mesh;
            m.geometry?.dispose?.();
            const mat = m.material as import('three').Material | import('three').Material[] | undefined;
            (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((x) => x.dispose());
          });
          renderer.dispose();
          renderer.domElement.remove();
        };
      } catch (e) {
        if (!disposed) setError((e as Error).message || 'The 3D view could not start.');
      }
    })();
    return () => { disposed = true; cleanup?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ply]);

  return (
    <div className="scan-stage" ref={host} role="img" aria-label={label} style={{ minHeight: height }}>
      {error && <p className="g-error scan-wait" role="alert">{error}</p>}
    </div>
  );
}
