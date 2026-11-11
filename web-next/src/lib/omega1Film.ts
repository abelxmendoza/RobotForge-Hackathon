/* Omega1 teardown film — the script.
 *
 * One input, the film time t in seconds. Every part offset, the camera,
 * the turntable, the drive-out and the caption are a pure function of
 * (cut, t), and so is the score: renderScore() writes the sound from the
 * same cue list the picture uses, so the page, the recorded MP4 and the
 * sound can't drift apart. Zero imports: the tests and the capture tool
 * run this file directly under node.
 *
 * What it films is Omega1's ProjectSim twin (assets/omega1-twin/
 * omega1-rover.glb): six links (chassis, sensor head, four wheels) with
 * ESTIMATED geometry generated from a photo. The film only moves those
 * links; it never invents a part the twin doesn't have. Facts in the
 * captions come from docs/omega1/omega1.extracted.json (channel map,
 * HC-SR04 pins) and the kit record (Pi 4B, 2× 18650 at 7.4 V); the
 * twin's estimated status is said on screen.
 *
 * Frame: the twin's own glTF frame, metres. +y up, the sensor head
 * (front) is +z, and Omega1's left is +x. The GLB's wheel node names
 * are mirrored against that, so the page sorts wheels by where they
 * sit, never by name.
 */

export type Vec3 = [number, number, number];
export type FilmCut = 'full' | 'short';
export type Corner = 'front_left' | 'front_right' | 'rear_left' | 'rear_right';
export type FilmPart = 'head' | Corner;
export type ShotId = 'hero' | 'head' | 'wheel' | 'deck' | 'explode' | 'snap' | 'drive';

export interface Shot {
  id: ShotId;
  title: string;
  say: string;
  /* Seconds this shot lasts in each cut; 0 leaves it out of that cut. */
  full: number;
  short: number;
}

/* From Omega1's own motor table (omega1.extracted.json,
 * motors.channel_map.*, DOCUMENTED): the PCA9685 channels for each wheel. */
export const CHANNELS: Record<Corner, { forward: number; backward: number }> = {
  front_left: { forward: 1, backward: 0 },
  rear_left: { forward: 2, backward: 3 },
  front_right: { forward: 7, backward: 6 },
  rear_right: { forward: 5, backward: 4 },
};
/* sensors.ultrasonic.pins, DOCUMENTED. */
export const HC_SR04_PINS = { trigGpio: 27, echoGpio: 22 };

export const FILM_SHOTS: Shot[] = [
  { id: 'hero', title: 'Omega1', full: 2.2, short: 1.4,
    say: 'Omega1, a Freenove 4WD rover on a Raspberry Pi 4B. This is its 3D twin, estimated from a photo.' },
  { id: 'head', title: 'Sensor head', full: 3.4, short: 2.0,
    say: `The sensor head comes off first. The kit mounts its HC-SR04 ultrasonic and camera up front; the code reads the HC-SR04 on GPIO ${HC_SR04_PINS.trigGpio} (trigger) and ${HC_SR04_PINS.echoGpio} (echo).` },
  { id: 'wheel', title: 'Front-left wheel', full: 3.4, short: 2.0,
    say: `One of four driven wheels, each on its own TT gearmotor. This one runs on PCA9685 channel ${CHANNELS.front_left.forward} forward and ${CHANNELS.front_left.backward} backward.` },
  { id: 'deck', title: 'The deck', full: 3.0, short: 0,
    say: 'Wheels and head off: the deck that carries the Pi 4B, the PCA9685 motor hat and two 18650 cells (7.4 V). The twin draws it as one piece, so it opens no further.' },
  { id: 'explode', title: 'All six pieces', full: 3.6, short: 2.4,
    say: 'Six pieces in the twin: chassis, sensor head and four wheels.' },
  { id: 'snap', title: 'Back together', full: 1.4, short: 0.8,
    say: 'And back together.' },
  { id: 'drive', title: 'Drive out', full: 3.0, short: 1.4,
    say: 'Skid steer: four wheels, no steering. The real Omega1 is off the bench for repairs, so its twin drives for now.' },
];

export interface ShotSpan { shot: Shot; start: number; end: number }

