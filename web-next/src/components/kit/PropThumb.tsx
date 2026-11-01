'use client';
/* A bench prop's palette picture: a render of the ACTUAL GLB model,
 * produced live in the visitor's browser the first time the card
 * scrolls into view — the same file the kit scene loads, framed by
 * its own bounding box, rendered once to a still image, and the
 * temporary renderer is disposed immediately (no lingering WebGL
 * contexts). Nothing is pre-rendered or stock: if the model cannot
 * load, the card says so instead of showing a substitute picture. */
import { useEffect, useRef, useState } from 'react';
import type * as THREE_NS from 'three';
import { ROOT } from '../forge/model';

export default function PropThumb({
  file,
  label,
}: {
  file: string;
  label: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let disposed = false;
    const host = hostRef.current;
    if (!host) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        (async () => {
          try {
            const THREE = (await import('three')) as unknown as typeof THREE_NS;
            const { GLTFLoader } = await import(
              'three/addons/loaders/GLTFLoader.js'
            );
            const gltf = await new GLTFLoader().loadAsync(
              ROOT + 'catalog/props/simready/' + file,
            );
            if (disposed) return;
            const W = 320;
            const H = 224;
            const canvas = document.createElement('canvas');
            canvas.width = W;
            canvas.height = H;
            const renderer = new THREE.WebGLRenderer({
              canvas,
              antialias: true,
              alpha: true,
              preserveDrawingBuffer: true,
            });
            const scene = new THREE.Scene();
            scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x1a1c20, 1.0));
            const key = new THREE.DirectionalLight(0xffffff, 2.4);
            key.position.set(0.4, -0.3, 0.7);
            scene.add(key);
            const rim = new THREE.DirectionalLight(0xf59e0b, 0.8);
            rim.position.set(-0.4, 0.35, 0.25);
            scene.add(rim);
            /* Same orientation as the kit scene: glTF is Y-up, this
             * app is Z-up, so the model tilts +90° about X. */
            const inner = new THREE.Group();
            inner.rotation.x = Math.PI / 2;
            inner.add(gltf.scene);
            scene.add(inner);
            const box = new THREE.Box3().setFromObject(inner);
            const sphere = box.getBoundingSphere(new THREE.Sphere());
            const center = box.getCenter(new THREE.Vector3());
            const camera = new THREE.PerspectiveCamera(38, W / H, 0.01, 50);
            camera.up.set(0, 0, 1);
            const dir = new THREE.Vector3(1, -1.5, 0.95).normalize();
            camera.position.copy(center).addScaledVector(dir, sphere.radius * 2.6);
            camera.lookAt(center);
            renderer.render(scene, camera);
            const url = canvas.toDataURL('image/png');
            scene.traverse((o) => {
              const m = o as THREE_NS.Mesh;
              if ((m as { isMesh?: boolean }).isMesh) {
                m.geometry?.dispose();
                const mat = m.material as THREE_NS.MeshStandardMaterial;
                if (mat) {
                  for (const v of Object.values(mat)) {
                    if ((v as THREE_NS.Texture)?.isTexture) {
                      (v as THREE_NS.Texture).dispose();
                    }
                  }
                  mat.dispose();
                }
              }
            });
            renderer.dispose();
            if (!disposed) setSrc(url);
          } catch {
            if (!disposed) setFailed(true);
          }
        })();
      },
      { rootMargin: '120px' },
    );
    io.observe(host);
    return () => {
      disposed = true;
      io.disconnect();
    };
  }, [file]);

  return (
    <div className="palette-thumb" ref={hostRef}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={`Render of the actual ${label} model`} />
      ) : (
        <span className="palette-thumb-note">
          {failed ? 'Model preview could not load' : 'Rendering the model…'}
        </span>
      )}
    </div>
  );
}
