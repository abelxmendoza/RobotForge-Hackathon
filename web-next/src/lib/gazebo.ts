/* "Launch in Gazebo" — bundle builder.
 *
 * The honest shape, stated here because the code must never blur it:
 * Gazebo cannot run in a browser or in the site's Worker, so this
 * module does the complete job a web app CAN do. For the selected
 * robot it assembles a ready-to-run Gazebo launch package from the
 * robot's actual recorded model data — the same pinned sources the
 * physics checks use (catalog/physics.json, and the PX4 specimen
 * record for the X500's SDF) — and hands the visitor the download
 * plus the exact command. The robot spawns in Gazebo on THEIR
 * machine; nothing here pretends otherwise.
 *
 * What a bundle contains:
 *   - the model file itself (fetched at click time from its pinned
 *     upstream address; mesh references rewritten from package:// to
 *     bundle-relative paths so no ROS package lookup is needed),
 *   - fetch_meshes.sh — downloads the model's mesh files from the
 *     same pinned commit (meshes are upstream binaries; they are
 *     never re-hosted or vendored through this site),
 *   - a minimal generated world (ground plane + sun — labelled
 *     scaffolding, not a recorded environment),
 *   - launch/launch.py for ROS 2 + ros_gz (spawn at the origin,
 *     robot_state_publisher / joint_state_publisher where the model
 *     has movable joints), and a plain `gz sim` variant world that
 *     includes the model directly,
 *   - a README with prerequisites, the exact commands, and the
 *     limits (this spawns the model; it does not wire the original
 *     project's controllers or bringup).
 *
 * Robots whose recorded model Gazebo cannot use get an availability
 * of { ok: false } with the reason instead of a broken bundle:
 * Mini Pupper (no model recorded) and ROBOTIS OP3 (MJCF — a MuJoCo
 * format; RobotForge does not convert formats behind your back).
 * Andino is the special case: its model is xacro spread across a
 * package, so its bundle fetches the official repo on the user's
 * machine and expands the xacro at launch time (the catalogue
 * records the repo but no pinned commit for it, and the bundle says
 * so — it is the one unpinned fetch).
 *
 * Everything here is pure/deterministic given a fetch function —
 * the component injects the browser's fetch; tests inject node's.
 * No Worker calls are made, so bundle building is allowed in demo
 * mode exactly like the physics checks are.
 */
import type { PhysicsEntry } from "./types";

export type GazeboFormat = "urdf" | "sdf" | "xacro";

export interface Px4SpecimenSource {
  repo: string;
  commit: string;
  sdfPath: string;
  license?: string;
}

export interface GazeboInputs {
  slug: string;
  robotName: string;
  /** catalog/physics.json entry for this robot (may be undefined). */
  physics?: PhysicsEntry;
  /** PX4 specimen source (catalog/specimens/px4-x500.json), for the X500. */
  px4?: Px4SpecimenSource;
  /** Official repo URL from the catalogue provenance (Andino). */
  andinoRepoUrl?: string;
}

export type FetchText = (url: string) => Promise<string>;

export interface GazeboFile {
  /** Path inside the zip, including the bundle-root folder. */
  path: string;
  content: string;
}

export interface MeshDownload {
  url: string;
  /** Destination inside the bundle, relative to the bundle root. */
  dest: string;
}

export interface GazeboBundle {
  slug: string;
  robotName: string;
  format: GazeboFormat;
  bundleRoot: string;
  files: GazeboFile[];
  meshDownloads: MeshDownload[];
  /** Mesh references that could not be resolved to a download. */
  unresolvedMeshes: string[];
  /** The primary command, copyable from the page as-is. */
  primaryCommand: string;
  /** The plain `gz sim` variant, or null where it cannot apply. */
  gzCommand: string | null;
  sourceLabel: string;
  license?: string;
  notes: string[];
}

export type GazeboAvailability =
  | { ok: true; format: GazeboFormat }
  | { ok: false; reason: string };

/* ------------------------------------------------------------------ */
/* availability                                                        */
/* ------------------------------------------------------------------ */

const UNAVAILABLE: Record<string, string> = {
  "mini-pupper":
    "No model is recorded in the catalogue for this entry — its spec comes from " +
    "MangDang's published specification pages, which carry no model file. There is " +
    "nothing honest to build a Gazebo bundle from.",
  "robotis-op3":
    "The recorded model for the OP3 is an MJCF from the MuJoCo menagerie. Gazebo " +
    "does not read MJCF, and RobotForge does not convert model formats behind " +
    "your back — so there is no Gazebo bundle for this entry.",
};

export function gazeboAvailability(input: GazeboInputs): GazeboAvailability {
  const { slug, physics } = input;
  if (physics?.status === "urdf") return { ok: true, format: "urdf" };
  if (slug === "px4-x500") return { ok: true, format: "sdf" };
  if (slug === "andino") return { ok: true, format: "xacro" };
  if (UNAVAILABLE[slug]) return { ok: false, reason: UNAVAILABLE[slug] };
  return {
    ok: false,
    reason:
      physics?.reason ??
      "No Gazebo-usable model is recorded for this entry in the catalogue.",
  };
}

/* ------------------------------------------------------------------ */
/* small helpers                                                       */
/* ------------------------------------------------------------------ */

function stripComments(xml: string): string {
  return xml.replace(/<!--[\s\S]*?-->/g, "");
}

