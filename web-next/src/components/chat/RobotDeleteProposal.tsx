"use client";
/* Preview card for deleting one of your robots from Wrench chat. Same
 * preview -> Apply shape as the other chat operations: nothing is
 * deleted until Delete is tapped. Only a robot in your Workshop ever
 * reaches this card (lib/robotOwnership refuses everything else). */
import { useRef } from "react";
import type { GarageRobot } from "@/lib/garage";
import { deleteOwnedRobot } from "@/lib/robotDelete";
import { deleteWarning } from "@/lib/robotOwnership";

export default function RobotDeleteProposal({ robot, onDone, onCancel }: {
  robot: GarageRobot;
  onDone: (text: string) => void;
  onCancel: () => void;
}) {
  const consumed = useRef(false);
  const apply = () => {
    if (consumed.current) return;
    consumed.current = true;
    const result = deleteOwnedRobot(robot);
    onDone(result.ok ? `Deleted ${robot.name} for good. It's gone from your Workshop and My robots.` : result.error);
  };
  return (
    <div className="fc-msg bot" role="region" aria-label="Delete robot preview">
      <strong>Delete your robot</strong>
      <p>{deleteWarning(robot)}</p>
      <button type="button" className="btn btn-sm g-remove-yes" onClick={apply}>Delete {robot.name}</button>{" "}
      <button type="button" className="btn btn-sm" onClick={onCancel}>Cancel</button>
    </div>
  );
}