export function filmShots(cut: FilmCut): ShotSpan[] {
  let t = 0;
  const out: ShotSpan[] = [];
  for (const shot of FILM_SHOTS) {
    const d = shot[cut];
    if (d <= 0) continue;
    out.push({ shot, start: t, end: t + d });
    t += d;
  }
  return out;
}

export function filmLength(cut: FilmCut): number {
  const s = filmShots(cut);
  return s[s.length - 1].end;
}

/* --- easing and vectors ------------------------------------------------ */
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
/* Smootherstep: zero velocity and acceleration at both ends. */
export const ease = (x: number) => { const u = clamp01(x); return u * u * u * (u * (u * 6 - 15) + 10); };
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const lerp3 = (a: Vec3, b: Vec3, u: number): Vec3 => [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];
const scale3 = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
/* Rise from 0 to 1 over [a, b] of the shot, hold, fall back over [c, d]. */
const pulse = (u: number, a: number, b: number, c: number, d: number) => ease((u - a) / (b - a)) * (1 - ease((u - c) / (d - c)));

/* Where each piece goes when it comes off, in the twin's frame. */
const OUT: Record<FilmPart, Vec3> = {
  head: [0, 0.085, 0.03],
  front_left: [0.085, 0, 0.015],
  rear_left: [0.085, 0, -0.015],
  front_right: [-0.085, 0, 0.015],
  rear_right: [-0.085, 0, -0.015],
};
const PARTS = Object.keys(OUT) as FilmPart[];
/* The twin's measured-off-the-model centres (from the GLB's own bounds). */
export const HEAD_CENTRE: Vec3 = [0, 0.091, 0.028];
export const WHEEL_CENTRE: Record<Corner, Vec3> = {
  front_left: [0.074, 0.034, 0.06],
  rear_left: [0.074, 0.034, -0.06],
  front_right: [-0.074, 0.034, 0.06],
  rear_right: [-0.074, 0.034, -0.06],
};
/* Estimated twin wheel radius (WHEEL_CENTRE height above the floor). */
export const WHEEL_R = 0.034;

export interface FilmFrame {
  t: number;
  shot: Shot;
  index: number;
  /* 0..1 through the current shot. */
  u: number;
  offsets: Record<FilmPart, Vec3>;
  /* Extra wheel roll (radians, about the axle) on top of the drive roll. */
  partSpin: Record<FilmPart, number>;
  /* Whole-robot turntable yaw (radians) and drive-out distance along +z (m). */
  yaw: number;
  driveZ: number;
  wheelRoll: number;
  camera: { pos: Vec3; target: Vec3; fov: number };
}

type Key = [number, Vec3, Vec3]; // [u, camera position, look target]
/* Each shot's camera path, as keys along u. The path is smooth inside a
 * shot (smootherstep between keys); the cut between shots is a cut. */
const CAMERA: Record<ShotId, { fov: number; keys: Key[] }> = {
  hero: { fov: 34, keys: [[0, [0.3, 0.17, 0.37], [0, 0.055, 0]], [1, [0.23, 0.13, 0.29], [0, 0.055, 0.01]]] },
  // Macro from the front, just above the head, pushing in while it hangs open.
  head: { fov: 30, keys: [[0, [0.12, 0.17, 0.4], [0, 0.09, 0.03]], [0.45, [0.07, 0.22, 0.34], [0, 0.155, 0.04]], [1, [0.05, 0.22, 0.3], [0, 0.15, 0.04]]] },
  // Low on Omega1's left side, aimed at the front-left wheel.
  wheel: { fov: 32, keys: [[0, [0.42, 0.1, 0.32], [0.07, 0.04, 0.03]], [0.55, [0.4, 0.08, 0.18], [0.12, 0.036, 0.04]], [1, [0.37, 0.08, 0.14], [0.12, 0.036, 0.05]]] },
  // Straight down on the deck, a slow turn.
  deck: { fov: 38, keys: [[0, [0.12, 0.46, 0.26], [0, 0.04, 0]], [1, [-0.08, 0.42, 0.24], [0, 0.04, 0]]] },
  // Wide and high while the turntable spins.
  explode: { fov: 36, keys: [[0, [0.48, 0.34, 0.48], [0, 0.08, 0]], [1, [0.42, 0.28, 0.42], [0, 0.075, 0]]] },
  snap: { fov: 36, keys: [[0, [0.42, 0.28, 0.42], [0, 0.06, 0]], [1, [0.32, 0.17, 0.36], [0, 0.05, 0]]] },
  // A fixed low camera ahead and to the side: Omega1 drives past it and out of frame.
  drive: { fov: 34, keys: [[0, [0.32, 0.17, 0.36], [0, 0.05, 0]], [1, [0.46, 0.12, 0.5], [0.04, 0.04, 0.5]]] },
};

