/**
 * "Spot a robot" — the camera handoff between /robots and the Forge.
 *
 * The photo flow itself (robot-or-document ask, live draft, Robodex
 * grouping) lives in the Forge thread. So the /robots camera button
 * does the honest minimum: it downscales the capture in the browser,
 * stashes it in sessionStorage (this tab only, gone when the tab
 * closes), and navigates to /forge, where ForgeThread picks it up
 * on mount and runs it through the exact flow a manually attached
 * photo takes. Nothing is uploaded by the handoff itself; whether
 * the photo leaves the browser is the Forge's live-step decision,
 * stated there as always.
 */

export const SPOT_PHOTO_KEY = "robotforge.spot.photo.v1";

export interface SpotPhoto {
  dataUrl: string;
  name: string;
}

export function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error || new Error("read failed"));
    r.readAsDataURL(file);
  });
}

/* Same downscale the Forge applies before a live photo call: a
 * photo data URL can be megabytes; 1024px is plenty for the draft
 * and keeps the sessionStorage stash small. */
export function downscaleImage(dataUrl: string, maxDim: number): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      if (scale >= 1) {
        resolve(dataUrl);
        return;
      }
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      const ctx = c.getContext("2d");
      if (ctx) ctx.drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

/** Stash a captured photo for the Forge. Best-effort: returns false
 *  when storage is unavailable/full — the caller navigates anyway
 *  and the visitor simply lands on the plain Forge. */
export async function stashSpotPhoto(file: File): Promise<boolean> {
  try {
    const raw = await readAsDataURL(file);
    const small = await downscaleImage(raw, 1024);
    const spot: SpotPhoto = { dataUrl: small, name: file.name || "spot-photo.jpg" };
    window.sessionStorage.setItem(SPOT_PHOTO_KEY, JSON.stringify(spot));
    return true;
  } catch {
    return false;
  }
}

/** Take (and clear) a stashed spot photo, if any. */
export function takeSpotPhoto(): SpotPhoto | null {
  try {
    const raw = window.sessionStorage.getItem(SPOT_PHOTO_KEY);
    if (!raw) return null;
    window.sessionStorage.removeItem(SPOT_PHOTO_KEY);
    const parsed = JSON.parse(raw) as Partial<SpotPhoto>;
    if (typeof parsed.dataUrl !== "string" || !parsed.dataUrl.startsWith("data:")) {
      return null;
    }
    return { dataUrl: parsed.dataUrl, name: parsed.name || "spot-photo.jpg" };
  } catch {
    return null;
  }
}

export async function spotPhotoToFile(spot: SpotPhoto): Promise<File> {
  const blob = await (await fetch(spot.dataUrl)).blob();
  return new File([blob], spot.name, { type: blob.type || "image/jpeg" });
}
