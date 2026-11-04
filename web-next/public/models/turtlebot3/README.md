# ROBOTIS TurtleBot3 LDS display mesh

`lds.stl` is an unchanged copy of the official ROBOTIS TurtleBot3 description
mesh at revision `fc817ce3073af1d6032397c64504134882af5e9a`, redistributed
under Apache-2.0. See `LICENSE` and `provenance.json` for the exact source,
byte hash, native millimetre bounds and metre conversion.

The repository already records this same source and revision in
`catalog/specimens/turtlebot3-burger.json`; its specimen viewer still uses
those recorded link transforms. This local copy gives the kit viewer an
asset that does not depend on a third-party mesh request. It is intentionally
not another complete TurtleBot URDF importer: the simulation viewer already
uses urdf-loader for articulated source robots.

The kit viewer uses this mesh only for the named TurtleBot3 Burger. Its
surrounding chassis and post remain schematic; the sensor top aligns to
the kit height rather than claiming an exact joint placement. The housing
stays stationary while the existing scan sweep illustrates sensing. PBR
material values and procedural studio illumination are display approximations,
not measured materials or a claim of photorealism. No remote HDR is loaded.