function cameraAt(id: ShotId, u: number) {
  const { fov, keys } = CAMERA[id];
  let i = 0;
  while (i < keys.length - 2 && u > keys[i + 1][0]) i++;
  const [ua, pa, ta] = keys[i];
  const [ub, pb, tb] = keys[Math.min(i + 1, keys.length - 1)];
  const k = ub > ua ? ease((u - ua) / (ub - ua)) : 0;
  return { pos: lerp3(pa, pb, k), target: lerp3(ta, tb, k), fov };
}

const zero = (): Record<FilmPart, Vec3> => ({ head: [0, 0, 0], front_left: [0, 0, 0], front_right: [0, 0, 0], rear_left: [0, 0, 0], rear_right: [0, 0, 0] });
const zeroSpin = (): Record<FilmPart, number> => ({ head: 0, front_left: 0, front_right: 0, rear_left: 0, rear_right: 0 });

/* Total distance the drive-out covers, metres (an illustration, not
 * Omega1's speed: its speed has never been measured). */
export const DRIVE_OUT_M = 0.9;

export function filmFrame(cut: FilmCut, tIn: number): FilmFrame {
  const spans = filmShots(cut);
  const total = spans[spans.length - 1].end;
  const t = Math.min(Math.max(tIn, 0), total);
  let index = spans.findIndex((s) => t < s.end);
  if (index < 0) index = spans.length - 1;
  const { shot, start, end } = spans[index];
  const u = clamp01((t - start) / (end - start));
  const offsets = zero();
  const partSpin = zeroSpin();
  let yaw = 0, driveZ = 0, wheelRoll = 0;

  if (shot.id === 'head') {
    offsets.head = scale3(OUT.head, pulse(u, 0.08, 0.42, 0.8, 1));
  } else if (shot.id === 'wheel') {
    const k = pulse(u, 0.08, 0.42, 0.8, 1);
    offsets.front_left = scale3(OUT.front_left, k * 1.15);
    partSpin.front_left = k * Math.PI * 0.6;
  } else if (shot.id === 'deck') {
    const k = pulse(u, 0, 0.3, 0.86, 1);
    for (const p of PARTS) offsets[p] = scale3(OUT[p], k * 1.1);
    // The head is set down behind the deck, so it doesn't hide it from above.
    offsets.head = scale3([0, 0.04, -0.2], k);
  } else if (shot.id === 'explode') {
    const k = ease(u / 0.35);
    for (const p of PARTS) offsets[p] = scale3(OUT[p], k * (p === 'head' ? 1.35 : 1.6));
    yaw = ease(u) * Math.PI * 2;
  } else if (shot.id === 'snap') {
    const k = 1 - ease(u / 0.7);
    for (const p of PARTS) offsets[p] = scale3(OUT[p], k * (p === 'head' ? 1.35 : 1.6));
  } else if (shot.id === 'drive') {
    // Ease in from rest; distance = DRIVE_OUT_M · u³ keeps the start gentle.
    const w = clamp01((u - 0.1) / 0.9);
    driveZ = DRIVE_OUT_M * w * w * w;
    wheelRoll = driveZ / WHEEL_R;
  }
  return { t, shot, index, u, offsets, partSpin, yaw, driveZ, wheelRoll, camera: cameraAt(shot.id, u) };
}

/* --- the score --------------------------------------------------------- */
export type CueKind = 'lift' | 'seat' | 'whoosh' | 'click' | 'motor';
export interface Cue { t: number; kind: CueKind; dur: number }

