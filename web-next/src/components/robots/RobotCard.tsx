import Link from "next/link";
import type { Robot } from "@/lib/types";
import { robotSlug } from "@/lib/data";
import { classPath, dexId, gateStatusOf, imgSrc, robotImage, staticCheckOf } from "./shared";
import { GateReceipt, StaticBadge, VerdictBadge } from "./badges";
import RobotPhoto from "./RobotPhoto";

/* site.py robot_card, byte-for-byte in structure: photo, dex number,
   name, taxonomy class path, verdict pill (recorded runs only), and
   the static-check badge when the entry carries one. */
export default function RobotCard({ robot, hidden = false }: { robot: Robot; hidden?: boolean }) {
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
        <h3>{robot.name}</h3>
        <span className="cls">{classPath(robot)}</span>
        <VerdictBadge status={status} />
        <GateReceipt gs={gs} />
        {check ? <StaticBadge check={check} /> : null}
      </div>
    </Link>
  );
}
