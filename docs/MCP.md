# RobotForge MCP server (local, read-only)

`robotforge mcp` lets Claude Desktop, Claude Code or any other MCP client
look at your robots and run RobotForge's checks on them. It is **read-only
on purpose**: an agent can read and check, but there is no tool that changes
a robot. It calls no AI model and makes no network requests. Everything runs
on your machine.

This is phase 1 of the plan "RobotForge MCP server: read first, write later".
Later phases are an online version that reads your saved account, then
change *proposals* that you approve in the Workshop. Agents will never be
able to make changes directly.

## Install

```
pip install -e ".[mcp]"
```

Works with both the 1.x and the 2.x `mcp` Python SDK.

## Give it your robots

In the Workshop, use **Export** (one robot's spec) or **Export history** (a
robot with all its versions) and save the files into one folder, for example
`~/RobotForge/robots`. The server reads every `*.json` file in that folder.
A file can be:

- a bare robot spec,
- one Workshop robot with its versions,
- a list of Workshop robots, or
- an account dump holding `rf.garage.v1` (and optionally `rf.inventory.v1`),
  with or without the `{"data": ...}` wrapper that `GET /account/data`
  returns.

Without a folder, the server still serves the public Robodex, the parts
catalog and Omega1's cited records.

## Connect it

**Claude Code:**

```
claude mcp add robotforge -- robotforge mcp --robots ~/RobotForge/robots
```

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "robotforge": {
      "command": "robotforge",
      "args": ["mcp", "--robots", "/Users/you/RobotForge/robots"]
    }
  }
}
```

If `robotforge` isn't on the app's PATH, put the full path to it there
(`which robotforge`).

## Tools

| Tool | What it returns |
| --- | --- |
| `list_robots` | Your robots (from the folder) and the Robodex robots |
| `get_robot` | One robot's spec and version history. Photos are left out |
| `run_checks` | Engineering, stability, rover (slope, step, runtime) and wiring checks, with every finding. A check that can't run says why. A spec that can't be read gives `NOT_CHECKED`, never a pass |
| `get_parts_list` | The parts the spec declares (motors, wheels, battery, sensors, electronics). No prices |
| `get_twin` | The digital twin's links, joints, size and mass, plus the URDF if asked |
| `get_sim_evidence` | Recorded Gazebo gate runs (Robodex robots), or `NOT_RUN` |
| `search_parts` / `get_part` | The RobotForge parts catalog |
| `get_inventory` | Your parts inventory, if the folder holds an account dump |
| `get_omega1_records` | Omega1's facts from its code repo, each with an evidence level and the source line. `MEASURE_ME` fields stay unknown |

Each tool is marked `readOnlyHint: true`. Robot names, notes and
descriptions are your own text, and the server tells the agent to treat them
as data, not instructions.

## Try it

Ask Claude things like:

- "Which checks fail on my rover, and why?"
- "Compare the parts list of my robot with the TurtleBot3 Burger."
- "What do we actually know about Omega1's battery, and what still needs
  measuring?"
- "Has the Andino passed the Gazebo gate?"