function modelNameIn(text: string, kind: "urdf" | "sdf"): string | null {
  const tag = kind === "urdf" ? "robot" : "model";
  const m = text.match(new RegExp(`<${tag}[^>]*\\bname=["']([^"']+)["']`));
  return m ? m[1] : null;
}

function meshFilenames(text: string): string[] {
  const out: string[] = [];
  const re = /filename="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/** sdf <uri> values that point at mesh files (model://… only). */
function sdfMeshUris(text: string): string[] {
  const out: string[] = [];
  const re = /<uri>([^<]+)<\/uri>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const uri = m[1].trim();
    if (uri.startsWith("model://") && !out.includes(uri)) out.push(uri);
  }
  return out;
}

function hasXacroTags(text: string): boolean {
  return /<xacro:/.test(text);
}

function dirOf(urlPath: string): string {
  return urlPath.replace(/[^/]*$/, "");
}

/** Bundle-internal relative path from a directory to a target path. */
function relPath(fromDir: string, to: string): string {
  const from = fromDir.split("/").filter(Boolean);
  const dest = to.split("/").filter(Boolean);
  let common = 0;
  while (
    common < from.length &&
    common < dest.length &&
    from[common] === dest[common]
  ) {
    common++;
  }
  const ups = from.length - common;
  return [...Array(ups).fill(".."), ...dest.slice(common)].join("/");
}

function sanitizeDir(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9_.-]+/g, "-").replace(/^-|-$/g, "");
}

const GENERIC_DIRS = new Set(["assets", "urdf", "model", "models", "description", "robots"]);

/** Where the model package lives inside the bundle's models/ folder,
 *  and how its upstream URL maps onto that root. */
function modelLayout(entry: PhysicsEntry, modelText: string): {
  pkg: string;
  /** Bundle path of the model file, relative to the bundle root. */
  modelDest: string;
  /** Upstream URL prefix that corresponds to models/<pkg>/. */
  pkgRootUrl: string;
} {
  const urdfUrl = entry.urdf_url || "";
  const packages = entry.packages ?? {};
  const pkgKeys = Object.keys(packages);
  const inUrl = pkgKeys.find((k) => urdfUrl.includes(`/${k}/`));
  if (inUrl) {
    const after = urdfUrl.slice(urdfUrl.indexOf(`/${inUrl}/`) + inUrl.length + 2);
    return { pkg: inUrl, modelDest: `models/${inUrl}/${after}`, pkgRootUrl: packages[inUrl] };
  }
  if (pkgKeys.length === 1) {
    const pkg = pkgKeys[0];
    const file = urdfUrl.split("/").pop() || "model.urdf";
    return { pkg, modelDest: `models/${pkg}/${file}`, pkgRootUrl: packages[pkg] };
  }
  // No package map: mirror the URDF's own directory. If that
  // directory's name is generic ("assets", "urdf", …), fall back to
  // the model's own robot name.
  const urlDir = dirOf(urdfUrl);
  const parentName = urlDir.replace(/\/$/, "").split("/").pop() || "";
  const robotName = modelNameIn(modelText, "urdf");
  const pkg =
    parentName && !GENERIC_DIRS.has(parentName)
      ? parentName
      : sanitizeDir(robotName || "model");
  const file = urdfUrl.split("/").pop() || "model.urdf";
  return { pkg, modelDest: `models/${pkg}/${file}`, pkgRootUrl: urlDir };
}

/** Resolve one mesh reference the way physicsEngine.resolveMeshUrl
 *  does, but also report where the file belongs inside the bundle. */
