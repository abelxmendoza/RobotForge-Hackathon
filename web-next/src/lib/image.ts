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
export async function videoFrames(
  file: Blob, count: number, maxSide = 560, quality = 0.7,
  onProgress?: (completed: number, total: number) => void,
): Promise<string[]> {
  if (!Number.isInteger(count) || count < 1 || count > 36) {
    throw new Error('Choose between 1 and 36 video frames.');
  }
  const url = URL.createObjectURL(file);
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  const wait = (event: 'onloadeddata' | 'onseeked', start: () => void) => new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer);
      v[event] = null;
      v.onerror = null;
      if (error) reject(error); else resolve();
    };
    const timer = setTimeout(() => finish(new Error('Video decoding timed out. Try a shorter MP4 clip.')), 15000);
    v[event] = () => finish();
    v.onerror = () => finish(new Error('This browser cannot read that video. Try an H.264 MP4 or use photos.'));
    try { start(); } catch (error) { finish(error instanceof Error ? error : new Error('Could not decode video.')); }
  });
  try {
    await wait('onloadeddata', () => { v.src = url; });
    const dur = v.duration;
    if (!Number.isFinite(dur) || dur <= 0 || v.videoWidth <= 0 || v.videoHeight <= 0) {
      throw new Error('That video has no readable length or image dimensions.');
    }
    const s = Math.min(1, maxSide / Math.max(v.videoWidth, v.videoHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(v.videoWidth * s));
    c.height = Math.max(1, Math.round(v.videoHeight * s));
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('This browser cannot resize images.');
    const out: string[] = [];
    for (let i = 0; i < count; i++) {
      const t = (dur * i) / count;
      // loadeddata already decoded time zero; a no-op seek need not emit seeked.
      if (v.currentTime !== t) await wait('onseeked', () => { v.currentTime = t; });
      ctx.drawImage(v, 0, 0, c.width, c.height);
      out.push(c.toDataURL('image/jpeg', quality));
      onProgress?.(i + 1, count);
    }
    return out;
  } finally {
    v.pause();
    v.onloadeddata = v.onseeked = v.onerror = null;
    v.removeAttribute('src');
    v.load();
    URL.revokeObjectURL(url);
  }
}
