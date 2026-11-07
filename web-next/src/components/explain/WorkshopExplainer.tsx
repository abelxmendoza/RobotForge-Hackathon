"use client";
/* "How does <robot> work?" inside the Workshop Overview: the same
 * explainer as /explain/, built from the robot's current draft. It is
 * only mounted while the disclosure is open, and rebuilt only when the
 * spec itself changes (so a re-render of the Workshop never restarts
 * a step that is playing). */
import { useMemo, useState } from "react";
import RobotExplainer from "./RobotExplainer";
import { buildExplainer } from "@/lib/robotExplainer";
import type { Spec } from "@/lib/garage";

export default function WorkshopExplainer({ robotId, name, spec, estimatedPaths }: { robotId: string; name: string; spec: Spec; estimatedPaths?: string[] }) {
  const [open, setOpen] = useState(false);
  const key = JSON.stringify(spec ?? null) + "|" + (estimatedPaths ?? []).join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const explainer = useMemo(() => (open ? buildExplainer(spec, { name, estimatedPaths }) : null), [open, key, name]);
  return (
    <details className="ws-disclosure" onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>How does {name} work? Step by step</summary>
      {explainer && <>
        <RobotExplainer compact explainer={explainer} />
        <p className="g-small"><a href={`/explain/?robot=${encodeURIComponent(robotId)}`}>Open it on its own page</a></p>
      </>}
    </details>
  );
}
