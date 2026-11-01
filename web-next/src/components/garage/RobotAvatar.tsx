'use client';
/* A small picture for one of your robots. If its name matches a Robodex
 * robot, it shows that robot's photo. Otherwise, or when the photo can't
 * load, it shows a drawn robot face tinted from the name, so every robot
 * in the list is recognisable at a glance and no box is ever empty. */
import { useState } from 'react';
import { robots as dexRobots } from '@/lib/data';
import type { Robot } from '@/lib/types';
import { assetPath } from '@/components/home/asset';

export function dexPhotoSrc(r: Robot): string {
  if (r.image_url) return r.image_url.startsWith('assets/') ? assetPath(r.image_url) : r.image_url;
  if (r.name === 'Pathfinder') return assetPath('assets/img/pathfinder.jpg');
  return '';
}

function photoFor(names: string[]): string {
  const want = names.map((n) => n.trim().toLowerCase()).filter(Boolean);
  for (const n of want) {
    const hit = dexRobots.find((r) => r.name.toLowerCase() === n);
    if (hit) return dexPhotoSrc(hit);
  }
  return '';
}

function hueOf(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

export default function RobotAvatar({ names, size = 40 }: { names: string[]; size?: number }) {
  const src = photoFor(names);
  const [failed, setFailed] = useState('');
  const label = names.find(Boolean) ?? 'Robot';
  if (src && failed !== src) {
    return (
      <span className="r-avatar" style={{ width: size, height: size }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" loading="lazy" onError={() => setFailed(src)} />
      </span>
    );
  }
  const hue = hueOf(label.toLowerCase());
  return (
    <span className="r-avatar drawn" style={{ width: size, height: size, ['--h' as string]: String(hue) }} aria-hidden="true">
      <svg viewBox="0 0 32 32" width="100%" height="100%">
        <path d="M16 5v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="16" cy="4.5" r="1.4" fill="currentColor" />
        <rect x="7" y="8" width="18" height="13" rx="4" fill="currentColor" opacity=".9" />
        <circle cx="12.5" cy="14.5" r="2.2" fill="var(--bg)" />
        <circle cx="19.5" cy="14.5" r="2.2" fill="var(--bg)" />
        <rect x="5" y="22.5" width="22" height="3.5" rx="1.75" fill="currentColor" opacity=".55" />
        <circle cx="10" cy="27" r="2.4" fill="currentColor" />
        <circle cx="22" cy="27" r="2.4" fill="currentColor" />
      </svg>
    </span>
  );
}
