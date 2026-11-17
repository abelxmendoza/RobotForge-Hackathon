# TurtleBot3 Burger manufacturer reference

Four unchanged ROBOTIS STL files from turtlebot3 revision
`fc817ce3073af1d6032397c64504134882af5e9a`, under Apache-2.0 (LICENSE).
`model.json` records original URLs, SHA-256 digests, native millimetre-to-metre
scales, URDF visual placements, and all triangle ranges.

`tools/prepare_turtlebot_model.py assets/models/turtlebot3-burger` reproduces
the partition. The base's 96,524 triangles form 254 disconnected geometry
shells. No triangles are discarded, added, rescaled independently, or moved
inside a group. RobotForge assigns these shells to 20 inspection assemblies
including the separate scanner and wheels. Group labels, materials and
explosion paths are annotations. Geometry-shell count is not physical part
count. Fasteners and board details remain grouped, not individually serviced.

The inspection sequence is interpretive and reversible. It is not a verified
service procedure. Source geometry is a specific LDS-01/Pi-era reference;
unpublished cabling and internal components are not invented. Physics and
recorded numerical specifications remain separate from this display model.
