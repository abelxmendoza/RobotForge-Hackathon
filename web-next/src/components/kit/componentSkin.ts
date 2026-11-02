/* Stylized 3D component detail proxies strictly bounded within the component envelope [l, w, h].
 * These give recognizable hardware form (PCB, heatsink fins, ports, lenses, transducers,
 * inductors, battery straps, mounting hole rings, and +X orientation indicators)
 * without claiming manufacturer CAD accuracy. */
import type * as T from 'three';

export function addComponentSkin(
  THREE: typeof T,
  mesh: T.Object3D,
  size: [number, number, number],
  componentId: string,
) {
  const [l, w, h] = size;
  const material = (color: number, metalness = 0.18, roughness = 0.45) =>
    new THREE.MeshStandardMaterial({ color, metalness, roughness });

  const pcbGreen = material(0x12644e, 0.15, 0.48);
  const pcbBlue = material(0x164e87, 0.15, 0.48);
  const pcbRed = material(0x8f1d24, 0.15, 0.5);
  const pcbTeal = material(0x0f766e, 0.18, 0.45);
  const metal = material(0x64748b, 0.85, 0.26);
  const silver = material(0xcbd5e1, 0.88, 0.22);
  const brass = material(0xd99b26, 0.85, 0.25);
  const copper = material(0xb87333, 0.82, 0.28);
  const black = material(0x111827, 0.22, 0.45);
  const darkAnodized = material(0x1e293b, 0.65, 0.32);
  const accentCyan = material(0x22d3ee, 0.3, 0.3);
  const warnYellow = material(0xeab308, 0.2, 0.4);
  const estopRed = material(0xdc2626, 0.25, 0.35);

  const box = (
    dims: [number, number, number],
    position: [number, number, number],
    mat: T.Material,
  ) => {
    const part = new THREE.Mesh(new THREE.BoxGeometry(...dims), mat);
    part.position.set(...position);
    part.castShadow = true;
    part.receiveShadow = true;
    mesh.add(part);
    return part;
  };

  // Helper: 4 corner gold mounting pad rings inside the PCB footprint
  const addCornerMountPads = (zPos: number, insetX = 0.41, insetY = 0.41) => {
    const padSize = Math.min(l, w) * 0.08;
    const padH = Math.min(h * 0.12, 0.0018);
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        box([padSize, padSize, padH], [sx * l * insetX, sy * w * insetY, zPos], brass);
      }
    }
  };

  // Helper: subtle +X forward orientation arrow bar on top surface
  const addForwardMarker = (zTop: number) => {
    const barL = Math.min(l * 0.16, 0.012);
    const barW = Math.min(w * 0.08, 0.004);
    const barH = Math.min(h * 0.06, 0.001);
    if (zTop + barH / 2 <= h * 0.495) {
      box([barL, barW, barH], [l * 0.36, 0, zTop], accentCyan);
    }
  };

  if (componentId.startsWith('jetson')) {
    // Carrier PCB + SOM + finned black heatsink + +X USB/RJ45/DP I/O cluster
    box([l * 0.96, w * 0.96, h * 0.10], [0, 0, -h * 0.40], pcbGreen);
    addCornerMountPads(-h * 0.34, 0.42, 0.41);
    box([l * 0.62, w * 0.64, h * 0.38], [-l * 0.04, 0, -h * 0.08], black);
    for (let i = 0; i < 11; i++) {
      box(
        [l * 0.58, w * 0.022, h * 0.36],
        [-l * 0.04, (i - 5) * w * 0.052, h * 0.22],
        darkAnodized,
      );
    }
    // +X edge silver I/O shields
    for (let i = 0; i < 3; i++) {
      box(
        [l * 0.13, w * 0.16, h * 0.42],
        [l * 0.40, (i - 1) * w * 0.25, -h * 0.14],
        silver,
      );
    }
    // 40-pin GPIO header strip along +Y edge
    box([l * 0.50, w * 0.06, h * 0.26], [-l * 0.05, w * 0.43, -h * 0.20], black);
    addForwardMarker(h * 0.42);
  } else if (componentId.startsWith('raspberry')) {
    // Raspberry Pi 5 green PCB, silver RP1/BCM2712 heat spreader, USB/Eth on +X, GPIO on +Y
    box([l * 0.96, w * 0.96, h * 0.10], [0, 0, -h * 0.40], pcbGreen);
    addCornerMountPads(-h * 0.34, 0.35, 0.42);
    // SoC + PMIC + RP1 chips
    box([l * 0.22, w * 0.30, h * 0.22], [-l * 0.10, -w * 0.04, -h * 0.22], silver);
    box([l * 0.14, w * 0.20, h * 0.18], [l * 0.14, w * 0.06, -h * 0.24], black);
    // +X dual USB + Ethernet jacks
    for (let i = 0; i < 3; i++) {
      box(
        [l * 0.18, w * 0.22, h * 0.58],
        [l * 0.38, (i - 1) * w * 0.28, -h * 0.05],
        silver,
      );
    }
    // 40-pin GPIO header along +Y
    box([l * 0.58, w * 0.08, h * 0.38], [-l * 0.08, w * 0.41, -h * 0.14], black);
    addForwardMarker(-h * 0.32);
  } else if (componentId.startsWith('converter')) {
    // Synchronous buck converter: blue PCB, copper toroid inductor, caps, screw blocks
    box([l * 0.94, w * 0.94, h * 0.12], [0, 0, -h * 0.38], pcbBlue);
    addCornerMountPads(-h * 0.30, 0.40, 0.36);
    const coil = new THREE.Mesh(
      new THREE.TorusGeometry(w * 0.22, w * 0.055, 12, 28),
      copper,
    );
    coil.position.set(0, -w * 0.05, h * 0.04);
    mesh.add(coil);
    // Input (-X) and Output (+X) terminal blocks
    box([l * 0.18, w * 0.66, h * 0.42], [-l * 0.35, 0, -h * 0.08], pcbGreen);
    box([l * 0.18, w * 0.66, h * 0.42], [l * 0.35, 0, -h * 0.08], pcbGreen);
    // Blue trim pot with brass screw
    box([l * 0.18, w * 0.18, h * 0.34], [0, w * 0.28, -h * 0.12], pcbBlue);
    addForwardMarker(-h * 0.28);
  } else if (componentId.startsWith('driver')) {
    // Dual H-bridge (L298N): red PCB, tall central finned heatsink, 3 screw terminal blocks
    box([l * 0.95, w * 0.95, h * 0.10], [0, 0, -h * 0.40], pcbRed);
    addCornerMountPads(-h * 0.33, 0.41, 0.41);
    // Central vertical heatsink fins
    for (let i = -2; i <= 2; i++) {
      box(
        [l * 0.10, w * 0.52, h * 0.72],
        [i * l * 0.075, 0, h * 0.02],
        black,
      );
    }
    // Left/Right motor screw blocks & power/PWM terminals
    box([l * 0.36, w * 0.18, h * 0.32], [0, w * 0.36, -h * 0.18], pcbBlue);
    box([l * 0.36, w * 0.18, h * 0.32], [0, -w * 0.36, -h * 0.18], pcbBlue);
    box([l * 0.18, w * 0.46, h * 0.32], [-l * 0.36, 0, -h * 0.18], pcbBlue);
    addForwardMarker(-h * 0.32);
  } else if (componentId.startsWith('realsense')) {
    // Intel RealSense D435: silver CNC aluminum bar, dark front glass on +X, stereo IR + RGB lenses
    box([l * 0.88, w * 0.96, h * 0.92], [-l * 0.04, 0, 0], silver);
    box([l * 0.08, w * 0.92, h * 0.82], [l * 0.42, 0, 0], black);
    for (const yOff of [-w * 0.32, 0, w * 0.28]) {
      const lens = new THREE.Mesh(
        new THREE.CylinderGeometry(h * 0.18, h * 0.18, l * 0.06, 20),
        accentCyan,
      );
      lens.rotation.z = Math.PI / 2;
      lens.position.set(l * 0.45, yOff, 0);
      mesh.add(lens);
    }
  } else if (componentId.startsWith('rplidar')) {
    // Slamtec RPLIDAR A1: matte black stepped base + rotating top turret cylinder + laser band
    box([l * 0.94, w * 0.94, h * 0.38], [0, 0, -h * 0.28], black);
    addCornerMountPads(-h * 0.08, 0.38, 0.38);
    const rTurret = Math.min(l, w) * 0.44;
    const turret = new THREE.Mesh(
      new THREE.CylinderGeometry(rTurret, rTurret, h * 0.46, 28),
      darkAnodized,
    );
    turret.rotation.x = Math.PI / 2;
    turret.position.set(l * 0.06, 0, h * 0.18);
    mesh.add(turret);
    const ring = new THREE.Mesh(
      new THREE.CylinderGeometry(rTurret * 1.01, rTurret * 1.01, h * 0.08, 28),
      accentCyan,
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.set(l * 0.06, 0, h * 0.22);
    mesh.add(ring);
    addForwardMarker(-h * 0.07);
  } else if (componentId.startsWith('ultrasonic')) {
    // HC-SR04: blue vertical PCB + two silver cylindrical transducer cans facing +X + 4-pin header + crystal
    box([l * 0.26, w * 0.96, h * 0.92], [-l * 0.22, 0, 0], pcbBlue);
    box([l * 0.14, w * 0.28, h * 0.24], [-l * 0.38, 0, -h * 0.28], brass);
    box([l * 0.08, w * 0.22, h * 0.18], [-l * 0.06, 0, h * 0.24], silver);
    const rCan = Math.min(w * 0.18, h * 0.38);
    for (const sign of [-1, 1]) {
      const can = new THREE.Mesh(
        new THREE.CylinderGeometry(rCan, rCan, l * 0.56, 24),
        silver,
      );
      can.rotation.z = Math.PI / 2;
      can.position.set(l * 0.16, sign * w * 0.26, 0);
      mesh.add(can);
    }
  } else if (componentId.startsWith('imu')) {
    // 9-DoF IMU breakout: teal PCB, central QFN MEMS sensor, Qwiic connectors, +X/+Y axes
    box([l * 0.96, w * 0.96, h * 0.45], [0, 0, -h * 0.22], pcbTeal);
    addCornerMountPads(0, 0.38, 0.38);
    box([l * 0.26, w * 0.32, h * 0.35], [0, 0, h * 0.15], black);
    // +X and +Y orientation silkscreen bars
    box([l * 0.28, w * 0.06, h * 0.15], [l * 0.25, 0, h * 0.12], accentCyan);
    box([l * 0.06, w * 0.28, h * 0.15], [0, w * 0.25, h * 0.12], warnYellow);
  } else if (componentId.startsWith('gearmotor')) {
    // 37D metal gearmotor: silver gearbox front, black motor body, rear encoder cap, +X D-shaft
    const rMotor = Math.min(w, h) * 0.46;
    const gearbox = new THREE.Mesh(
      new THREE.CylinderGeometry(rMotor, rMotor, l * 0.36, 24),
      silver,
    );
    gearbox.rotation.z = Math.PI / 2;
    gearbox.position.set(l * 0.16, 0, 0);
    mesh.add(gearbox);
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(rMotor * 0.94, rMotor * 0.94, l * 0.40, 24),
      black,
    );
    body.rotation.z = Math.PI / 2;
    body.position.set(-l * 0.18, 0, 0);
    mesh.add(body);
    const encoder = new THREE.Mesh(
      new THREE.CylinderGeometry(rMotor * 0.82, rMotor * 0.82, l * 0.10, 20),
      pcbGreen,
    );
    encoder.rotation.z = Math.PI / 2;
    encoder.position.set(-l * 0.42, 0, 0);
    mesh.add(encoder);
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(rMotor * 0.18, rMotor * 0.18, l * 0.14, 16),
      brass,
    );
    shaft.rotation.z = Math.PI / 2;
    shaft.position.set(l * 0.41, 0, 0);
    mesh.add(shaft);
  } else if (componentId.startsWith('estop')) {
    // Emergency stop switch: yellow safety enclosure + corner screws + black collar + red mushroom button
    box([l * 0.92, w * 0.92, h * 0.54], [0, 0, -h * 0.20], warnYellow);
    addCornerMountPads(h * 0.08, 0.36, 0.36);
    const rCap = Math.min(l, w) * 0.40;
    const collar = new THREE.Mesh(
      new THREE.CylinderGeometry(rCap * 0.65, rCap * 0.65, h * 0.18, 24),
      black,
    );
    collar.rotation.x = Math.PI / 2;
    collar.position.set(0, 0, h * 0.14);
    mesh.add(collar);
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(rCap, rCap * 0.85, h * 0.24, 28),
      estopRed,
    );
    cap.rotation.x = Math.PI / 2;
    cap.position.set(0, 0, h * 0.32);
    mesh.add(cap);
  } else {
    // Battery packs (4S / 3S LiPo): shrink-wrapped pack, top label, dual Velcro straps, +X XT60 plug
    box([l * 0.92, w * 0.94, h * 0.92], [-l * 0.02, 0, 0], black);
    box([l * 0.52, w * 0.68, 0.0006], [-l * 0.02, 0, h * 0.465], material(0x1f8e91, 0.1));
    for (const sign of [-1, 1]) {
      box(
        [l * 0.05, w * 0.96, h * 0.96],
        [sign * l * 0.28, 0, 0],
        material(0x334155, 0.15, 0.7),
      );
    }
    // Yellow XT60 plug proxy at +X end
    box([l * 0.08, w * 0.34, h * 0.32], [l * 0.45, 0, h * 0.12], warnYellow);
  }
}
