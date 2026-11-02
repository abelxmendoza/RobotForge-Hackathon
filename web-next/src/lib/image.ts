'use client';
/* Photo helpers: read a picked/captured image and downscale it in the
 * browser — a larger copy for the model call, a small thumbnail for
 * storage. Nothing is uploaded until a live call sends it. */

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not an image this browser can read.')); };
    img.src = url;
  });
}

function scaled(img: HTMLImageElement, maxSide: number, quality: number): string {
  const s = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * s));
  c.height = Math.max(1, Math.round(img.naturalHeight * s));
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('This browser cannot resize images.');
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', quality);
}

export async function preparePhoto(file: Blob): Promise<{ full: string; thumb: string }> {
  const img = await loadImage(file);
  return { full: scaled(img, 1280, 0.85), thumb: scaled(img, 320, 0.7) };
}

/* One frame of a photo spin: small enough that 24-36 of them fit in
 * this browser's storage next to everything else. */
export async function spinFrame(file: Blob, maxSide = 560, quality = 0.7): Promise<string> {
  return scaled(await loadImage(file), maxSide, quality);
}

/* Frames from a walk-around video: `count` stills spaced evenly over
 * its length. Browsers decode MP4 (H.264) everywhere; an iPhone HEVC
 * .mov may not decode outside Safari, which the error says. */
export async function videoFrames(file: Blob, count: number, maxSide = 560, quality = 0.7): Promise<string[]> {
  const url = URL.createObjectURL(file);
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  v.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      v.onloadeddata = () => resolve();
      v.onerror = () => reject(new Error('This browser cannot read that video. Try an MP4, or pick the photos instead.'));
    });
    const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
    if (!dur) throw new Error('That video has no length this browser can read.');
    const s = Math.min(1, maxSide / Math.max(v.videoWidth, v.videoHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(v.videoWidth * s));
    c.height = Math.max(1, Math.round(v.videoHeight * s));
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('This browser cannot resize images.');
    const out: string[] = [];
    for (let i = 0; i < count; i++) {
      // Skip the very end: the last frame of a walk-around repeats the first.
      const t = Math.min(dur - 0.05, (dur * i) / count);
      await new Promise<void>((resolve) => { v.onseeked = () => resolve(); v.currentTime = t; });
      ctx.drawImage(v, 0, 0, c.width, c.height);
      out.push(c.toDataURL('image/jpeg', quality));
    }
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}