function resolveMesh(
  entry: PhysicsEntry,
  file: string,
  layout: { pkg: string; pkgRootUrl: string },
): { url: string; dest: string } | null {
  if (!file || file.startsWith("$(")) return null;
  if (/^https?:\/\//.test(file)) {
    // An absolute mesh URL: download it into the model package.
    const name = file.split("/").pop() || "mesh";
    return { url: file, dest: `models/${layout.pkg}/meshes/${name}` };
  }
  if (file.startsWith("package://")) {
    const rest = file.slice("package://".length);
    const pkg = rest.split("/")[0];
    const rel = rest.slice(pkg.length + 1);
    const base = entry.packages?.[pkg];
    if (!base) return null;
    return { url: base + rel, dest: `models/${pkg}/${rel}` };
  }
  // Relative to the model's package root (the mirrored layout keeps
  // upstream-relative references valid unchanged).
  const rel = file.replace(/^\.\//, "");
  const url = layout.pkgRootUrl + rel;
  return { url, dest: `models/${layout.pkg}/${rel}` };
}

/* ------------------------------------------------------------------ */
/* generated files                                                     */
/* ------------------------------------------------------------------ */

const WORLD_PLUGINS = `    <plugin filename="gz-sim-physics-system" name="gz::sim::systems::Physics"/>
    <plugin filename="gz-sim-user-commands-system" name="gz::sim::systems::UserCommands"/>
    <plugin filename="gz-sim-scene-broadcaster-system" name="gz::sim::systems::SceneBroadcaster"/>
    <plugin filename="gz-sim-sensors-system" name="gz::sim::systems::Sensors"/>`;

export function buildWorldSdf(include?: { uri: string; name: string }): string {
  const includeBlock = include
    ? `
    <include>
      <uri>${include.uri}</uri>
      <pose>0 0 0 0 0 0</pose>
      <name>${include.name}</name>
    </include>`
    : "";
  return `<?xml version="1.0" ?>
<!-- Generated by RobotForge: a minimal ground-plane + sun world.
     This is scaffolding, not a recorded environment — the robot is
     the recorded part of the bundle; the room it stands in is not. -->
<sdf version="1.9">
  <world name="robotforge_empty">
${WORLD_PLUGINS}
    <physics name="default_physics" default="true" type="ode">
      <max_step_size>0.001</max_step_size>
      <real_time_factor>1.0</real_time_factor>
    </physics>
    <gravity>0 0 -9.81</gravity>
    <scene>
      <ambient>0.4 0.4 0.4 1</ambient>
      <background>0.7 0.7 0.7 1</background>
      <shadows>true</shadows>
    </scene>
    <light name="sun" type="directional">
      <cast_shadows>true</cast_shadows>
      <pose>0 0 10 0 0 0</pose>
      <diffuse>0.8 0.8 0.8 1</diffuse>
      <specular>0.2 0.2 0.2 1</specular>
      <attenuation>
        <range>1000</range>
        <constant>0.9</constant>
        <linear>0.01</linear>
        <quadratic>0.001</quadratic>
      </attenuation>
      <direction>-0.5 0.1 -0.9</direction>
    </light>
    <model name="ground_plane">
      <static>true</static>
      <link name="link">
        <collision name="collision">
          <geometry>
            <plane>
              <normal>0 0 1</normal>
              <size>100 100</size>
            </plane>
          </geometry>
          <surface>
            <friction>
              <ode>
                <mu>100</mu>
                <mu2>50</mu2>
              </ode>
            </friction>
          </surface>
        </collision>
        <visual name="visual">
          <geometry>
            <plane>
              <normal>0 0 1</normal>
              <size>100 100</size>
            </plane>
          </geometry>
          <material>
            <ambient>0.8 0.8 0.8 1</ambient>
            <diffuse>0.8 0.8 0.8 1</diffuse>
            <specular>0.8 0.8 0.8 1</specular>
          </material>
        </visual>
      </link>
    </model>${includeBlock}
  </world>
</sdf>
`;
}

function fetchMeshesSh(downloads: MeshDownload[], sourceNote: string): string {
  const lines = downloads
    .map((d) => `dl ${JSON.stringify(d.url)} ${JSON.stringify(d.dest)}`)
    .join("\n");
  return `#!/bin/sh
# Downloads this model's mesh files. ${sourceNote}
# Nothing is re-hosted by RobotForge: every file comes straight from
# the address below, at run time, on your machine.
set -e
cd "$(dirname "$0")"
dl() {
  if [ -f "$2" ]; then echo "have  $2"; return; fi
  echo "fetch $1"
  mkdir -p "$(dirname "$2")"
  if command -v curl >/dev/null 2>&1; then curl -fL -o "$2" "$1";
  elif command -v wget >/dev/null 2>&1; then wget -O "$2" "$1";
  else echo "error: this script needs curl or wget" >&2; exit 1; fi
}
${lines}
echo "meshes ready (${downloads.length} file${downloads.length === 1 ? "" : "s"})"
`;
}

function packageXml(slug: string, displayName: string, license?: string): string {
  const pkgName = `robotforge_${slug.replace(/-/g, "_")}_gazebo`;
  return `<?xml version="1.0"?>
<package format="3">
  <name>${pkgName}</name>
  <version>1.0.0</version>
  <description>Gazebo launch package for ${displayName}, generated by RobotForge from the robot's recorded model. Informational: the bundle runs by path (ros2 launch launch/launch.py) and does not need to be colcon-built.</description>
  <maintainer email="abelxmendoza@gmail.com">Abel Mendoza</maintainer>
  <license>${license ?? "see the model source"}</license>
  <buildtool_depend>ament_cmake</buildtool_depend>
  <exec_depend>ros_gz_sim</exec_depend>
  <exec_depend>robot_state_publisher</exec_depend>
  <exec_depend>joint_state_publisher</exec_depend>
  <exec_depend>xacro</exec_depend>
  <export>
    <build_type>ament_cmake</build_type>
  </export>
</package>
`;
}

/* The ROS 2 launch file. One template, four modes:
 *   plain  — spawn the bundled model file as-is;
 *   xacro  — the model file carries xacro macros (the TurtleBot3
 *            models declare a namespace argument this way): expand
 *            with xacro at launch, spawn the expansion;
 *   sdf    — the model is a native SDF (PX4 X500): spawn it, no
 *            robot_state_publisher (there is no URDF);
 *   andino — the model is a xacro package fetched by fetch_model.sh:
 *            build a tiny ament prefix so $(find andino_description)
 *            resolves, expand with use_real_ros_control:=false,
 *            rewrite package:// mesh URIs to the fetched tree.     */
function buildLaunchPy(cfg: {
  displayName: string;
  mode: "plain" | "xacro" | "sdf" | "andino";
  modelRel?: string;
  robotName: string;
  sourceLabel: string;
}): string {
  const mode = cfg.mode;
  return `#!/usr/bin/env python3
"""RobotForge Gazebo launch package — ${cfg.displayName}.

Generated by the RobotForge web app from the robot's recorded model
(${cfg.sourceLabel}). Starts Gazebo with a minimal ground-plane
world and spawns the model at the origin. It does NOT wire the
original project's controllers, drivers or bringup: this is the
recorded model standing in Gazebo, not the project's full
simulation stack (a spawned Burger does not drive, a spawned X500
does not fly — those need their own projects' launch files).
"""
import os
import subprocess
import tempfile
from pathlib import Path

from launch import LaunchDescription
from launch.actions import ExecuteProcess, SetEnvironmentVariable, TimerAction
from launch_ros.actions import Node

BUNDLE = Path(__file__).resolve().parent.parent
WORLD = BUNDLE / "worlds" / "empty_world.sdf"
MODE = "${mode}"
ROBOT_NAME = "${cfg.robotName}"
${
  mode === "andino"
    ? `ANDINO_PKG = BUNDLE / "vendor" / "andino" / "andino_description"
XACRO_FILE = ANDINO_PKG / "urdf" / "andino.urdf.xacro"`
    : `MODEL_FILE = BUNDLE / ${JSON.stringify(cfg.modelRel ?? "")}`
}


def _expand_xacro(path, mappings=None):
    """Expand a xacro file to URDF text (ROS 2's xacro, library
    first, CLI as fallback). Returns None when both fail."""
    try:
        import xacro
        doc = xacro.process_file(str(path), mappings=mappings or {})
        return doc.toprettyxml(indent="  ")
    except Exception:
        pass
    try:
        cmd = ["xacro", str(path)]
        for key, value in (mappings or {}).items():
            cmd.append(f"{key}:={value}")
        out = subprocess.run(cmd, capture_output=True, text=True, check=True)
        return out.stdout
    except Exception:
        return None


def _andino_urdf():
    """Fetch-checked, ament-resolved xacro expansion for Andino."""
    if not XACRO_FILE.is_file():
        raise RuntimeError(
            "Andino's model package is not here yet — run "
            "./fetch_model.sh from the bundle root first, then launch again.")
    # xacro resolves $(find andino_description) through the ament
    # index; build the smallest prefix that registers the fetched
    # package, and put it on AMENT_PREFIX_PATH before expanding.
    prefix = BUNDLE / "vendor_prefix"
    marker = prefix / "share" / "ament_index" / "resource_index" / "packages" / "andino_description"
    marker.parent.mkdir(parents=True, exist_ok=True)
    marker.touch()
    link = prefix / "share" / "andino_description"
    if not link.exists():
        link.symlink_to(ANDINO_PKG, target_is_directory=True)
    os.environ["AMENT_PREFIX_PATH"] = str(prefix) + os.pathsep + os.environ.get("AMENT_PREFIX_PATH", "")
    text = _expand_xacro(XACRO_FILE, {"use_real_ros_control": "false"})
    if text is None:
        raise RuntimeError("xacro expansion of andino.urdf.xacro failed — "
                           "is the ROS 2 xacro package installed?")
    # The expanded URDF addresses meshes as package:// — point them
    # at the fetched tree so Gazebo finds them without a workspace.
    text = text.replace("package://andino_description/", str(ANDINO_PKG) + "/")
    out = Path(tempfile.gettempdir()) / "robotforge-andino.urdf"
    out.write_text(text)
    return out, text


def _spawn_target():
    """(file ros_gz_sim create loads, robot_description text or None)."""
    if MODE == "andino":
        path, text = _andino_urdf()
        return path, text
    if MODE == "sdf":
        return MODEL_FILE, None
    if MODE == "xacro":
        text = _expand_xacro(MODEL_FILE)
        if text is None:
            raise RuntimeError(
                "This model uses xacro macros and expansion failed — "
                "is the ROS 2 xacro package installed?")
        out = Path(tempfile.gettempdir()) / ("robotforge-" + ROBOT_NAME + ".urdf")
        out.write_text(text)
        return out, text
    return MODEL_FILE, MODEL_FILE.read_text()


def generate_launch_description():
    spawn_file, description = _spawn_target()
    actions = [
        # model:// mesh URIs (the X500's SDF) resolve through the
        # bundle's own models/ folder.
        SetEnvironmentVariable("GZ_SIM_RESOURCE_PATH", str(BUNDLE / "models")),
        ExecuteProcess(cmd=["gz", "sim", "-r", str(WORLD)], output="screen"),
        TimerAction(period=3.0, actions=[
            ExecuteProcess(
                cmd=["ros2", "run", "ros_gz_sim", "create",
                     "-file", str(spawn_file),
                     "-name", ROBOT_NAME,
                     "-x", "0", "-y", "0", "-z", "0"],
                output="screen"),
        ]),
    ]
    if description:
        actions.append(Node(
            package="robot_state_publisher",
            executable="robot_state_publisher",
            parameters=[{"robot_description": description}],
            output="screen"))
        # Joint states at the zero pose, only when the model
        # actually has movable joints to publish for.
        import re
        if re.search(r'type="(revolute|prismatic|continuous)"', description):
            actions.append(Node(
                package="joint_state_publisher",
                executable="joint_state_publisher",
                parameters=[{"robot_description": description}],
                output="screen"))
    return LaunchDescription(actions)
`;
}

function buildReadme(cfg: {
  displayName: string;
  format: GazeboFormat;
  sourceLabel: string;
  license?: string;
  primaryCommand: string;
  gzCommand: string | null;
  meshDownloads: MeshDownload[];
  unresolvedMeshes: string[];
  modelRel?: string;
  notes: string[];
}): string {
  const meshSection =
    cfg.meshDownloads.length > 0
      ? `The zip is small on purpose: the model's ${cfg.meshDownloads.length} mesh
file${cfg.meshDownloads.length === 1 ? "" : "s"} are upstream binaries and are NOT in it.
Run \`./fetch_meshes.sh\` once — it downloads each mesh from the same
pinned upstream address the model itself came from. Nothing is
re-hosted by RobotForge.`
      : "The model needs no mesh downloads (its geometry is primitives, or its files are already complete) — there is no fetch step.";
  const gzSection =
    cfg.gzCommand != null
      ? `### Or: plain Gazebo, no ROS

\`\`\`sh
${cfg.gzCommand}
\`\`\`

That world file (\`worlds/world_with_robot.sdf\`) is the same generated
world with the model included at the origin. Run it from the bundle
root — the include path is bundle-relative.`
      : `### Plain Gazebo, no ROS

Not offered for this robot: its model is xacro spread across a
package, and something must expand it with the package resolvable
first. The ROS 2 launch above does exactly that; a bare \`gz sim\`
cannot.`;
  const unresolved =
    cfg.unresolvedMeshes.length > 0
      ? `\n## Unresolved mesh references\n\nThe model references these files in a way RobotForge could not map\nto a download; the spawn will show those parts without their mesh\ngeometry until the files are placed by hand:\n${cfg.unresolvedMeshes.map((u) => `- \`${u}\``).join("\n")}\n`
      : "";
  return `# ${cfg.displayName} — Gazebo launch package

