# Pinned URDF test fixtures

These files make the Node/Rapier physics integration test deterministic and
offline. They are unmodified copies of the same upstream files and commits
recorded in `catalog/physics.json`.

| Fixture | Upstream source | SHA-256 | Upstream license |
|---|---|---|---|
| `turtlebot3-burger.urdf` | [ROBOTIS-GIT/turtlebot3 @ `fc817ce`](https://github.com/ROBOTIS-GIT/turtlebot3/blob/fc817ce3073af1d6032397c64504134882af5e9a/turtlebot3_description/urdf/turtlebot3_burger.urdf) | `bc453d08d6a3f2da1530201a15807edafffa5158c291dc40f5edb19ae35ca603` | Apache-2.0 |
| `unitree-go2.urdf` | [unitreerobotics/unitree_ros @ `267182b`](https://github.com/unitreerobotics/unitree_ros/blob/267182b8521c8d6a631bab1fe63836873237a525/robots/go2_description/urdf/go2_description.urdf) | `8f4571b49f35ce04b8833d561c403bddeb9cd8f7077e2ddbee82895726de487c` | BSD-3-Clause |

The fixtures are test inputs only. RobotForge continues to show the official
pinned source URLs and provenance in the product catalogue.
