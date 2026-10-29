import Link from "next/link";
import { robotSlug } from "@/lib/data";
import type { Robot } from "@/lib/types";
import { assetPath } from "./asset";
import RobotPhoto from "@/components/robots/RobotPhoto";

/**
 * One Robodex card in the landing robot row — a line-for-line port of
 * `robot_card()` in src/robotforge/site.py, driven by the same catalog
 * data (catalog/robots.json, via "@/lib/data").
 *
 * Honesty rules carried over exactly:
 * - the verdict badge comes only from the recorded gate_status;
 * - a robot with no gate run says "Not gated" in grey (norun);
 * - the static-stability badge is a separate, dashed badge that names
 *   itself a computation ("Static check: ..."), never a gate verdict;
 * - generated art is flagged: Pathfinder (a RobotForge design with no
 *   photo) gets the `ai` photo treatment and the alt-text suffix.
 */

interface RobotCheck {
  type: string;
  grade: string;
  tip_angle_deg: number;
}

/** site.py: VERDICT_CLASS / VERDICT_LABEL */
const VERDICT_CLASS: Record<string, string> = {
  PASS: "pass",
  MARGINAL: "marginal",
  FAIL: "fail",
  NOT_GATED: "norun",
};
const VERDICT_LABEL: Record<string, string> = {
  PASS: "Pass",
  MARGINAL: "Marginal",
  FAIL: "Fail",
  NOT_GATED: "Not gated",
};

/** site.py: STABILITY_CLASS */
const STABILITY_CLASS: Record<string, string> = {
  STABLE: "stable",
  MARGINAL: "marginal",
  UNSTABLE: "unstable",
};

/** site.py: _robot_image() with root "" (the landing's depth). */
function robotImage(robot: Robot): { src: string; ai: boolean } | null {
  if (robot.image_url) {
    const src = robot.image_url.startsWith("assets/")
      ? assetPath(robot.image_url)
      : robot.image_url;
    return { src, ai: false };
  }
  if (robot.name === "Pathfinder") {
    return { src: assetPath("assets/img/pathfinder.jpg"), ai: true };
  }
  return null;
}

/** gate_status in the catalog is a record; the lib type also permits a
 * bare string. No record at all means the robot was never gated — the
 * badge must say so rather than borrow a verdict. */
function gateStatus(robot: Robot): string {
  if (typeof robot.gate_status === "string") return robot.gate_status;
  return robot.gate_status?.status ?? "NOT_GATED";
}

export default function RobotCard({ robot }: { robot: Robot }) {
  const image = robotImage(robot);
  const alt = robot.name + (image?.ai ? " (AI concept illustration)" : "");
  const status = gateStatus(robot);
  const checks = robot.checks as RobotCheck[] | undefined;
  const check = checks?.find((c) => c.type === "static_stability");
  const dex = `#${String(robot.number).padStart(3, "0")}`;
  return (
    <Link
      className="robot-card"
      href={`/robots/${robotSlug(robot)}/`}
      data-status={status}
      data-mobility={robot.mobility_class ?? ""}
    >
      {image ? (
        <div className={image.ai ? "ph ai" : "ph"}>
          <RobotPhoto src={image.src} alt={alt} slug={robotSlug(robot)} name={robot.name} />
        </div>
      ) : (
        <div className="ph ai"></div>
      )}
      <div className="body">
        <span className="dex">{dex}</span>
        <h3>{robot.name}</h3>
        <span className="cls">
          {robot.mobility_class} · {robot.subtype}
        </span>
        <span className={`verdict ${VERDICT_CLASS[status] ?? "norun"}`}>
          {VERDICT_LABEL[status] ?? status}
        </span>
        {check ? (
          <span
            className={`static-badge ${STABILITY_CLASS[check.grade] ?? ""}`}
          >
            Static check: {check.grade} — tip margin{" "}
            {Math.round(check.tip_angle_deg)}°
          </span>
        ) : null}
      </div>
    </Link>
  );
}