Generated by RobotForge (https://robot-forge-hackathon.vercel.app)
from this robot's recorded model.

**Model:** ${cfg.sourceLabel}${cfg.license ? `\n**Model licence:** ${cfg.license}` : ""}

## The honest shape

Gazebo doesn't run in a web browser, so RobotForge didn't pretend
to run it there. This package is the real deliverable a web app can
produce: the robot's recorded model, a minimal world, and launch
files — ready to run **on your machine**. One \`ros2 launch\` (or the
plain \`gz sim\` variant below) and the robot spawns at the origin in
Gazebo.

What this is not: the original project's full simulation stack.
Controllers, drivers and bringup are not wired — the model stands
in its zero pose. A spawned Burger does not drive and a spawned
X500 does not fly; for that, use each project's own launch files
alongside this model.

## Prerequisites (reference stack)

The bundle targets **Ubuntu 24.04 + ROS 2 Jazzy + Gazebo Harmonic**
— \`ros_gz_sim\`, \`robot_state_publisher\`, \`joint_state_publisher\`
and \`xacro\` from that stack. "Targets" is the honest word: the
bundle's files are validated (XML parses, the launch file compiles)
but every Gazebo/ROS pairing behaves a little differently, and
other combinations are unverified rather than promised.

## Run it

\`\`\`sh
${cfg.primaryCommand}
\`\`\`

${meshSection}
${gzSection}

## Files

- \`launch/launch.py\` — the ROS 2 launch: Gazebo + the generated
  world, the model spawned at the origin after a short delay,
  robot_state_publisher (and joint_state_publisher when the model
  has movable joints).
- \`worlds/empty_world.sdf\` — generated scaffolding: a ground
  plane, a sun, default physics. Not a recorded environment.
- \`worlds/world_with_robot.sdf\` — the same world with the model
  included, for the plain \`gz sim\` variant.${cfg.modelRel ? `\n- \`${cfg.modelRel}\` — the model file, from the recorded source above.` : ""}${cfg.format === "xacro" ? `\n- \`fetch_model.sh\` — downloads the official repo (the model is a
  xacro package; see the notes below).
- \`expand_model.sh\` — expands the fetched xacro into robot.urdf
  for the plain \`gz sim\` variant.` : `\n- \`fetch_meshes.sh\` — downloads the model's meshes from the
  pinned upstream commit (when the model has meshes).`}
