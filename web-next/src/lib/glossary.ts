/* Plain-English meanings for the words RobotForge uses. One place, so
 * the tooltip, the glossary section and the chat never disagree. */
export const GLOSSARY: Record<string, { term: string; plain: string }> = {
  spec: { term: 'Spec', plain: 'A short structured description of a robot: size, mass, motors, battery, wheels. Every check reads it.' },
  checks: { term: 'Engineering checks', plain: 'Fixed rules that test whether a spec’s numbers fit together, like wheels big enough to lift the chassis. Same answer every time; no AI.' },
  twin: { term: 'Digital twin', plain: 'A simulated copy of the robot, built from its spec, that can drive in a physics simulator before any hardware exists.' },
  gate: { term: 'Gate (motion test)', plain: 'A pass/fail test in the Gazebo simulator: the twin drives 1 m, turns 90° and stops, and the result is measured against where it really went.' },
  gazebo: { term: 'Gazebo', plain: 'Open-source robot physics simulator. RobotForge runs the gate in it, headless.' },
  urdf: { term: 'URDF', plain: 'The standard file format ROS uses to describe a robot’s parts and joints. RobotForge exports one from every spec.' },
  harness: { term: 'Harness (electrical check)', plain: 'The robot’s wiring. The harness check adds up current on each power rail and flags wires that are too thin or rails that are overloaded.' },
  odometry: { term: 'Odometry', plain: 'Where the robot thinks it went, from counting wheel turns. The gate compares it with ground truth to catch wrong wheel sizes.' },
  ground_truth: { term: 'Ground truth', plain: 'Where the robot actually went in the simulator, read straight from the physics engine.' },
  forge_loop: { term: 'Forge loop', plain: 'When a check fails, Muse Spark proposes a change, the checks re-run, up to three rounds. The model proposes; the checks decide.' },
  robodex: { term: 'Robodex', plain: 'RobotForge’s catalogue of real robots, each with its spec, sources and test results.' },
  spotter: { term: 'Spotter', plain: 'Identifies a robot from a photo and looks it up in the Robodex.' },
  takeapart: { term: 'Take-apart', plain: 'An exploded 3D view of a robot’s parts, with a printable kit for the parts you can 3D-print.' },
  estimated: { term: 'ESTIMATED', plain: 'A number guessed from a photo. Treat it as a starting point until you measure the real part.' },
  document_read: { term: 'DOCUMENT-READ', plain: 'A number copied from a printed spec sheet or label, not guessed.' },
  measured: { term: 'MEASURED', plain: 'A number from a real measurement, such as a 3D scan or a simulator reading.' },
  live: { term: 'LIVE', plain: 'Muse Spark answered just now from your input.' },
  recorded: { term: 'RECORDED', plain: 'A saved result from an earlier real run, replayed. Not generated from your input.' },
  mock: { term: 'MOCK', plain: 'An offline helper using fixed textbook rules, used when the live model is unavailable. Not AI.' },
};

export type GlossaryKey = keyof typeof GLOSSARY;
