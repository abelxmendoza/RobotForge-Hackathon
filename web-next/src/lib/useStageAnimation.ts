'use client';
/* Living Build Stage — control state + the pause conditions.
 *
 * The pure rules (initial state, whether the clock may advance)
 * live in lib/stageAnimation.ts where the node tests exercise
 * them; this hook only wires them to the browser: the
 * prefers-reduced-motion media query, tab visibility, and an
 * IntersectionObserver on the stage element. It makes no network
 * calls and touches no storage — animation state is ephemeral UI
 * state, identical in demo mode and signed-in mode. */
import { useEffect, useRef, useState, type RefObject } from 'react';
import {
  effectiveFlowPlaying,
  effectivePlaying,
  initialControls,
  type StageControls,
} from './stageAnimation';

export function useStageAnimation(stageRef: RefObject<HTMLElement | null>) {
  const [controls, setControls] = useState<StageControls>(() =>
    initialControls(false),
  );
  const [reducedMotion, setReducedMotion] = useState(false);
  const [tabHidden, setTabHidden] = useState(false);
  const [onScreen, setOnScreen] = useState(true);
  const appliedReduced = useRef(false);

  /* Reduced motion is applied once, at mount, before it can fight
   * with anything the user does afterwards: the stage starts
   * paused and the controls say why. */
  useEffect(() => {
    if (appliedReduced.current) return;
    appliedReduced.current = true;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setReducedMotion(true);
      setControls(initialControls(true));
    }
  }, []);

  useEffect(() => {
    const onVis = () => setTabHidden(document.hidden);
    onVis();
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  useEffect(() => {
    const el = stageRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => setOnScreen(entries.some((e) => e.isIntersecting)),
      { threshold: 0.05 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [stageRef]);

  return {
    controls,
    setControls,
    reducedMotion,
    tabHidden,
    onScreen,
    /** The mechanical-motion clock may advance only when every gate agrees. */
    playingNow: (wiringMode: boolean) =>
      effectivePlaying({ controls, wiringMode, tabHidden, onScreen }),
    /** The electrical-flow clock: same gates, minus the Motion toggle. */
    flowPlayingNow: (wiringMode: boolean) =>
      effectiveFlowPlaying({ controls, wiringMode, tabHidden, onScreen }),
  };
}
