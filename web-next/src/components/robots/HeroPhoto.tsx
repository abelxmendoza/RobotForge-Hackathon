'use client';
/* The robot detail hero figure (mobile UX Phase 2, 2026-10-31):
 * RobotPhoto swaps in an illustration when the credited photo fails
 * to load, but the figcaption used to keep calling it a photo. This
 * wrapper holds the fallback state, so the caption always describes
 * what is actually on screen — the photo credit is preserved when
 * the illustration is standing in for it. */
import { useState } from 'react';
import RobotPhoto from './RobotPhoto';

export default function HeroPhoto({ src, alt, slug, name, ai, caption }:
  { src: string; alt: string; slug: string; name: string; ai?: boolean; caption?: string }) {
  const [photoGone, setPhotoGone] = useState(false);
  const shownCaption = caption
    ? photoGone
      ? `Illustration shown — the photo couldn't load. Photo credit: ${caption.replace(/^Photo:\s*/, '')}`
      : caption
    : null;
  return (
    <figure>
      <div className={ai ? 'ph ai' : 'ph'}>
        <RobotPhoto src={src} alt={alt} slug={slug} name={name}
          onFallback={() => setPhotoGone(true)} />
      </div>
      {shownCaption ? <figcaption>{shownCaption}</figcaption> : null}
    </figure>
  );
}
