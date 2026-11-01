// Submission smoke gate for the Next.js static export.
// Most routes are client components, so static visible-text comparisons with
// the retired vanilla pages are not a meaningful parity check.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { checkRoute } from "./smoke-lib.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "out");
const routes = [
  { name: "home", path: "index.html", title: "RobotForge — build, fix, modify, upgrade and simulate your robot before you spend a dollar", markers: ["Build, fix, modify, upgrade and simulate your robot before you spend a dollar"] },
  { name: "forge", path: "forge/index.html", title: "Workshop · RobotForge", markers: ["Check a robot before you build it"] },
  { name: "robots", path: "robots/index.html", title: "Robots · RobotForge", markers: ["The Robodex: every robot RobotForge knows"] },
  { name: "evidence", path: "evidence/index.html", title: "Evidence · RobotForge", markers: ["RobotForge gate reports"] },
  { name: "demo", path: "demo/index.html", title: "Demo · RobotForge", markers: ["a broken robot", "simulation evidence"] },
  { name: "garage", path: "garage/index.html", title: "Workshop · RobotForge", markers: ["Your robots and Wrench in one place"] },
  { name: "inventory", path: "inventory/index.html", title: "My parts · RobotForge", markers: ["Photograph the robot parts you own"] },
];

const failures = routes.flatMap((route) => checkRoute(root, route));
if (failures.length) {
  for (const failure of failures) console.error(failure);
  process.exitCode = 1;
} else {
  console.log(`export smoke: ${routes.length} routes and referenced Next assets passed`);
}