- \`bundle.json\` — this bundle's manifest: robot, format, model
  source, commands, and the mesh download list.
${cfg.notes.length ? `\n## Notes for this robot\n\n${cfg.notes.map((n) => `- ${n}`).join("\n")}\n` : ""}${unresolved}`;
}

/* ------------------------------------------------------------------ */
/* the builder                                                         */
/* ------------------------------------------------------------------ */

export async function buildGazeboLaunch(
  input: GazeboInputs,
  fetchText: FetchText,
): Promise<GazeboBundle> {
  const avail = gazeboAvailability(input);
  if (!avail.ok) {
    throw new Error(`No Gazebo bundle for ${input.slug}: ${avail.reason}`);
  }
  const file = (rel: string, content: string): GazeboFile => ({
    path: `${`robotforge-${input.slug}-gazebo`}/${rel}`,
    content,
  });

  if (avail.format === "xacro") return buildAndinoBundle(input, file);
  if (avail.format === "sdf") return buildSdfBundle(input, fetchText, file);
  return buildUrdfBundle(input, fetchText, file);
}

async function buildUrdfBundle(
  input: GazeboInputs,
  fetchText: FetchText,
  file: (rel: string, content: string) => GazeboFile,
): Promise<GazeboBundle> {
  const entry = input.physics!;
  const slug = input.slug;
  const bundleRoot = `robotforge-${slug}-gazebo`;
  const rawText = await fetchText(entry.urdf_url || "");
  const text = stripComments(rawText);
  const layout = modelLayout(entry, text);
  const robotName = modelNameIn(text, "urdf") || slug;

  // Mesh downloads + package:// rewriting, derived from the actual
  // model file — never from a hand-maintained list.
  const downloads: MeshDownload[] = [];
  const unresolved: string[] = [];
  let bundledText = rawText;
  for (const ref of meshFilenames(text)) {
    if (ref.startsWith("$(")) continue; // xacro expression, not a file
    const resolved = resolveMesh(entry, ref, layout);
    if (!resolved) {
      unresolved.push(ref);
      continue;
    }
    if (!downloads.some((d) => d.dest === resolved.dest)) {
      downloads.push(resolved);
    }
    if (ref.startsWith("package://")) {
      const fromDir = layout.modelDest.replace(/[^/]*$/, "").replace(/\/$/, "");
      const rewritten = relPath(fromDir, resolved.dest);
      bundledText = bundledText.split(`filename="${ref}"`).join(`filename="${rewritten}"`);
    }
  }

  const needsXacro = hasXacroTags(text);
  const modelRel = layout.modelDest;
  const includeUri = needsXacro ? "robot.urdf" : modelRel;
  const notes: string[] = [];
  if (entry.model_note) notes.push(entry.model_note);
  if (needsXacro) {
    notes.push(
      "This model file carries xacro macros (it declares a namespace argument). " +
        "The ROS launch expands it with xacro before spawning; expand_model.sh does " +
        "the same for the plain gz sim variant, writing robot.urdf at the bundle root.",
    );
  }
  if (downloads.length > 0) {
    notes.push(
      "Mesh references in the bundled model were rewritten from package:// URIs to " +
        "bundle-relative paths, so neither launch path needs a ROS workspace lookup.",
    );
  }
  if (entry.generated) {
    notes.push(
      "This model is the catalogue's generated twin (built by RobotForge's own URDF " +
        "generator from the robot's spec), not a manufacturer's file.",
    );
  }

  const fetchCmd = downloads.length > 0 ? " && ./fetch_meshes.sh" : "";
  const expandCmd = needsXacro ? " && ./expand_model.sh" : "";
  const primaryCommand =
    `cd ${bundleRoot}${fetchCmd} && ros2 launch launch/launch.py`;
  const gzCommand =
    `cd ${bundleRoot}${fetchCmd}${expandCmd} && GZ_SIM_RESOURCE_PATH="$PWD/models" gz sim -r worlds/world_with_robot.sdf`;

  const files: GazeboFile[] = [
    file(modelRel, bundledText),
    file("worlds/empty_world.sdf", buildWorldSdf()),
    file(
      "worlds/world_with_robot.sdf",
      buildWorldSdf({ uri: includeUri, name: robotName }),
    ),
    file(
      "launch/launch.py",
      buildLaunchPy({
        displayName: input.robotName,
        mode: needsXacro ? "xacro" : "plain",
        modelRel,
        robotName,
        sourceLabel: entry.source_label || "the catalogue's recorded model",
      }),
    ),
    file("package.xml", packageXml(slug, input.robotName, entry.license)),
  ];
  if (downloads.length > 0) {
    files.push(
      file(
        "fetch_meshes.sh",
        fetchMeshesSh(
          downloads,
          `The meshes belong to the model recorded as: ${entry.source_label || "the catalogue's pinned source"}.`,
        ),
      ),
    );
  }
  if (needsXacro) {
    files.push(
      file(
        "expand_model.sh",
        `#!/bin/sh
# Expands this model's xacro macros into a plain URDF (robot.urdf
# at the bundle root) for the plain \`gz sim\` variant, which cannot
# process xacro itself. The ROS 2 launch expands in-process and
# does not need this script.
set -e
cd "$(dirname "$0")"
xacro ${JSON.stringify(modelRel)} > robot.urdf
echo "wrote robot.urdf (xacro expansion of ${modelRel})"
`,
      ),
    );
  }
  const manifest = {
    bundle: "robotforge-gazebo-launch/1",
    robot: slug,
    robot_name: input.robotName,
    format: "urdf" as const,
    model_source: entry.source_label ?? null,
    license: entry.license ?? null,
    primary_command: primaryCommand,
    gz_command: gzCommand,
    mesh_downloads: downloads,
    unresolved_meshes: unresolved,
    files: files.map((f) => f.path.slice(bundleRoot.length + 1)),
  };
  files.push(file("bundle.json", JSON.stringify(manifest, null, 2) + "\n"));
  files.push(
    file(
      "README.md",
      buildReadme({
        displayName: input.robotName,
        format: "urdf",
        sourceLabel: entry.source_label || "the catalogue's recorded model",
        license: entry.license,
        primaryCommand,
        gzCommand,
        meshDownloads: downloads,
        unresolvedMeshes: unresolved,
        modelRel,
        notes,
      }),
    ),
  );

  return {
    slug,
    robotName: input.robotName,
    format: "urdf",
    bundleRoot,
    files,
    meshDownloads: downloads,
    unresolvedMeshes: unresolved,
    primaryCommand,
    gzCommand,
    sourceLabel: entry.source_label || "the catalogue's recorded model",
    license: entry.license,
    notes,
  };
}

