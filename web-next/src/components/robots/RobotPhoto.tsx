'use client';
/* A robot's photo, with a drawn fallback. Most photos are hotlinked
 * from the maker's site or Wikimedia; if one fails to load (blocked,
 * moved, offline) the card shows a RobotForge illustration when one
 * exists, or a plain robot outline with the name, never an empty box. */
import { useState } from 'react';
import { assetPath } from '@/components/home/asset';

const ILLUSTRATIONS: Record<string, string> = {
  andino: 'andino.svg',
  'turtlebot3-burger': 'turtlebot3-burger.svg',
  'turtlebot3-waffle-pi': 'turtlebot3-waffle-pi.svg',
  'mini-pupper': 'mini-pupper.svg',
};

export default function RobotPhoto({ src, alt, slug, name }: { src: string; alt: string; slug: string; name: string }) {
  const [stage, setStage] = useState<'photo' | 'drawing' | 'outline'>('photo');
  const drawing = ILLUSTRATIONS[slug];
  if (stage === 'outline' || (stage === 'drawing' && !drawing)) {
    return (
      <span className="ph-fallback" role="img" aria-label={name + ' (photo unavailable)'}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="4" y="7" width="16" height="9" rx="2" /><circle cx="8" cy="18.5" r="1.8" />
          <circle cx="16" cy="18.5" r="1.8" /><path d="M12 7V4" /><circle cx="12" cy="3.5" r=".8" />
        </svg>
        <span>{name}</span>
      </span>
    );
  }
  if (stage === 'drawing') {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={assetPath('assets/img/illustrations/' + drawing)} alt={name + ' (RobotForge illustration)'}
        loading="lazy" onError={() => setStage('outline')} />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} loading="lazy" onError={() => setStage('drawing')} />
  );
}
