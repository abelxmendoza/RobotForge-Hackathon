import Link from "next/link";
import type { Robot } from "@/lib/types";
import { robotSlug } from "@/lib/data";
import { classPath, dexId, gateStatusOf, imgSrc, robotImage, staticCheckOf } from "./shared";
import { GateReceipt, StaticBadge, VerdictBadge } from "./badges";
import RobotPhoto from "./RobotPhoto";
import { effectiveSource, ROBOT_SOURCE_META, sourceBadge, type RobotSource } from "@/lib/robotSource";

/* site.py robot_card, byte-for-byte in structure: photo, dex number,
   name, taxonomy class path, verdict pill (recorded runs only), and
   the static-check badge when the entry carries one. The badge
 * reads the EFFECTIVE source — the owner's filing override when
 * one exists (lib/dexOverrides), else the automatic rules — so the
 * pill can never disagree with the Robodex tab the card sits in. */
export default function RobotCard({ robot, hidden = false, sourceOverride = null }: {
  robot: Robot;
  hidden?: boolean;
  sourceOverride?: RobotSource | null;
}) {
  const img = robotImage(robot);
  const gs = gateStatusOf(robot);
  const status = gs.status;
  const check = staticCheckOf(robot);
  const alt = robot.name + (img?.ai ? " (AI concept illustration)" : "");
  return (
    <Link
      className="robot-card"
      href={`/robots/${robotSlug(robot)}/`}
      data-status={status}
      data-mobility={robot.mobility_class ?? ""}
      hidden={hidden}
    >
      {img ? (
        <div className={img.ai ? "ph ai" : "ph"}>
          <RobotPhoto src={imgSrc(img.src)} alt={alt} slug={robotSlug(robot)} name={robot.name} />
        </div>
      ) : (
        <div className="ph ai"></div>
      )}
      <div className="body">
        <span className="dex">{dexId(robot)}</span>
        <span className={`source-badge source-${sourceOverride ?? effectiveSource(robot)}`}>{sourceOverride ? ROBOT_SOURCE_META[sourceOverride].badge : sourceBadge(robot)}</span>
        <h3>{robot.name}</h3>
        <span className="cls">{classPath(robot)}</span>
        <VerdictBadge status={status} />
        <GateReceipt gs={gs} />
        {check ? <StaticBadge check={check} /> : null}
      </div>
    </Link>
  );
}
