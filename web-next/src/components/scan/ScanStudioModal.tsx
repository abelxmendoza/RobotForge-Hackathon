'use client';
/* The Workshop's camera window: Scan Studio for one robot, opened from
 * that robot's Overview. Live colour, depth and 3D points from the
 * RealSense (through the local bridge), Record, Build, and save straight
 * into this robot's RealSense scan slot. Closing it stops the live view. */
import { useEffect, useRef } from 'react';
import ScanStudio, { type StudioRobot } from './ScanStudio';
import type { SlotScan } from '@/lib/scan3d';

export default function ScanStudioModal({ robot, onAttach, onClose }: {
  robot: StudioRobot;
  onAttach: (meta: Omit<SlotScan, 'kind'>) => string | null;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="dex-modal studio-modal"
      aria-labelledby="studio-modal-title"
      onClose={onClose}
    >
      <div className="dex-modal-head">
        <h2 id="studio-modal-title">Scan {robot.name} with a RealSense</h2>
        <p className="faint">Live camera view, a walk-around recording, and a measured 3D scan saved to {robot.name}.</p>
        <button type="button" className="fc-close" onClick={onClose} aria-label="Close the camera window">✕</button>
      </div>
      <div className="studio-modal-body">
        <ScanStudio robot={robot} onAttach={onAttach} autoConnect onDone={onClose} />
      </div>
    </dialog>
  );
}