/* Sound cues, from the same shot timing the picture uses. */
export function filmCues(cut: FilmCut): Cue[] {
  const cues: Cue[] = [];
  for (const { shot, start, end } of filmShots(cut)) {
    const d = end - start;
    if (shot.id === 'head' || shot.id === 'wheel') {
      cues.push({ t: start + d * 0.08, kind: 'lift', dur: d * 0.34 });
      cues.push({ t: start + d * 0.8, kind: 'seat', dur: 0.25 });
    } else if (shot.id === 'deck') {
      cues.push({ t: start, kind: 'lift', dur: d * 0.3 });
      cues.push({ t: start + d * 0.86, kind: 'seat', dur: 0.25 });
    } else if (shot.id === 'explode') {
      cues.push({ t: start, kind: 'whoosh', dur: d * 0.4 });
    } else if (shot.id === 'snap') {
      for (let i = 0; i < 6; i++) cues.push({ t: start + d * 0.7 * (0.55 + i * 0.075), kind: 'click', dur: 0.06 });
    } else if (shot.id === 'drive') {
      cues.push({ t: start + d * 0.1, kind: 'motor', dur: d * 0.9 });
    }
  }
  return cues;
}

/* Deterministic noise (seeded, never random: the page and the MP4 hear the same). */
function noiseSource(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2147483648 - 1; };
}

/* The score, mono, as samples in [-1, 1]. A low two-chord pad under
 * the whole film, plus a sound for each cue. */
export function renderScore(cut: FilmCut, sampleRate = 44100): Float32Array {
  const total = filmLength(cut) + 0.6;
  const n = Math.ceil(total * sampleRate);
  const out = new Float32Array(n);
  const TAU = Math.PI * 2;
  // Pad: A minor to F major, swelling in and out.
  const half = filmLength(cut) / 2;
  const chords = [[110, 164.81, 220, 261.63], [87.31, 130.81, 174.61, 220]];
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const env = Math.min(1, t / 1.2) * Math.min(1, Math.max(0, (total - t) / 1.4));
    const c = t < half ? chords[0] : chords[1];
    const x = Math.min(1, Math.abs(t - half) / 0.5); // soften the change
    let v = 0;
    for (const f of c) v += Math.sin(TAU * f * t) + 0.3 * Math.sin(TAU * f * 2.003 * t);
    out[i] += 0.022 * env * (0.6 + 0.4 * x) * v;
  }
  const noise = noiseSource(7);
  for (const cue of filmCues(cut)) {
    const i0 = Math.floor(cue.t * sampleRate);
    const len = Math.floor((cue.dur + 0.3) * sampleRate);
    let lp = 0;
    for (let j = 0; j < len && i0 + j < n; j++) {
      const t = j / sampleRate;
      const u = t / cue.dur;
      let v = 0;
      if (cue.kind === 'lift') {
        // A rising servo-like whine.
        const f = 220 + 260 * Math.min(1, u);
        v = 0.08 * Math.sin(TAU * f * t) * Math.sin(Math.PI * Math.min(1, u)) * (u < 1 ? 1 : 0);
      } else if (cue.kind === 'seat') {
        // A low knock as a part seats.
        v = 0.3 * Math.sin(TAU * 95 * t) * Math.exp(-t * 28) + 0.08 * noise() * Math.exp(-t * 60);
      } else if (cue.kind === 'click') {
        v = 0.22 * noise() * Math.exp(-t * 180) + 0.12 * Math.sin(TAU * 1800 * t) * Math.exp(-t * 120);
      } else if (cue.kind === 'whoosh') {
        lp += 0.04 * (noise() - lp);
        v = 0.9 * lp * Math.sin(Math.PI * Math.min(1, u)) * (u < 1 ? 1 : 0);
      } else if (cue.kind === 'motor') {
        // Gearmotor hum climbing with the drive-out.
        const f = 70 + 90 * Math.min(1, u);
        const saw = 2 * ((f * t) % 1) - 1;
        v = 0.07 * saw * Math.min(1, u * 4) * Math.max(0, 1 - Math.max(0, u - 0.85) / 0.15);
      }
      out[i0 + j] += v;
    }
  }
  for (let i = 0; i < n; i++) out[i] = Math.max(-1, Math.min(1, out[i]));
  return out;
}

/* 16-bit PCM WAV bytes for the score (the capture tool muxes this into the MP4). */
export function scoreWav(cut: FilmCut, sampleRate = 44100): Uint8Array {
  const pcm = renderScore(cut, sampleRate);
  const buf = new ArrayBuffer(44 + pcm.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, Math.round(pcm[i] * 32767), true);
  return new Uint8Array(buf);
}
