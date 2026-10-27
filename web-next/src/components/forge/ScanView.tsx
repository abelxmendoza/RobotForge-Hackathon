'use client';
/* Point-cloud preview for a measured scan — the React equivalent
 * of scan.js's renderPoints: the same three.js scene (Z-up camera,
 * polar grid under the cloud, amber points, stride-capped at
 * ~90k points), drawn from the visitor's own file in this browser.
 * If three.js or WebGL is unavailable the component reports failure
 * and the caller shows the vanilla fallback line — the measurements
 * never depend on the preview. */
import { useEffect, useRef } from 'react';
import type { Measure, ParsedPly } from './scan';

export default function ScanView({
  parsed,
  measure,
  onReady,
  onFail,
}: {
  parsed: ParsedPly;
  measure: Extract<Measure, { ok: true }>;
  onReady: (info: { shown: number; total: number }) => void;
  onFail: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const cbRef = useRef({ onReady, onFail });
  cbRef.current = { onReady, onFail };

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | null = null;
    (async () => {
      try {
        const THREE = await import('three');
        const { OrbitControls } = await import(
          'three/addons/controls/OrbitControls.js'
        );
        const host = hostRef.current;
        if (!host || disposed) return;
        const scale = measure.scale || 1;
        const cx = (measure.center ? measure.center[0] : 0) / scale;
        const cy = (measure.center ? measure.center[1] : 0) / scale;
        const cz = (measure.center ? measure.center[2] : 0) / scale;
        const spanM = Math.max(...measure.extentsM);
        const raw = parsed.positions;
        const stride = Math.max(1, Math.ceil(parsed.count / 90000));
        const shown = Math.ceil(parsed.count / stride);
        const pts = new Float32Array(shown * 3);
        for (let i = 0, j = 0; i < parsed.count; i += stride, j++) {
          pts[j * 3] = (raw[i * 3] - cx) * scale;
          pts[j * 3 + 1] = (raw[i * 3 + 1] - cy) * scale;
          pts[j * 3 + 2] = (raw[i * 3 + 2] - cz) * scale;
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));

        const renderer = new THREE.WebGLRenderer({
          antialias: true,
          alpha: true,
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        host.innerHTML = '';
        host.appendChild(renderer.domElement);

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(42, 2, 0.001, 100);
        camera.up.set(0, 0, 1);
        camera.position.set(spanM * 1.2, -spanM * 1.5, spanM * 0.9);
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.minDistance = spanM * 0.2;
        controls.maxDistance = spanM * 8;

        scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x1a1c20, 1.0));
        const grid = new THREE.PolarGridHelper(
          Math.max(spanM * 0.75, 0.05),
          12,
          6,
          48,
          0x2c313a,
          0x23262e,
        );
        grid.rotation.x = Math.PI / 2;
        grid.position.z = -measure.extentsM[2] / 2 - 0.001;
        scene.add(grid);
        const points = new THREE.Points(
          geo,
          new THREE.PointsMaterial({
            color: 0xf59e0b,
            size: Math.max(spanM * 0.006, 0.0012),
            sizeAttenuation: true,
            transparent: true,
            opacity: 0.9,
          }),
        );
        scene.add(points);

        const resize = () => {
          const w = host.clientWidth || 700;
          renderer.setSize(w, 340);
          camera.aspect = w / 340;
          camera.updateProjectionMatrix();
        };
        resize();
        const ro =
          typeof window.ResizeObserver !== 'undefined'
            ? new ResizeObserver(resize)
            : null;
        if (ro) ro.observe(host);
        renderer.setAnimationLoop(() => {
          controls.update();
          renderer.render(scene, camera);
        });
        cleanup = () => {
          renderer.setAnimationLoop(null);
          if (ro) ro.disconnect();
          renderer.dispose();
          host.innerHTML = '';
        };
        cbRef.current.onReady({ shown, total: parsed.count });
      } catch {
        if (!disposed) cbRef.current.onFail();
      }
    })();
    return () => {
      disposed = true;
      if (cleanup) cleanup();
    };
    // measured once per (parsed, measure) pair, as in the vanilla flow
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed, measure]);

  return <div className="scan-view" ref={hostRef} />;
}
