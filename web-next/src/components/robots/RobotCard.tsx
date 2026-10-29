import Link from "next/link";
import type { Robot } from "@/lib/types";
import { robotSlug } from "@/lib/data";
import { firstSentence } from "@/lib/excerpt";
import { classPath, dexId, gateStatusOf, imgSrc, robotImage, staticCheckOf } from "./shared";
import { StaticBadge, VerdictBadge } from "./badges";

/* site.py robot_card, byte-for-byte in structure: photo, dex number,
   name, taxonomy class path, verdict pill (recorded runs only), and
   the static-check badge when the entry carries one. */
export default function RobotCard({ robot, hidden = false }: { robot: Robot; hidden?: boolean }) {
  const img = robotImage(robot);
  const status = gateStatusOf(robot).status;
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
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imgSrc(img.src)} alt={alt} loading="lazy" />
        </div>
      ) : (
        <div className="ph ai"></div>
      )}
      <div className="body">
        <span className="dex">{dexId(robot)}</span>
        <h3>{robot.name}</h3>
        <span className="cls">{classPath(robot)}</span>
        {/* Wave 6: what this robot is, in one line — the first
            sentence of its recorded catalog description, verbatim. */}
        <p className="line-clamp-3 text-[13px] leading-snug text-dim">
          {firstSentence(robot.description)}
        </p>
        <VerdictBadge status={status} />
        {check ? <StaticBadge check={check} /> : null}
      </div>
    </Link>
  );
}
