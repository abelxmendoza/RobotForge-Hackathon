"""Robot specification schema.

A RobotSpec is the structured contract between the language model (describe),
the engineering checks (validate), and the twin generator (urdf/gazebo).
Plain dataclasses, zero dependencies, strict parsing: unknown or malformed
input raises SpecError rather than being silently coerced.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field


class SpecError(ValueError):
    """Raised when a spec document cannot be parsed into a RobotSpec."""


DRIVETRAINS = ("differential", "skid_steer", "ackermann", "mecanum", "tracked")
SENSOR_KINDS = ("ultrasonic", "lidar_2d", "depth_camera", "rgb_camera", "imu", "gps",
                "bumper", "encoder")


@dataclass
class Wheel:
    diameter_m: float
    width_m: float
    count: int
    driven: bool = True


@dataclass
class Motor:
    kind: str                 # e.g. "dc_gearmotor", "bldc", "servo", "stepper"
    voltage_v: float
    count: int
    stall_torque_nm: float | None = None


@dataclass
class Battery:
    chemistry: str            # e.g. "lipo", "liion", "nimh", "lead_acid"
    voltage_v: float
    capacity_mah: int


@dataclass
class Sensor:
    kind: str                 # one of SENSOR_KINDS
    position: str             # free text: "front", "rear", "top", ...
    range_m: float | None = None


WIRING_KINDS = ("power", "data")


@dataclass
class WiringNode:
    """One electrical component in a robot's wiring diagram.

    ``rated_max_v`` is the part's documented maximum voltage (a motor's
    rated range top, a driver's datasheet input max) or None when the
    sources name none — None means "cannot be checked", never "safe".
    ``kit`` names the take-apart kit part this component maps to, if any.
    ``deck`` marks components the viewer places on the chassis deck.
    """
    id: str
    label: str
    req_label: str            # display text: "11.1 V", "3-9 V", "not specified"
    rated_max_v: float | None = None
    kit: str | None = None
    deck: bool = False


@dataclass
class WiringConnection:
    """A wire between two nodes. ``volts`` is the fixed voltage the
    connection is specified to carry, or None when it carries none
    (data links, PWM drive, unspecified rails) — None connections are
    never voltage-checked."""
    src: str
    dst: str
    kind: str                 # one of WIRING_KINDS
    volts: float | None = None
    label: str = ""


@dataclass
class Wiring:
    """A robot's documented/typical wiring: nodes + connections.

    Optional on a spec — most specs carry none. Values come from the
    spec's own electrical fields and the parts catalog's datasheet
    specs; anything unsourced stays None / "not specified".
    """
    note: str
    nodes: list[WiringNode]
    connections: list[WiringConnection]

    @classmethod
    def from_dict(cls, data: dict) -> "Wiring":
        try:
            nodes, seen = [], set()
            for n in data["nodes"]:
                nid = str(n["id"])
                if not nid or nid in seen:
                    raise SpecError(f"wiring node id must be unique and "
                                    f"non-empty, got {nid!r}")
                seen.add(nid)
                rated = n.get("rated_max_v")
                nodes.append(WiringNode(
                    id=nid, label=str(n["label"]),
                    req_label=str(n.get("req_label", "not specified")),
                    rated_max_v=None if rated is None else float(rated),
                    kit=n.get("kit"), deck=bool(n.get("deck", False))))
            connections = []
            for c in data["connections"]:
                if c["kind"] not in WIRING_KINDS:
                    raise SpecError(f"wiring kind must be one of "
                                    f"{WIRING_KINDS}, got {c['kind']!r}")
                for end in (c["from"], c["to"]):
                    if end not in seen:
                        raise SpecError(f"wiring connection names unknown "
                                        f"node {end!r}")
                volts = c.get("volts")
                if volts is not None:
                    volts = float(volts)
                    if volts < 0:
                        raise SpecError("wiring volts must be >= 0")
                connections.append(WiringConnection(
                    src=str(c["from"]), dst=str(c["to"]), kind=c["kind"],
                    volts=volts, label=str(c.get("label", ""))))
            return cls(note=str(data.get("note", "")), nodes=nodes,
                       connections=connections)
        except SpecError:
            raise
        except (KeyError, TypeError, ValueError) as exc:
            raise SpecError(f"invalid wiring: {exc}") from exc

    def to_dict(self) -> dict:
        return {
            "note": self.note,
            "nodes": [{"id": n.id, "label": n.label,
                       "req_label": n.req_label,
                       "rated_max_v": n.rated_max_v, "kit": n.kit,
                       "deck": n.deck} for n in self.nodes],
            "connections": [{"from": c.src, "to": c.dst, "kind": c.kind,
                             "volts": c.volts, "label": c.label}
                            for c in self.connections],
        }


@dataclass
class RobotSpec:
    name: str
    description: str
    drivetrain: str
    length_m: float
    width_m: float
    height_m: float
    mass_kg: float            # declared total mass (checked against budget if given)
    ground_clearance_m: float
    wheel: Wheel
    motor: Motor
    battery: Battery
    sensors: list[Sensor] = field(default_factory=list)
    component_mass_kg: dict[str, float] = field(default_factory=dict)
    wiring: Wiring | None = None

    # -- parsing ---------------------------------------------------------
    @classmethod
    def from_dict(cls, data: dict) -> "RobotSpec":
        try:
            if data["drivetrain"] not in DRIVETRAINS:
                raise SpecError(f"drivetrain must be one of {DRIVETRAINS}, "
                                f"got {data['drivetrain']!r}")
            sensors = []
            for s in data.get("sensors", []):
                if s["kind"] not in SENSOR_KINDS:
                    raise SpecError(f"sensor kind must be one of {SENSOR_KINDS}, "
                                    f"got {s['kind']!r}")
                sensors.append(Sensor(kind=s["kind"], position=s["position"],
                                      range_m=s.get("range_m")))
            return cls(
                name=str(data["name"]),
                description=str(data.get("description", "")),
                drivetrain=data["drivetrain"],
                length_m=float(data["length_m"]),
                width_m=float(data["width_m"]),
                height_m=float(data["height_m"]),
                mass_kg=float(data["mass_kg"]),
                ground_clearance_m=float(data["ground_clearance_m"]),
                wheel=Wheel(**{k: data["wheel"][k] for k in
                               ("diameter_m", "width_m", "count")},
                            driven=bool(data["wheel"].get("driven", True))),
                motor=Motor(kind=str(data["motor"]["kind"]),
                            voltage_v=float(data["motor"]["voltage_v"]),
                            count=int(data["motor"]["count"]),
                            stall_torque_nm=data["motor"].get("stall_torque_nm")),
                battery=Battery(chemistry=str(data["battery"]["chemistry"]),
                                voltage_v=float(data["battery"]["voltage_v"]),
                                capacity_mah=int(data["battery"]["capacity_mah"])),
                sensors=sensors,
                component_mass_kg={str(k): float(v) for k, v in
                                   data.get("component_mass_kg", {}).items()},
                wiring=(Wiring.from_dict(data["wiring"])
                        if data.get("wiring") is not None else None),
            )
        except (KeyError, TypeError, ValueError) as exc:
            if isinstance(exc, SpecError):
                raise
            raise SpecError(f"invalid spec: {exc}") from exc

    @classmethod
    def from_json(cls, text: str) -> "RobotSpec":
        try:
            return cls.from_dict(json.loads(text))
        except json.JSONDecodeError as exc:
            raise SpecError(f"spec is not valid JSON: {exc}") from exc

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "description": self.description,
            "drivetrain": self.drivetrain,
            "length_m": self.length_m,
            "width_m": self.width_m,
            "height_m": self.height_m,
            "mass_kg": self.mass_kg,
            "ground_clearance_m": self.ground_clearance_m,
            "wheel": {"diameter_m": self.wheel.diameter_m,
                      "width_m": self.wheel.width_m,
                      "count": self.wheel.count,
                      "driven": self.wheel.driven},
            "motor": {"kind": self.motor.kind,
                      "voltage_v": self.motor.voltage_v,
                      "count": self.motor.count,
                      "stall_torque_nm": self.motor.stall_torque_nm},
            "battery": {"chemistry": self.battery.chemistry,
                        "voltage_v": self.battery.voltage_v,
                        "capacity_mah": self.battery.capacity_mah},
            "sensors": [{"kind": s.kind, "position": s.position,
                         "range_m": s.range_m} for s in self.sensors],
            "component_mass_kg": self.component_mass_kg,
            **({"wiring": self.wiring.to_dict()}
               if self.wiring is not None else {}),
        }