async function buildSdfBundle(
  input: GazeboInputs,
  fetchText: FetchText,
  file: (rel: string, content: string) => GazeboFile,
): Promise<GazeboBundle> {
  const px4 = input.px4;
  if (!px4) {
    throw new Error(
      "The X500's recorded specimen data (catalog/specimens/px4-x500.json) " +
        "could not be read, so the bundle cannot be built from the record.",
    );
  }
  const slug = input.slug;
  const bundleRoot = `robotforge-${slug}-gazebo`;
  const repoPath = px4.repo.replace(/^https?:\/\/github\.com\//, "").replace(/\/$/, "");
  const rawUrl = `https://raw.githubusercontent.com/${repoPath}/${px4.commit}/${px4.sdfPath}`;
  const sdfText = await fetchText(rawUrl);
  const text = stripComments(sdfText);
  const robotName = modelNameIn(text, "sdf") || "x500_base";
  const modelDir =
    px4.sdfPath.replace(/[^/]*$/, "").replace(/\/$/, "").split("/").pop() || robotName;
  const modelRel = `models/${modelDir}/model.sdf`;

  // Meshes are addressed as model://<model>/<path> inside the SDF;
  // the fetch script mirrors them under models/ so Gazebo's
  // resource path resolves them unchanged. No rewriting needed.
  const downloads: MeshDownload[] = [];
  for (const uri of sdfMeshUris(text)) {
    const rel = uri.slice("model://".length);
    const dest = `models/${rel}`;
    const url = `https://raw.githubusercontent.com/${repoPath}/${px4.commit}/models/${rel}`;
    if (!downloads.some((d) => d.dest === dest)) downloads.push({ url, dest });
  }

  const sourceLabel =
    `${repoPath} @ ${px4.commit.slice(0, 7)} — the specimen import's pinned ` +
    "commit (catalog/specimens/px4-x500.json)";
  const notes: string[] = [
    "The recorded model is a native Gazebo SDF, so this bundle needs no format " +
      "conversion at all — the file is bundled exactly as PX4 publishes it.",
    "The specimen covers x500_base, the base airframe; PX4's fuller variants " +
      "(cameras, lidar, gimbals) are composed from it upstream and are not what " +
      "the catalogue recorded.",
    "The model's meshes are addressed as model:// URIs; the launch sets " +
      "GZ_SIM_RESOURCE_PATH to this bundle's models/ folder so they resolve.",
  ];

  const fetchCmd = downloads.length > 0 ? " && ./fetch_meshes.sh" : "";
  const primaryCommand = `cd ${bundleRoot}${fetchCmd} && ros2 launch launch/launch.py`;
  const gzCommand =
    `cd ${bundleRoot}${fetchCmd} && GZ_SIM_RESOURCE_PATH="$PWD/models" gz sim -r worlds/world_with_robot.sdf`;

  const modelConfig = `<?xml version="1.0"?>
<model>
  <name>${robotName}</name>
  <version>1.0</version>
  <sdf version="1.9">model.sdf</sdf>
  <description>${input.robotName} — bundled by RobotForge from ${sourceLabel}. Model licence: ${px4.license ?? "BSD-3-Clause"}.</description>
</model>
`;

  const files: GazeboFile[] = [
    file(modelRel, sdfText),
    file(`models/${modelDir}/model.config`, modelConfig),
    file("worlds/empty_world.sdf", buildWorldSdf()),
    file("worlds/world_with_robot.sdf", buildWorldSdf({ uri: modelRel, name: robotName })),
    file(
      "launch/launch.py",
      buildLaunchPy({
        displayName: input.robotName,
        mode: "sdf",
        modelRel,
        robotName,
        sourceLabel,
      }),
    ),
    file("package.xml", packageXml(slug, input.robotName, px4.license)),
  ];
  if (downloads.length > 0) {
    files.push(
      file(
        "fetch_meshes.sh",
        fetchMeshesSh(downloads, `They are the meshes of: ${sourceLabel}.`),
      ),
    );
  }
  const manifest = {
    bundle: "robotforge-gazebo-launch/1",
    robot: slug,
    robot_name: input.robotName,
    format: "sdf" as const,
    model_source: sourceLabel,
    license: px4.license ?? null,
    primary_command: primaryCommand,
    gz_command: gzCommand,
    mesh_downloads: downloads,
    unresolved_meshes: [] as string[],
    files: files.map((f) => f.path.slice(bundleRoot.length + 1)),
  };
  files.push(file("bundle.json", JSON.stringify(manifest, null, 2) + "\n"));
  files.push(
    file(
      "README.md",
      buildReadme({
        displayName: input.robotName,
        format: "sdf",
        sourceLabel,
        license: px4.license,
        primaryCommand,
        gzCommand,
        meshDownloads: downloads,
        unresolvedMeshes: [],
        modelRel,
        notes,
      }),
    ),
  );

  return {
    slug,
    robotName: input.robotName,
    format: "sdf",
    bundleRoot,
    files,
    meshDownloads: downloads,
    unresolvedMeshes: [],
    primaryCommand,
    gzCommand,
    sourceLabel,
    license: px4.license,
    notes,
  };
}

function buildAndinoBundle(
  input: GazeboInputs,
  file: (rel: string, content: string) => GazeboFile,
): GazeboBundle {
  const slug = input.slug;
  const bundleRoot = `robotforge-${slug}-gazebo`;
  const repoUrl = (input.andinoRepoUrl || "https://github.com/Ekumen-OS/andino").replace(/\/$/, "");
  const repoPath = repoUrl.replace(/^https?:\/\/github\.com\//, "");
  const sourceLabel =
    `${repoPath} (official project repository) — the catalogue records the ` +
    "repository but no pinned commit for this model";
  const notes: string[] = [
    "Andino's model is xacro spread across the andino_description package " +
      "(three included macro files plus YAML configuration it loads), so no " +
      "single model file exists to put in this zip. fetch_model.sh downloads " +
      "the official repo on your machine; the launch expands the xacro with " +
      "use_real_ros_control:=false before spawning.",
    "This is the one bundle whose model fetch is NOT pinned to a commit: the " +
      "catalogue never recorded one for Andino. The fetch takes the repo's " +
      "current default branch, and this note is here so that is a known fact, " +
      "not a quiet one.",
    "The catalogue's Andino specs were read from andino_description's own " +
      "config files (BSD-3-Clause, (c) Ekumen Inc.).",
  ];

  const primaryCommand =
    `cd ${bundleRoot} && ./fetch_model.sh && ros2 launch launch/launch.py`;
  const gzCommand =
    `cd ${bundleRoot} && ./fetch_model.sh && ./expand_model.sh && gz sim -r worlds/world_with_robot.sdf`;

  const files: GazeboFile[] = [
    file("worlds/empty_world.sdf", buildWorldSdf()),
    file(
      "worlds/world_with_robot.sdf",
      buildWorldSdf({ uri: "robot.urdf", name: "andino" }),
    ),
    file(
      "launch/launch.py",
      buildLaunchPy({
        displayName: input.robotName,
        mode: "andino",
        robotName: "andino",
        sourceLabel,
      }),
    ),
    file("package.xml", packageXml(slug, input.robotName, "BSD-3-Clause")),
    file(
      "fetch_model.sh",
      `#!/bin/sh
# Fetches the official Andino description package (${repoPath}).
# The RobotForge catalogue records the repository but no pinned
# commit for this model, so — alone among these bundles — this
# fetch is NOT pinned: it takes the repo's current default branch.
set -e
cd "$(dirname "$0")"
if [ -d vendor/andino/andino_description ]; then
  echo "already fetched: vendor/andino"
  exit 0
fi
mkdir -p vendor
TARBALL="https://codeload.github.com/${repoPath}/tar.gz/refs/heads/main"
if command -v curl >/dev/null 2>&1; then curl -fL -o vendor/andino.tar.gz "$TARBALL";
elif command -v wget >/dev/null 2>&1; then wget -O vendor/andino.tar.gz "$TARBALL";
else echo "error: this script needs curl or wget" >&2; exit 1; fi
tar -xzf vendor/andino.tar.gz -C vendor
mv vendor/andino-main vendor/andino
rm vendor/andino.tar.gz
echo "fetched ${repoPath} (default branch, unpinned) into vendor/andino"
`,
    ),
    file(
      "expand_model.sh",
      `#!/bin/sh
# Expands Andino's xacro into a plain URDF (robot.urdf at the
# bundle root) for the plain \`gz sim\` variant. xacro resolves
# $(find andino_description) through the ament index, so this
# builds the smallest prefix that registers the fetched package
# (under vendor_prefix/), expands with use_real_ros_control:=false,
# and rewrites package:// mesh URIs to the fetched tree.
set -e
cd "$(dirname "$0")"
PKG="$PWD/vendor/andino/andino_description"
if [ ! -f "$PKG/urdf/andino.urdf.xacro" ]; then
  echo "run ./fetch_model.sh first" >&2
  exit 1
fi
mkdir -p vendor_prefix/share/ament_index/resource_index/packages
touch vendor_prefix/share/ament_index/resource_index/packages/andino_description
mkdir -p vendor_prefix/share
ln -sfn "$PKG" vendor_prefix/share/andino_description
AMENT_PREFIX_PATH="$PWD/vendor_prefix\${AMENT_PREFIX_PATH:+:$AMENT_PREFIX_PATH}" \\
  xacro "$PKG/urdf/andino.urdf.xacro" use_real_ros_control:=false > robot.urdf.tmp
sed "s|package://andino_description|$PKG|g" robot.urdf.tmp > robot.urdf
rm robot.urdf.tmp
echo "wrote robot.urdf"
`,
    ),
  ];
  const manifest = {
    bundle: "robotforge-gazebo-launch/1",
    robot: slug,
    robot_name: input.robotName,
    format: "xacro" as const,
    model_source: sourceLabel,
    license: "BSD-3-Clause",
    primary_command: primaryCommand,
    gz_command: gzCommand,
    mesh_downloads: [] as MeshDownload[],
    unresolved_meshes: [] as string[],
    files: files.map((f) => f.path.slice(bundleRoot.length + 1)),
  };
  files.push(file("bundle.json", JSON.stringify(manifest, null, 2) + "\n"));
  files.push(
    file(
      "README.md",
      buildReadme({
        displayName: input.robotName,
        format: "xacro",
        sourceLabel,
        license: "BSD-3-Clause",
        primaryCommand,
        gzCommand,
        meshDownloads: [],
        unresolvedMeshes: [],
        notes,
      }),
    ),
  );

  return {
    slug,
    robotName: input.robotName,
    format: "xacro",
    bundleRoot,
    files,
    meshDownloads: [],
    unresolvedMeshes: [],
    primaryCommand,
    gzCommand,
    sourceLabel,
    license: "BSD-3-Clause",
    notes,
  };
}
