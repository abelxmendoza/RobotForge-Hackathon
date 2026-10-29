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
